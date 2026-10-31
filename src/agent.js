  // Agent
  // =====
  // The assistant at work: it reads the project, changes it through tools,
  // and checks and runs what it wrote. What it may touch is the user's to
  // say. Files can be locked; a session on chosen holes can only fill those
  // holes, and the page writes the code in place itself, so nothing else can
  // change. Every write is checked at once and the verdict goes back to the
  // agent: nothing it claims counts but the checker's. A snapshot comes
  // first, and one tap undoes the whole session.
  //
  // With Claude through the viewer, one call allows only a handful of tool
  // rounds and 256 KiB of text, so a session is a chain of calls, each
  // starting from the project as it stands and a journal of the calls
  // before it: their messages, their tool calls with what they returned,
  // and the plan the last one left. With an API, the page runs the tool
  // loop itself. Tools run one at a time. What a session carries is the
  // profile's to set (agent_limits).

  const agent = {
    running: false, writing: false, paused: null, steps: 0, budget: 20, size: 20,
    log: [], ctl: null, queue: Promise.resolve(), mode: "project", holes: [], close: false,
    entry: "", task: "", before: null, done: false, last: "", raf: 0,
    trace: [], t0: 0, wall: 0, notes: [], ended: "", note_draft: "", lim: null, mem: null, shrink: null,
    auto: true, status: "", open: new Set(), keep: false,
  };

  // Everything said and done in a session, for whoever debugs it: what the
  // page sent (prompts, API requests), what came back (replies, raw
  // responses), each tool call with the exact text it returned, pauses and
  // the end. Never a key.
  // Each event names the journal entry it belongs to (j): the one given, or
  // the latest; so an entry unfolds into what was said and done for it.
  function trace(type, data, entry) {
    const j = entry ? agent.log.indexOf(entry) : agent.log.length - 1;
    agent.trace.push(Object.assign({ t: Math.round(performance.now() - agent.t0), type }, data, j >= 0 ? { j } : {}));
  }
  // What a session may carry, by provider; a profile's own numbers (AI
  // settings, Agent limits) override these. files: characters of the
  // project quoted in each call; result: one tool result as the agent gets
  // it; memory: bytes of the view of the project's chat each call gets
  // (past it, the view merges down to half); ctx: bytes of the messages a
  // compaction reads; with an API, tokens: one reply's length.
  const AGENT_LIMITS = {
    claude: { files: 40000, result: 6000, memory: 48000, ctx: 8000 },
    api: { files: 80000, result: 6000, memory: 96000, ctx: 16000, tokens: 4096 },
  };
  const AGENT_LIMIT_MAX = { files: 200000, result: 50000, memory: 200000, ctx: 64000, tokens: 128000 };
  // A Claude call's prompt: what sample.limits() reports, less a margin for
  // the platform's own framing; 256 KiB when it reports nothing.
  function sample_bytes() {
    return Math.max(32000, (ai.max_prompt || 262144) - 20000);
  }

  function agent_limits(cfg) {
    const base = AGENT_LIMITS[cfg && cfg.provider === "claude" ? "claude" : "api"];
    const own = (cfg && cfg.limits) || {};
    const out = {};
    for (const k of Object.keys(base)) {
      const n = Math.floor(Number(own[k]));
      out[k] = Number.isFinite(n) && n > 0 ? Math.min(n, AGENT_LIMIT_MAX[k]) : base[k];
    }
    // thinking counts against a reply's tokens: more room by default
    if (cfg && cfg.reasoning && !(Number(own.tokens) > 0)) {
      out.tokens = 16000;
    }
    return out;
  }

  // Reasoning (a profile's setting): with Anthropic, adaptive thinking, its
  // summaries shown (models before 4.6 take a token budget instead), and an
  // effort; with OpenAI, the effort alone. Empty: the model's own default
  // (Claude Opus 5.5 and the newest models think by default, summaries
  // hidden). Thinking blocks go back as they came, in a turn's exchange.
  const OLD_THINKING = /claude-(3|haiku-4-5|sonnet-4-5|sonnet-4-0|sonnet-4-2|opus-4-0|opus-4-1|opus-4-5|opus-4-2)/;

  function agent_reasoning(cfg, model, tokens) {
    const out = {};
    const old = OLD_THINKING.test(model);
    if (cfg.provider === "anthropic") {
      if (cfg.reasoning === "adaptive") {
        out.thinking = old ? { type: "enabled", budget_tokens: Math.max(1024, Math.min(16000, tokens - 1024)) }
          : { type: "adaptive", display: "summarized" };
      }
      if (cfg.effort && !old) {
        out.output_config = { effort: cfg.effort };
      }
    } else if (cfg.provider === "openai" && cfg.effort) {
      out.reasoning_effort = cfg.effort === "xhigh" || cfg.effort === "max" ? "high" : cfg.effort;
    }
    return out;
  }
  const AGENT_RUN_MS = 10000;  // a run or an eval, at most

  // What the agent may not write: locked files; in a hole session, all of
  // them but through fill_hole.
  function agent_locked(name) {
    return (state.locks || []).includes(name);
  }

  function holes_in(text) {
    return [...new Set([...text.matchAll(/\?([A-Za-z_][\w.]*)/g)].map((m) => m[1]).filter((h) => h !== "TODO"))];
  }

  function hole_open(h) {
    return state.files.some((f) => f.name.endsWith(".bend") && holes_in(f.text).includes(h));
  }

  function agent_ok() {
    const p = ai_cfg();
    return p !== null && (p.provider !== "claude" || (ai.sample !== null && ai.tools === true));
  }

  // The agent may not be raced: while it works, the page's own editing
  // stops, and says why.
  function agent_guard() {
    if (agent.running && !agent.writing) {
      toast(t("agent_busy"));
      return true;
    }
    return false;
  }

  // Tools
  // -----

  function agent_tools() {
    const holes = agent.mode === "holes";
    const S = (props, req) => ({ type: "object", properties: props, required: req || [] });
    const str = { type: "string" };
    const tools = [
      { name: "list_files", run: tool_list, schema: S({}),
        description: "Lists the project's files (with the holes each holds and whether it is locked to you), the hub modules (read-only) and the file checks start from. Returns JSON." },
      { name: "read_file", run: tool_read, schema: S({ path: str, from_line: { type: "integer" }, to_line: { type: "integer" } }, ["path"]),
        description: "Returns the text of a project file, of Base (path Base) or of a hub module (path starting hub:), whole or lines from_line..to_line (1-based)." },
      { name: "list_symbols", run: tool_symbols, schema: S({ module: str, prefix: str }, ["module"]),
        description: "Lists the symbols a module declares (defs, laws, types and their constructors), with their kind and line. module: a project file path, a hub module (hub:...), or Base; prefix narrows the list (e.g. List. in Base)." },
      { name: "signature", run: tool_signature, schema: S({ name: str, file: str }, ["name"]),
        description: "Returns just the type of a name as the file sees it, without its body: a def's parameters and result, a law's binders and claim, a type's parameters, a constructor's fields." },
      { name: "lookup", run: tool_lookup, schema: S({ name: str, file: str }, ["name"]),
        description: "Returns the whole declaration of a name as the file sees it (its own defs, its imports, then Base): signature, doc comment and body. For the type alone, signature is lighter." },
      { name: "guide", run: tool_guide, schema: S({ section: str }),
        description: "Returns a section of the Bend guide by (part of) its title, or the list of titles when called without one." },
      { name: "zoom", run: tool_zoom, schema: S({ id: { type: "integer" }, n: { type: "integer" } }, ["id"]),
        description: "Opens the line id+n of <chat>, your memory, into the two lines of n/2 messages under it; n = 1 (the default) gives message id whole." },
      { name: "search", run: tool_search, schema: S({ text: str }, ["text"]),
        description: "Finds the messages of <chat>, your memory, that hold a text (any case), latest first, with their id and the words around it." },
    ];
    if (!holes) {
      tools.push(
        { name: "edit_file", run: tool_edit, schema: S({ path: str, old_text: str, new_text: str }, ["path", "old_text", "new_text"]),
          description: "Replaces old_text, which must occur exactly once in the file, by new_text. Refused on locked files. The project is checked right after; the verdict comes back." },
        { name: "create_file", run: tool_create, schema: S({ path: str, text: str }, ["path", "text"]),
          description: "Creates a new file (name.bend, or name.js for a foreign effect). Refused if it exists. The project is checked right after." });
    }
    tools.push(
      { name: "fill_hole", run: tool_fill, schema: S({ hole: str, code: str }, ["hole", "code"]),
        description: holes ? "Your only way to write: puts code in place of the hole ?hole, at its indentation. Only the holes of this session can be filled. The project is checked right after."
          : "Puts code in place of the hole ?hole, wherever it is, at its indentation. The project is checked right after; the verdict comes back." },
      { name: "list_holes", run: tool_holes, schema: S({}),
        description: "Lists every hole ?name in the project: file, line, the def it is in, whether you may fill it, and, when the checker reached it, its goal and context. Holes the checker did not reach (behind an error) are listed too, with the reason." },
      { name: "check", run: tool_check, schema: S({ file: str }),
        description: "Checks the project from a file (default: the session's). Returns the verdict, the error with its place, and every open goal with its context." },
      { name: "run", run: tool_run, schema: S({ file: str, args: { type: "array", items: str } }),
        description: "Compiles a file to JavaScript and runs its main with arguments. Returns the exit code and output, capped. A program that opens a window cannot run here." },
      { name: "eval", run: tool_eval, schema: S({ file: str, expr: str, type: str }, ["expr", "type"]),
        description: "Evaluates an expression of the given type in the context of a file (its defs and imports) without changing it; returns the printed value. The type may be IO(...)." });
    return tools;
  }

  function tool_zoom(input) {
    return mem_zoom(agent.mem || mem_new(), input.id, input.n === undefined ? 1 : input.n);
  }

  function tool_search(input) {
    return mem_search(agent.mem || mem_new(), input.text);
  }

  // The project's chat, as the agent's memory: what it is told, does and
  // says, and the page's own notes (a session's start and end, an undo).
  function mem_log(kind, text) {
    if (agent.mem !== null && agent.proj) {
      mem_push(agent.mem, kind, text);
      mem_save(agent.proj);
    }
  }

  // The compactor: Claude at its quick tier in the viewer; with an API, the
  // profile's compactor model (Haiku for Anthropic, else the chat's own).
  function mem_asker(cfg) {
    const signal = agent.ctl ? agent.ctl.signal : undefined;
    const log = (model, t0, text) => trace("memory_call", { model, ms: Math.round(performance.now() - t0), reply: String(text).slice(0, 600) });
    if (cfg.provider === "claude") {
      return async (system, user) => {
        const t0 = performance.now();
        const got = await ai.sample(system + "\n\n" + user, { modelTier: "quick", signal });
        log("quick", t0, got.text);
        return got.text;
      };
    }
    const url = (cfg.url || AI_PROVIDERS[cfg.provider].url || "").replace(/\/+$/, "");
    const model = cfg.compactor || (cfg.provider === "anthropic" ? "claude-haiku-5-5" : cfg.model || AI_PROVIDERS[cfg.provider].model || "");
    return async (system, user) => {
      const t0 = performance.now();
      const anth = cfg.provider === "anthropic";
      let res;
      try {
        res = await fetch(url + (anth ? "/v1/messages" : "/v1/chat/completions"), { method: "POST", signal,
          headers: Object.assign({ "content-type": "application/json" }, anth ? { "x-api-key": cfg.key, "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true" } : cfg.key ? { authorization: "Bearer " + cfg.key } : {}),
          body: JSON.stringify(anth ? { model, max_tokens: 400, system, messages: [{ role: "user", content: user }] }
            : { model, max_tokens: 400, messages: [{ role: "system", content: system }, { role: "user", content: user }] }) });
      } catch (e) {
        throw e && e.name === "AbortError" ? { code: "cancelled", message: "" } : { code: "network", message: t("ai_no_network") };
      }
      if (!res.ok) {
        throw { code: "http", message: "HTTP " + res.status };
      }
      const data = await res.json();
      const text = anth ? (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("")
        : (((data.choices || [])[0] || {}).message || {}).content || "";
      log(model, t0, text);
      return text;
    };
  }

  // Before a call: the view back under its budget, merging what is due.
  async function agent_settle(cfg) {
    if (agent.mem === null) {
      return;
    }
    const lim = agent.lim || agent_limits(cfg);
    // the summaries can take a while: a bar shows how far they are, and
    // the journal an entry, which unfolds into each summary written
    const entry = mem_size(agent.mem) > lim.memory ? agent_log({ kind: "memory", merged: 0, asked: 0, state: "run" }) : null;
    let r;
    try {
      r = await mem_shrink(agent.mem, lim.memory, mem_asker(cfg), cfg.provider === "claude" ? 3 : 6, lim.ctx, (part) => {
        agent.shrink = part;
        agent_paint_soon();
      });
    } finally {
      agent.shrink = null;
      if (entry !== null) {
        Object.assign(entry, r || {}, { state: r ? "ok" : "err" });
      }
      agent_paint_soon();
    }
    if (r.merged > 0) {
      trace("memory", { merged: r.merged, compactions: r.asked, view: mem_size(agent.mem), messages: agent.mem.msgs.length });
      mem_save(agent.proj);
    }
  }

  function tool_list() {
    return {
      entry: agent.entry,
      files: state.files.map((f) => ({ path: f.name, lines: f.text.split("\n").length,
        locked: agent.mode === "holes" || agent_locked(f.name), holes: f.name.endsWith(".bend") ? holes_in(f.text) : [] })),
      hub: hub_imports().map((m) => "hub:" + m.rel),
      fillable: agent.mode === "holes" ? agent.holes.map((h) => "?" + h) : "any hole",
    };
  }

  function agent_text_of(path) {
    // Base reads like a file of its own, though no file holds it
    if (/^(hub:)?base(\.bend)?$/i.test(path)) {
      return Core.base_text();
    }
    if (path.startsWith("hub:")) {
      const text = hub.files[path.slice(4)];
      if (text === undefined) {
        throw new Error("no hub module " + path);
      }
      return text;
    }
    const f = state.files.find((x) => x.name === path);
    if (!f) {
      throw new Error("no file " + path + " (list_files gives the paths; Base is Base)");
    }
    return f.text;
  }

  function tool_read(input) {
    const path = String(input.path || "");
    const lines = agent_text_of(path).split("\n");
    const from = Math.max(1, Number(input.from_line) || 1);
    const to = Math.min(lines.length, Number(input.to_line) || lines.length, from + 399);
    return { path, from_line: from, to_line: to, total_lines: lines.length, text: lines.slice(from - 1, to).join("\n") };
  }

  // A module's declarations, by name: Base, a hub module, or a project file.
  function tool_symbols(input) {
    const mod = String(input.module || "").trim();
    let decls;
    if (mod === "Base" || mod === "") {
      decls = decls_of(null);
    } else if (mod.startsWith("hub:")) {
      if (hub.files[mod.slice(4)] === undefined) {
        throw new Error("no hub module " + mod);
      }
      decls = decls_of(mod);
    } else {
      if (!state.files.some((f) => f.name === mod)) {
        throw new Error("no file " + mod + " (list_files gives the paths; Base is Base)");
      }
      decls = decls_of(mod);
    }
    const prefix = String(input.prefix || "");
    const all = decls.filter((d) => d.name.startsWith(prefix)).map((d) => (d.kind === "ctor"
      ? { name: d.name, kind: "constructor", of: d.of, line: d.line } : { name: d.name, kind: d.kind, line: d.line }));
    const seen = new Set();
    const list = all.filter((x) => !seen.has(x.kind + " " + x.name) && seen.add(x.kind + " " + x.name));
    if (list.length > 300) {
      const heads = [...new Set(list.map((x) => x.name.split(".")[0]))].sort();
      return { module: mod || "Base", count: list.length, note: "too many to list: give a prefix", namespaces: heads };
    }
    return { module: mod || "Base", count: list.length, symbols: list };
  }

  // A declaration's type on one line, as the signature bar writes it.
  function sig_plain(d) {
    if (d.kind === "param") {
      return d.shown;
    }
    if (d.kind === "op") {
      return d.name;
    }
    const open = d.kind === "ctor" ? "{" : d.kind === "type" ? "<" : "(";
    const shut = d.kind === "ctor" ? "}" : d.kind === "type" ? ">" : ")";
    const list = d.kind === "type" && d.params.length === 0 ? "" : open + d.params.join(", ") + shut;
    return (d.kind === "ctor" ? "" : d.kind + " ") + d.name + list + d.tail;
  }

  function tool_signature(input) {
    const name = String(input.name || "").trim();
    const file = String(input.file || agent.entry);
    const text = file.startsWith("hub:") ? hub.files[file.slice(4)] || "" : (state.files.find((x) => x.name === file) || { text: "" }).text;
    const d = resolve(name, file, text);
    if (!d) {
      throw new Error("no declaration named " + name + " seen from " + file);
    }
    const out = { name: d.name, kind: d.kind === "ctor" ? "constructor" : d.kind, signature: sig_plain(d), from: sig_source(d) };
    if (d.kind === "ctor") {
      out.of = d.of;
    }
    // a def proven by a law of the same name: its type is the law's
    if (d.kind === "def" && d.tail === "") {
      const law = decls_of(d.file).find((x) => x.kind === "law" && x.name === d.name);
      if (law) {
        out.law = sig_plain(law);
      }
    }
    return out;
  }

  function tool_lookup(input) {
    const name = String(input.name || "").trim();
    const file = String(input.file || agent.entry);
    const text = file.startsWith("hub:") ? hub.files[file.slice(4)] || "" : (state.files.find((x) => x.name === file) || { text: "" }).text;
    const d = resolve(name, file, text);
    if (!d) {
      throw new Error("no declaration named " + name + " seen from " + file);
    }
    return { name: d.name, kind: d.kind, from: sig_source(d), line: d.line, doc: d.doc || undefined,
      text: d.text.split("\n").slice(0, 80).join("\n") };
  }

  function tool_guide(input) {
    const md = $("#bend-guide-md").textContent;
    const lines = md.split("\n");
    // a title is a # line outside code: Bend's own comments start with # too
    let fenced = false;
    const heads = [];
    lines.forEach((l, i) => {
      if (/^```/.test(l)) {
        fenced = !fenced;
      } else if (!fenced && /^#{1,3} /.test(l)) {
        heads.push([l, i]);
      }
    });
    const want = String(input.section || "").trim().toLowerCase();
    if (want === "") {
      return { sections: heads.map(([l]) => l.replace(/^#+ /, "")) };
    }
    const hit = heads.find(([l]) => l.toLowerCase().includes(want));
    if (!hit) {
      throw new Error("no section like '" + want + "'; call guide without a section for the titles");
    }
    const depth = /^#+/.exec(hit[0])[0].length;
    const next = heads.find(([l, i]) => i > hit[1] && /^#+/.exec(l)[0].length <= depth);
    return lines.slice(hit[1], next ? next[1] : lines.length).join("\n").slice(0, 12000);
  }

  function agent_file(path) {
    const f = state.files.find((x) => x.name === path);
    if (!f) {
      throw new Error("no file " + path);
    }
    if (agent.mode === "holes") {
      throw new Error("this session may only fill its holes, with fill_hole");
    }
    if (agent_locked(path)) {
      throw new Error(path + " is locked: the user does not want it changed");
    }
    return f;
  }

  async function tool_edit(input) {
    const f = agent_file(String(input.path || ""));
    const old = String(input.old_text ?? "");
    const rep = String(input.new_text ?? "");
    if (old === "") {
      throw new Error("old_text is empty: quote the exact text to replace");
    }
    const n = f.text.split(old).length - 1;
    if (n !== 1) {
      throw new Error(n === 0 ? "old_text does not occur in " + f.name + " (read_file it again)"
        : "old_text occurs " + n + " times in " + f.name + ": quote more of it");
    }
    agent_write(f, f.text.replace(old, () => rep));
    return agent_after();
  }

  async function tool_create(input) {
    if (agent.mode === "holes") {
      throw new Error("this session may only fill its holes, with fill_hole");
    }
    const path = String(input.path || "");
    if (name_ok(path, -1) !== "") {
      throw new Error(name_ok(path, -1));
    }
    state.files.push({ name: path, text: String(input.text ?? "") });
    agent.current.diff = { file: path, del: [], add: String(input.text ?? "").split("\n").slice(0, 30) };
    proj_touch();
    store_save();
    files_paint();
    return agent_after();
  }

  // The text with ?name replaced by code, indented as the hole is.
  function hole_fill(text, name, code) {
    const re = new RegExp("\\?" + name.replace(/[.$]/g, "\\$&") + "(?![\\w.])", "g");
    const all = [...text.matchAll(re)];
    if (all.length !== 1) {
      return all.length;
    }
    const at = all[0].index;
    const ls = text.lastIndexOf("\n", at - 1) + 1;
    const le = text.indexOf("\n", at) < 0 ? text.length : text.indexOf("\n", at);
    const line = text.slice(ls, le);
    const col = at - ls;
    const rows = String(code).replace(/\s+$/, "").split("\n");
    const common = Math.min(...rows.filter((l) => l.trim() !== "").map((l) => /^\s*/.exec(l)[0].length));
    const flat = rows.map((l) => l.slice(Math.min(common, l.length)));
    if (line.trim() === "?" + name) {
      const ind = /^\s*/.exec(line)[0];
      return text.slice(0, ls) + flat.map((l) => (l === "" ? "" : ind + l)).join("\n") + text.slice(le);
    }
    return text.slice(0, at) + flat.map((l, k) => (k === 0 ? l.trim() : " ".repeat(col) + l)).join("\n")
      + text.slice(at + name.length + 1);
  }

  async function tool_fill(input) {
    const name = String(input.hole || "").replace(/^\?/, "").trim();
    const code = String(input.code ?? "");
    if (agent.mode === "holes" && !agent.holes.includes(name)) {
      throw new Error("?" + name + " is not one of this session's holes: " + agent.holes.map((h) => "?" + h).join(", "));
    }
    if (agent.mode === "holes" && agent.close && /\?[A-Za-z_]/.test(code)) {
      throw new Error("each fill must close its goal: the code may not hold a ?hole");
    }
    if (code.trim() === "") {
      throw new Error("the code is empty");
    }
    const where = state.files.filter((f) => f.name.endsWith(".bend") && holes_in(f.text).includes(name));
    if (where.length !== 1) {
      throw new Error(where.length === 0 ? "no hole ?" + name + " in the project" : "?" + name + " is in several files");
    }
    const f = where[0];
    if (agent.mode !== "holes" && agent_locked(f.name)) {
      throw new Error(f.name + " is locked: the user does not want it changed");
    }
    const next = hole_fill(f.text, name, code);
    if (typeof next === "number") {
      throw new Error("?" + name + " occurs " + next + " times in " + f.name + ": fill_hole needs a hole that occurs once");
    }
    if (agent.mode === "holes") {
      // the holes the code leaves are the session's too
      for (const h of holes_in(code)) {
        if (!agent.holes.includes(h)) {
          agent.holes.push(h);
        }
      }
      agent.holes = agent.holes.filter((h) => h !== name || holes_in(code).includes(h));
    }
    agent_write(f, next);
    return agent_after();
  }

  // Writes a file as the agent: straight to the text (no keyboard on a
  // phone, no focus stolen), the session's snapshot standing for undo.
  function agent_write(f, next) {
    const prev = f.text;
    agent.writing = true;
    try {
      f.text = next;
      if (f === file_now() && view.hub === null) {
        const top = ed.box.scrollTop;
        ed.ta.value = next;
        ed.err = null;
        ed.err_line = 0;
        ed_paint();
        ed.box.scrollTop = top;
      }
      proj_touch();
      store_save();
    } finally {
      agent.writing = false;
    }
    agent.current.diff = line_diff(f.name, prev, next);
  }

  function line_diff(file, a, b) {
    const x = a.split("\n");
    const y = b.split("\n");
    let i = 0;
    while (i < x.length && i < y.length && x[i] === y[i]) {
      i++;
    }
    let j = 0;
    while (j < x.length - i && j < y.length - i && x[x.length - 1 - j] === y[y.length - 1 - j]) {
      j++;
    }
    return { file, line: i + 1, del: x.slice(i, x.length - j).slice(0, 30), add: y.slice(i, y.length - j).slice(0, 30) };
  }

  // The verdict after a write, for the agent and for the journal.
  async function agent_after() {
    const r = await comp_ask(agent.entry, false);
    const s = agent_summary(r);
    agent.current.verdict = s.verdict;
    if (agent.mode === "holes") {
      const left = agent.holes.filter((h) => state.files.some((f) => holes_in(f.text).includes(h)));
      s.your_holes_left = left.map((h) => "?" + h);
    }
    return { written: true, check: s };
  }

  function agent_summary(r) {
    const out = { verdict: r.ok ? r.text.split("\n")[0] : r.open ? "goals open" : "error" };
    if (r.ok && r.text.includes("\n")) {
      out.note = r.text.split("\n").slice(1).join("\n");
    }
    if (!r.ok && !r.open) {
      out.error = { file: r.where ? r.where.file : null, line: r.where ? r.where.line : null,
        col: r.where ? r.where.col : null, text: r.text.split("\n").slice(0, 14).join("\n") };
    }
    if (r.goals && r.goals.length > 0) {
      out.goals = r.goals.slice(0, 12).map((g) => ({ hole: "?" + g.name, file: g.file, line: g.line,
        context: g.ctx.map(([k, ty]) => ((g.quant && g.quant[k]) || "") + k + " : " + ty), goal: g.expected }));
      if (r.goals.length > 12) {
        out.more_goals = r.goals.length - 12;
      }
    }
    if (r.partial) {
      out.partial = "the file is slow to check: the goals past these were not collected";
    }
    return out;
  }

  async function tool_holes() {
    const r = await comp_ask(agent.entry, false);
    const goal = new Map((r.goals || []).map((g) => [g.file + ":" + g.line + ":" + g.name, g]));
    const why = r.ok || r.open ? (r.partial ? "the file is slow to check: the checker stopped collecting goals" : "")
      : "the checker stopped at an error first: " + err_brief(r);
    const out = [];
    for (const f of state.files.filter((x) => x.name.endsWith(".bend"))) {
      const count = new Map();
      for (const m of f.text.matchAll(/\?([A-Za-z_][\w.]*)/g)) {
        count.set(m[1], (count.get(m[1]) || 0) + 1);
      }
      f.text.split("\n").forEach((l, i) => {
        for (const m of l.matchAll(/\?([A-Za-z_][\w.]*)/g)) {
          if (l.slice(0, m.index).includes("#")) {
            continue;   // in a comment
          }
          const name = m[1];
          const g = goal.get(f.name + ":" + (i + 1) + ":" + name);
          const span = decl_span(f.name, i + 1);
          const decl = span ? decls_of(f.name).find((d) => d.line === span.from) : null;
          const fill = agent.mode === "holes" ? agent.holes.includes(name)
            : !agent_locked(f.name) && name !== "TODO" && count.get(name) === 1;
          const h = { hole: "?" + name, file: f.name, line: i + 1, col: m.index + 1, in: decl ? decl.name : null, fillable: fill };
          if (!fill) {
            h.why_not = agent.mode === "holes" ? "not one of this session's holes"
              : agent_locked(f.name) ? f.name + " is locked"
              : name === "TODO" ? "?TODO has no name of its own: give it one, or replace it with edit_file"
              : "?" + name + " occurs " + count.get(name) + " times: fill_hole needs a hole that occurs once";
          }
          if (g) {
            h.context = g.ctx.map(([k, ty]) => ((g.quant && g.quant[k]) || "") + k + " : " + ty);
            h.goal = g.expected;
          } else {
            h.goal = null;
            h.unreached = why || "not reached from " + agent.entry + ": check from the file that imports it";
          }
          out.push(h);
        }
      });
    }
    return { verdict: r.ok ? r.text.split("\n")[0] : r.open ? "goals open" : "error", holes: out.slice(0, 40),
      more: out.length > 40 ? out.length - 40 : undefined };
  }

  function agent_entry_of(input) {
    const file = String(input.file || agent.entry);
    if (!state.files.some((f) => f.name === file && f.name.endsWith(".bend"))) {
      throw new Error("no .bend file " + file + " in the project");
    }
    return file;
  }

  async function tool_check(input) {
    return agent_summary(await comp_ask(agent_entry_of(input), false));
  }

  // Runs compiled JS in a worker of its own, with a deadline; on the page
  // where there are no workers.
  function agent_run_js(js, args) {
    const cfg = { args, env: { USER: "bend", HOME: "/home", LANG: "en_US.UTF-8" } };
    return new Promise((done) => {
      let out = "";
      let err = "";
      let timer = 0;
      let w = null;
      let started = false;
      const t0 = performance.now();
      const put = (fd, text) => {
        if (fd === 2) {
          err += text;
        } else {
          out += text;
        }
      };
      const fin = (r) => {
        clearTimeout(timer);
        if (w !== null) {
          w.terminate();
        }
        done({ ...r, stdout: out.slice(0, 4000) + (out.length > 4000 ? "…[cut]" : ""),
          stderr: err.slice(0, 2000) || undefined, ms: Math.round(performance.now() - t0) });
      };
      const page = () => {
        w = null;
        run_page(js, cfg, put).then((g) => fin({ exit: g.code }), (e) => fin({ exit: 1, error: String(e) }));
      };
      try {
        const src = WORKER_HOST + "(" + JSON.stringify(cfg) + ");\n" + run_source(js, false) + "(__bendHost);";
        w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
      } catch (e) {
        page();
        return;
      }
      timer = setTimeout(() => fin({ exit: null, timed_out: true }), AGENT_RUN_MS);
      w.onmessage = (ev) => {
        const m = ev.data;
        if (m.start) {
          started = true;
        } else if (m.out) {
          m.out.forEach(([fd, text]) => put(fd, text));
        } else if (m.exit !== undefined) {
          fin({ exit: m.exit });
        }
      };
      w.onerror = (e) => {
        if (e.preventDefault) {
          e.preventDefault();
        }
        if (!started) {
          w.terminate();
          clearTimeout(timer);
          page();
        } else {
          put(2, (e.message || "the program crashed") + "\n");
          fin({ exit: 1 });
        }
      };
    });
  }

  async function agent_exec_main(file, files, args) {
    const r = await comp_ask(file, true, files);
    if (!r.ok) {
      return { compiled: false, check: agent_summary(r) };
    }
    if (!r.main) {
      throw new Error("no main in " + file);
    }
    if (r.value !== undefined) {
      return { value: r.value };
    }
    if (uses_window(r.js)) {
      throw new Error("this program opens a window: it can only run in the Screen tab, by the user");
    }
    return agent_run_js(r.js, args);
  }

  async function tool_run(input) {
    const file = agent_entry_of(input);
    const args = Array.isArray(input.args) ? input.args.map(String) : [];
    return agent_exec_main(file, files_map(), args);
  }

  async function tool_eval(input) {
    const file = agent_entry_of(input);
    const ty = String(input.type || "").replace(/\s*\n\s*/g, " ").trim();
    const expr = String(input.expr || "");
    if (ty === "" || expr.trim() === "") {
      throw new Error("eval needs an expression and its type");
    }
    // a copy of the file whose main is the expression; the file stays as it is
    const lines = agent_text_of(file).split("\n");
    const main = decls_of(file).find((d) => d.kind === "def" && d.name === "main");
    if (main) {
      lines.splice(main.line - 1, main.text.split("\n").length);
    }
    const body = expr.replace(/\s+$/, "").split("\n").map((l) => "  " + l.replace(/^\s{0,2}/, "")).join("\n");
    const copy = lines.join("\n").replace(/\s*$/, "") + "\n\ndef main() -> " + ty + ":\n" + body + "\n";
    const got = await agent_exec_main(file, { ...files_map(), [file]: copy }, []);
    if (got.compiled === false) {
      got.note = "the expression does not check here; its lines are the last of the file";
    }
    return got;
  }

  // The loop
  // --------

  function agent_log(e) {
    e.at = Date.now();
    agent.log.push(e);
    agent_paint_soon();
    return e;
  }

  function agent_clip(out) {
    const text = typeof out === "string" ? out : JSON.stringify(out, null, 1);
    const max = (agent.lim || agent_limits(ai_cfg())).result;
    return text.length > max ? text.slice(0, max) + "\n…[cut: ask for less]" : text;
  }

  // One tool call: counted, paused at the budget, run after the ones
  // before it, logged. {ok, text} for whoever asked.
  async function agent_exec(tool, input) {
    if (!agent.running) {
      return { ok: false, text: "the session was stopped" };
    }
    if (agent.steps >= agent.budget) {
      const go = await agent_pause();
      if (!go) {
        return { ok: false, text: "the user stopped the session" };
      }
    }
    agent.steps += 1;
    const step = agent.steps;
    const turn = agent.queue.then(async () => {
      const e = agent_log({ kind: "tool", name: tool.name, args: input || {}, state: "run" });
      agent.current = e;
      const t1 = performance.now();
      trace("tool_call", { step, name: tool.name, input: input || {} });
      let got;
      try {
        const out = await tool.run(input || {});
        e.state = "ok";
        e.result = out;
        got = { ok: true, text: agent_clip(out) };
      } catch (err) {
        e.state = "err";
        e.result = (err && err.message) || String(err);
        got = { ok: false, text: e.result };
      } finally {
        agent_paint_soon();
      }
      trace("tool_result", { step, name: tool.name, ok: got.ok, ms: Math.round(performance.now() - t1), result: got.text,
        diff: e.diff });
      mem_log("tool", tool.name + " " + JSON.stringify(input || {}) + "\n→ " + (got.ok ? "" : "error: ") + got.text);
      return got;
    });
    agent.queue = turn.catch(() => {});
    return turn;
  }

  function agent_pause() {
    return new Promise((done) => {
      agent.paused = (go) => {
        agent.paused = null;
        trace(go ? "continue" : "stop_at_pause", { steps: agent.steps });
        if (go) {
          agent.budget = agent.steps + agent.size;
        }
        agent_paint();
        done(go);
      };
      agent_log({ kind: "note", text: t("agent_paused", agent.steps) });
      trace("pause", { steps: agent.steps });
      agent_paint();
    });
  }

  // How a message ends: its last STATUS line (done, continue, blocked), or
  // "unclear" with none, or when the reply was cut.
  function agent_status(text, cut) {
    const all = [...String(text || "").matchAll(/STATUS:\s*\**\s*(done|continue|blocked)\b/gi)];
    return cut || all.length === 0 ? "unclear" : all[all.length - 1][1].toLowerCase();
  }

  // Why the agent's turn ended, in its own last words, for the brief of a
  // session taken up again. A stop or an error says so itself.
  function agent_why(text, cut) {
    if (!agent.running) {
      return;
    }
    const s = agent_status(text, cut);
    agent.status = s;
    agent.ended = s === "blocked" ? "you said you were blocked"
      : s === "continue" ? "you wanted to go on but called no tool"
        : s === "unclear" ? (cut ? "your reply was cut off" : "your message ended without a STATUS line") : "you said you were done";
  }

  // After a turn that ended by itself: should the page take it up again?
  // Unclear or continue, always; done, when the check says otherwise (an
  // error, or a hole of a hole session still open); blocked, never. Each
  // leg may do it AGENT_AGAIN times in a row without a tool call between.
  const AGENT_AGAIN = 3;

  async function agent_again() {
    if (!agent.running || !agent.auto || agent.status === "blocked") {
      return null;
    }
    const left = agent.mode === "holes" ? agent.holes.filter(hole_open) : [];
    if (agent.status === "unclear" || agent.status === "continue") {
      // a hole session with nothing left to fill is over, whatever it said
      return agent.mode === "holes" && left.length === 0 ? null : agent.ended;
    }
    if (left.length > 0) {
      return "you said you were done, but these holes are still open: " + left.map((h) => "?" + h).join(", ");
    }
    const r = await comp_ask(agent.entry, false);
    if (!r.ok && !r.open && !r.stopped) {
      return "you said you were done, but the check from " + agent.entry + " fails: " + err_brief(r);
    }
    return null;
  }

  const AGENT_REF = ["Syntax Reference", "Laws and Proofs"];

  // The rules of the brief: the page's, then the user's own (Settings),
  // which win where they disagree. Neither changes from call to call.
  function agent_rules(compact) {
    const rules = [
      "You are an agent at work in the Bend 2 workshop, a web page that runs Bend's own checker and compiler. Bend 2 is a functional language with dependent types, affine variables and a termination checker; its syntax is Python-shaped, its semantics close to Lean.",
      "Change the project only through your tools. Read before you edit; use lookup for the signature of any name you use, and guide for the syntax.",
      "What you may change is in <rights>, near the end: the user may change it between calls. Base (read_file \"Base\") and hub modules are read-only.",
      "Every write is checked at once and the verdict comes back to you. Rely on it: a proof counts only when the checker accepts it, the verdict reading ALL PROOFS CHECK. Never claim that something works unless a check or a run showed it.",
      "Prefer small steps: one hole, one lemma, one fix at a time, then look at the verdict. A ?name in the code prints its goal on the next check, with its context: use that to see what is wanted.",
      "<chat> is your memory: this project's whole chat with you, across sessions, oldest first, as one-line summaries. Each line id+n|text stands for the n messages from id on. Kinds: user (the user's words), agent (your replies), tool (your tool calls, each with what it returned), note (the page's records: sessions started and ended, final checks, undos). Recent lines cover one message each; the older, the more a line covers. A long message shows as its beginning, then (zoom for all). Its latest word on a thing is the truth, except for the files, which <files> gives as they stand now. zoom(id, n) opens line id+n into the two lines under it, zoom(id, 1) gives message id whole, and search(text) finds the messages that hold a text. Zoom whenever a line only mentions what you need (a past attempt, an error, a decision) before you act, guess or ask; do not redo what <chat> shows done.",
    ];
    if (compact) {
      rules.push("This call allows only a few tool rounds; the session goes on in further calls, each with your memory as it then stands. Spend the rounds on the work: a write, a check, a run.");
    }
    rules.push("End your final message with a last line that is exactly one of: STATUS: done (the task is done and the checker agrees), STATUS: continue (there is more to do and you will do it), STATUS: blocked (you cannot go on without the user: say why above it). Never stop without that line: a message without it, or with STATUS: continue, makes the page call you again. Say done only once a check shows the task done; say blocked only when the user must act or decide."
      + (compact ? " Before STATUS: continue, write a NEXT: section: the concrete steps still to take, starting with the very next tool call; it stays in your memory for the next call." : "")
      + " Write that message in " + LANG_NAMES[lang] + ".");
    const own = (state.ai.instructions || "").trim();
    if (own !== "") {
      rules.push("The user's own instructions, which take precedence over the rules above where they disagree:\n" + own);
    }
    return rules;
  }

  // What the agent is told: who it is, what it may do, the reference, its
  // memory (the view of the project's chat), the project as it stands, the
  // task. The rules and the reference never change, and the view grows only
  // at its end between merges, so the prompt's head stays cached. Kept under
  // the viewer's prompt size by leaving the files out when it must.
  function agent_brief(compact) {
    const lim = agent.lim || agent_limits(ai_cfg());
    const md = $("#bend-guide-md").textContent;
    const ref = compact ? AGENT_REF.map((s) => {
      try {
        return tool_guide({ section: s });
      } catch (e) {
        return "";
      }
    }).join("\n\n") : md;
    const locks = state.files.filter((f) => agent_locked(f.name)).map((f) => f.name);
    const rules = agent_rules(compact);
    const files = state.files.filter((f) => /\.(bend|js)$/.test(f.name));
    const size = files.reduce((n, f) => n + f.text.length, 0);
    const chat = agent.mem === null || agent.mem.msgs.length === 0 ? "(empty: this is the project's first message)" : mem_lines(agent.mem).join("\n");
    // the rights come late, so that changing them leaves the head of the
    // prompt (rules, reference, memory) as it was, cached
    const rights = agent.mode === "holes"
      ? "You may only fill these holes, with fill_hole: " + agent.holes.map((h) => "?" + h).join(", ") + ". Nothing else in the project can change."
        + (agent.close ? " Each fill must close its goal: the code may not hold a ?hole." : " The code may leave new holes ?name for sub-goals: they become yours to fill too.")
      : "You may change any file" + (locks.length ? " except these, locked by the user: " + locks.join(", ") : "") + ".";
    const build = (inline) => {
      const parts = [rules.join("\n\n"), "<bend_reference>\n" + ref + "\n</bend_reference>", "<chat>\n" + chat + "\n</chat>",
        "<state>\nChecks start from " + agent.entry + ".\n" + JSON.stringify(tool_list(), null, 1) + "\n</state>"];
      if (inline) {
        parts.push("<files>\nThe project as it stands now: no need to read these files again.\n"
          + files.map((f) => "<file path=\"" + f.name + "\">\n" + f.text + "\n</file>").join("\n") + "\n</files>");
      } else {
        parts.push("The files are too large to quote here: read them with read_file.");
      }
      parts.push("<rights>\n" + rights + "\n</rights>");
      if (agent.ended !== "") {
        // a session taken up again: why it stopped, and what the user says now
        parts.push("<resumed>\nThis session stopped once (" + agent.ended + ") and the user took it up again."
          + " The settings may have changed: the rules above are the ones that hold now."
          + (agent.notes.length ? "\nThe user's instructions for going on, latest last:\n" + agent.notes.map((n) => "- " + n).join("\n") : "")
          + "\n</resumed>");
      }
      parts.push("<task>\n" + agent.task + "\n</task>");
      return parts.join("\n\n");
    };
    let brief = build(size <= lim.files);
    if (compact && size <= lim.files && new TextEncoder().encode(brief).length > sample_bytes()) {
      brief = build(false);
    }
    return brief;
  }

  async function agent_claude(cfg) {
    const tools = agent_tools();
    for (;;) {
      const before = agent.steps;
      await agent_settle(cfg);
      const say = agent_log({ kind: "say", text: "" });
      const opts = { signal: agent.ctl.signal,
        onText: ({ text }) => {
          say.text = text;
          agent_paint_soon();
        },
        tools: tools.map((tl) => ({ name: tl.name, description: tl.description, inputSchema: tl.schema,
          execute: async (input) => {
            const got = await agent_exec(tl, input);
            if (!got.ok) {
              throw new Error(got.text);
            }
            return got.text;
          } })) };
      if (CLAUDE_TIERS.includes(cfg.model)) {
        opts.modelTier = cfg.model;
      }
      const prompt = agent_brief(true);
      const leg = agent.trace.filter((x) => x.type === "claude_call").length + 1;
      trace("claude_call", { leg, model_tier: opts.modelTier || "default", prompt }, say);
      let got;
      try {
        got = await ai.sample(prompt, opts);
      } catch (e) {
        trace("claude_error", { leg, code: e && e.code, message: e && e.message, text: e && e.text });
        throw e;
      }
      trace("claude_reply", { leg, text: got.text, truncated: got.truncated, status: agent_status(got.text, got.truncated) }, say);
      say.text = got.text;
      agent.last = got.text;
      if (got.text.trim()) {
        mem_log("agent", got.text);
      }
      if (!agent.running || agent_status(got.text, got.truncated) !== "continue" || agent.steps === before) {
        agent_why(got.text, got.truncated);
        return;
      }
      agent_log({ kind: "note", text: t("agent_again") });
    }
  }

  async function agent_post(url, headers, body) {
    const round = agent.trace.filter((x) => x.type === "api_request").length + 1;
    // the messages traced already, of this conversation (it restarts from
    // the memory when it grows too long: then system and tools again)
    const sent = agent.api_seen || 0;
    const req = { round, url, model: body.model, new_messages: body.messages.slice(sent) };
    agent.api_seen = body.messages.length;
    if (sent === 0) {
      req.system = body.system;
      req.tools = body.tools;
      req.max_tokens = body.max_tokens;
    }
    trace("api_request", req);
    let res;
    try {
      res = await fetch(url, { method: "POST", signal: agent.ctl.signal,
        headers: Object.assign({ "content-type": "application/json" }, headers), body: JSON.stringify(body) });
    } catch (e) {
      if (e && e.name === "AbortError") {
        throw { code: "cancelled", message: "" };
      }
      throw { code: "network", message: t("ai_no_network") };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      trace("api_error", { round, status: res.status, body: text.slice(0, 4000) });
      throw { code: "http", message: "HTTP " + res.status + (text ? ": " + text.slice(0, 300) : "") };
    }
    const data = await res.json();
    trace("api_response", { round, body: data });
    return data;
  }

  // One round with an API: the reply's text and its tool calls.
  async function agent_round(cfg, sys, msgs, tools) {
    const url = (cfg.url || AI_PROVIDERS[cfg.provider].url || "").replace(/\/+$/, "");
    const model = cfg.model || AI_PROVIDERS[cfg.provider].model || "";
    if (cfg.provider === "anthropic") {
      const tokens = agent_limits(cfg).tokens;
      const data = await agent_post(url + "/v1/messages", { "x-api-key": cfg.key, "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true" }, Object.assign({ model, max_tokens: tokens,
        // two cache points: the system (rules and guide), fixed, and the
        // turn's exchange, which the API's automatic point follows as it
        // grows; each request reads what the one before wrote
        cache_control: { type: "ephemeral" },
        system: [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }],
        tools: tools.map((tl) => ({ name: tl.name, description: tl.description, input_schema: tl.schema })), messages: msgs },
        agent_reasoning(cfg, model, tokens)));
      const blocks = data.content || [];
      return { text: blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n"), cut: data.stop_reason === "max_tokens",
        think: blocks.filter((b) => b.type === "thinking" && b.thinking).map((b) => b.thinking).join("\n\n"),
        calls: blocks.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input || {} })),
        said: { role: "assistant", content: blocks },
        answer: (rs) => [{ role: "user", content: rs.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.text, is_error: !r.ok })) }] };
    }
    const data = await agent_post(url + "/v1/chat/completions", cfg.key ? { authorization: "Bearer " + cfg.key } : {},
      Object.assign({ model, max_tokens: agent_limits(cfg).tokens, messages: [{ role: "system", content: sys }].concat(msgs),
        tools: tools.map((tl) => ({ type: "function", function: { name: tl.name, description: tl.description, parameters: tl.schema } })) },
        agent_reasoning(cfg, model, agent_limits(cfg).tokens)));
    const m = ((data.choices || [])[0] || {}).message || {};
    const calls = (m.tool_calls || []).map((c) => {
      let input = {};
      try {
        input = typeof c.function.arguments === "string" ? JSON.parse(c.function.arguments || "{}") : c.function.arguments || {};
      } catch (e) {
        input = { _unreadable: String(c.function.arguments) };
      }
      return { id: c.id, name: c.function && c.function.name, input };
    });
    const said = { role: "assistant", content: m.content || "" };
    if (m.tool_calls && m.tool_calls.length) {
      said.tool_calls = m.tool_calls;
    }
    return { text: m.content || "", calls, said, cut: ((data.choices || [])[0] || {}).finish_reason === "length",
      answer: (rs) => rs.map((r) => ({ role: "tool", tool_call_id: r.id, content: r.ok ? r.text : "Error: " + r.text })) };
  }

  // With an API the page runs the loop: the brief's head (rules and the
  // reference) is the system, cached; the rest, the first message. When a
  // turn's own exchange outgrows the memory's budget, it starts again from
  // the memory, where every step of it is logged.
  async function agent_api(cfg) {
    const tools = agent_tools();
    const lim = agent.lim || agent_limits(cfg);
    let sys = "";
    let msgs = [];
    const fresh = async (again) => {
      await agent_settle(cfg);
      const brief = agent_brief(false);
      const cut = brief.indexOf("<chat>");
      sys = brief.slice(0, cut);
      agent.api_seen = 0;
      msgs = [{ role: "user", content: brief.slice(cut) + (again ? "\n\n(Going on: what you did so far in this session is at the end of <chat>.)" : "") }];
    };
    await fresh(false);
    while (agent.running) {
      if (new TextEncoder().encode(JSON.stringify(msgs.slice(1))).length > lim.memory) {
        await fresh(true);
      }
      const say = agent_log({ kind: "say", text: t("ai_thinking") });
      let reply;
      try {
        reply = await agent_round(cfg, sys, msgs, tools);
      } catch (e) {
        agent.log.splice(agent.log.indexOf(say), 1);
        throw e;
      }
      say.text = reply.text;
      if (reply.think) {
        say.think = reply.think;
      }
      if (!reply.text.trim() && !reply.think) {
        agent.log.splice(agent.log.indexOf(say), 1);
      } else {
        mem_log("agent", reply.text);
      }
      agent.last = reply.text || agent.last;
      if (reply.calls.length === 0) {
        agent_why(reply.text, reply.cut);
        return;
      }
      msgs.push(reply.said);
      const rs = [];
      for (const c of reply.calls) {
        const tool = tools.find((tl) => tl.name === c.name);
        const got = tool ? await agent_exec(tool, c.input) : { ok: false, text: "no tool named " + c.name };
        rs.push({ id: c.id, ...got });
      }
      msgs.push(...reply.answer(rs));
    }
  }

  // What a session can be started or taken up with: a usable profile, a
  // .bend file to check from, holes for a hole session.
  function agent_ready() {
    const cfg = ai_cfg();
    if (!agent_ok() || cfg === null) {
      toast(t("agent_unavailable"));
      return null;
    }
    if (!state.files.some((x) => x.name === agent.entry && x.name.endsWith(".bend"))) {
      toast(t("no_bend"));
      return null;
    }
    if (agent.mode === "holes" && agent.holes.length === 0) {
      toast(t("agent_no_holes"));
      return null;
    }
    return cfg;
  }

  // The settings as they stand, for the trace (at the start, and at each
  // resumption, since they may have changed).
  function agent_settings(cfg) {
    return { mode: agent.mode, holes: agent.holes.slice(), close_goals: agent.close, entry: agent.entry,
      locks: (state.locks || []).slice(), budget: agent.size, language: lang, limits: agent_limits(cfg),
      profile: { name: cfg.name, provider: cfg.provider, model: cfg.model || AI_PROVIDERS[cfg.provider].model || "",
        url: cfg.provider === "custom" ? cfg.url : undefined },
      tools: agent_tools().map((tl) => ({ name: tl.name, description: tl.description, schema: tl.schema })),
      files: state.files.map((f) => ({ name: f.name, text: f.text })) };
  }

  // A session's settings, in a line of the memory.
  function mem_how(cfg) {
    const locks = (state.locks || []).filter((f) => state.files.some((x) => x.name === f));
    return "with " + cfg.name + ", checked from " + agent.entry + ", "
      + (agent.mode === "holes" ? "only the holes " + agent.holes.map((h) => "?" + h).join(", ") + (agent.close ? " (each fill must close its goal)" : "")
        : "the project" + (locks.length ? " but the locked " + locks.join(", ") : ""))
      + " to change, " + agent.size + " steps before a pause";
  }

  function agent_size() {
    agent.size = Math.max(1, Number(($("#agent-budget") || { value: agent.size }).value) || 20);
  }

  // Kept awake
  // ----------
  // A phone freezes a page it no longer shows, except one playing sound.
  // With the session's "keep running" setting, a sound too faint to hear
  // (noise of ±1 in 32767, not silence: Chrome exempts only a tab whose
  // sound it can measure) loops while the agent works; Android shows it
  // as media, with Stop. While the page is shown, a wake lock keeps the
  // screen on. All of it starts on the tap that starts the session, as
  // browsers require, and stops when the session ends.
  const keep = { audio: null, lock: null, url: null };

  function keep_wav() {
    if (keep.url !== null) {
      return keep.url;
    }
    const rate = 8000;
    const n = rate;
    const buf = new DataView(new ArrayBuffer(44 + n * 2));
    const str = (at, x) => [...x].forEach((ch, i) => buf.setUint8(at + i, ch.charCodeAt(0)));
    str(0, "RIFF");
    buf.setUint32(4, 36 + n * 2, true);
    str(8, "WAVEfmt ");
    buf.setUint32(16, 16, true);
    buf.setUint16(20, 1, true);
    buf.setUint16(22, 1, true);
    buf.setUint32(24, rate, true);
    buf.setUint32(28, rate * 2, true);
    buf.setUint16(32, 2, true);
    buf.setUint16(34, 16, true);
    str(36, "data");
    buf.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      buf.setInt16(44 + i * 2, i % 2 === 0 ? 1 : -1, true);
    }
    let bin = "";
    const bytes = new Uint8Array(buf.buffer);
    for (let i = 0; i < bytes.length; i += 8192) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    }
    keep.url = "data:audio/wav;base64," + btoa(bin);
    return keep.url;
  }

  async function keep_lock() {
    if (keep.audio !== null && document.visibilityState === "visible" && navigator.wakeLock && keep.lock === null) {
      try {
        keep.lock = await navigator.wakeLock.request("screen");
        keep.lock.addEventListener("release", () => { keep.lock = null; });
      } catch (e) {
        keep.lock = null;
      }
    }
  }

  document.addEventListener("visibilitychange", keep_lock);

  // Called on the tap itself, before anything awaits.
  function keep_on() {
    if (!agent.keep || keep.audio !== null) {
      return;
    }
    try {
      const a = new Audio(keep_wav());
      a.loop = true;
      keep.audio = a;
      a.play().catch(() => {
        toast(t("keep_refused"));
        keep_off();
      });
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: t("keep_title"), artist: "Bend workshop" });
        for (const act of ["stop", "pause"]) {
          try {
            navigator.mediaSession.setActionHandler(act, () => agent_stop());
          } catch (e) {}
        }
      }
    } catch (e) {
      keep.audio = null;
    }
    keep_lock();
    agent_paint_soon();
  }

  function keep_off() {
    if (keep.audio !== null) {
      keep.audio.pause();
      keep.audio.removeAttribute("src");
      keep.audio = null;
    }
    if (keep.lock !== null) {
      keep.lock.release().catch(() => {});
      keep.lock = null;
    }
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = null;
      for (const act of ["stop", "pause"]) {
        try {
          navigator.mediaSession.setActionHandler(act, null);
        } catch (e) {}
      }
    }
  }

  async function agent_start() {
    if (agent.running) {
      return;
    }
    const cfg = agent_ready();
    if (cfg === null) {
      return;
    }
    keep_on();
    const task = ($("#agent-task") || { value: "" }).value.trim();
    agent.task = task || (agent.mode === "holes" ? t("agent_task_holes", agent.holes.map((h) => "?" + h).join(", "))
      : t("agent_task_default"));
    agent_size();
    Object.assign(agent, { done: false, steps: 0, log: [], last: "", notes: [], ended: "", note_draft: "",
      before: work_snapshot(), proj: state.id, trace: [], t0: performance.now(), wall: Date.now() });
    agent.mem = await mem_open(state.id);
    trace("session", Object.assign({ started: new Date(agent.wall).toISOString(), bend: Core.VERSION + " (" + Core.COMMIT + ")",
      task: agent.task, memory: agent.mem.msgs.length }, agent_settings(cfg)));
    agent_log({ kind: "note", text: t("agent_started", cfg.name) });
    mem_log("note", "A session starts, " + mem_how(cfg) + ".");
    mem_log("user", agent.task);
    await agent_go(cfg);
  }

  // Takes a session up again where it stopped (an error, a stop, the agent
  // done or blocked), with settings the user may have changed and a word
  // on what to do now. The journal, the trace and the snapshot of the start
  // carry on: Undo still goes back to before the whole session. Each
  // resumption starts from a fresh brief (the project as it stands, the
  // journal, the user's words), with Claude as with an API: a conversation
  // that broke, or grew too long, is not sent again.
  async function agent_resume() {
    if (agent.running || !agent.done) {
      return;
    }
    agent.holes = agent.holes.filter(hole_open);
    const cfg = agent_ready();
    if (cfg === null) {
      return;
    }
    keep_on();
    const note = ($("#agent-note") || { value: "" }).value.trim();
    if (note !== "") {
      agent.notes.push(note);
    }
    agent.note_draft = "";
    agent_size();
    agent.done = false;
    agent.mem = await mem_open(agent.proj);
    mem_log("note", "The user takes the session up again (it had stopped: " + agent.ended + "), " + mem_how(cfg) + ".");
    mem_log("user", note || "Go on.");
    trace("resume", Object.assign({ note, ended: agent.ended }, agent_settings(cfg)));
    agent_log({ kind: "note", text: t("agent_resumed", cfg.name) });
    if (note !== "") {
      agent_log({ kind: "note", text: "» " + note });
    }
    await agent_go(cfg);
  }

  // One leg of a session, from the start or from a resumption, to its end.
  async function agent_go(cfg) {
    // the limits hold for the whole leg, whatever profile Settings makes
    // active meanwhile
    Object.assign(agent, { running: true, budget: agent.steps + agent.size, ctl: new AbortController(), queue: Promise.resolve(),
      lim: agent_limits(cfg) });
    snap_take("snap_agent", true);
    ed.ta.readOnly = true;
    document.body.classList.add("agent-busy");
    agent_paint();
    try {
      // a turn that ends unclear, or done while the check disagrees, is
      // taken up again by the page itself, a few times in a row at most
      for (let left = AGENT_AGAIN; ;) {
        const before = agent.steps;
        agent.status = "";
        if (cfg.provider === "claude") {
          await agent_claude(cfg);
        } else {
          await agent_api(cfg);
        }
        const why = await agent_again();
        left = agent.steps > before ? AGENT_AGAIN : left - 1;
        if (why === null || left <= 0) {
          break;
        }
        agent.ended = why;
        agent.auto_n = (agent.auto_n || 0) + 1;
        trace("auto_resume", { why, left });
        agent_log({ kind: "note", text: t("agent_auto_again", why) });
        mem_log("note", "The page takes the session up again by itself: " + why + ".");
      }
    } catch (e) {
      if (!(e && e.code === "cancelled")) {
        agent_log({ kind: "err", text: ai_error(e) });
        agent.ended = "an error ended it: " + String(ai_error(e)).slice(0, 300);
      }
      trace("error", { code: e && e.code, message: (e && e.message) || String(e) });
    } finally {
      agent.running = false;
      keep_off();
      if (agent.paused) {
        agent.paused(false);
      }
      ed.ta.readOnly = view.hub !== null;
      document.body.classList.remove("agent-busy");
      if (agent.ended === "") {
        agent.ended = "it ended without a word";
      }
      const r = await comp_ask(agent.entry, false);
      agent_log({ kind: "verdict", ok: !!r.ok && !/^SOME/.test(r.text), open: !!r.open,
        text: r.ok ? r.text.split("\n")[0] : r.open ? open_brief(r) : err_brief(r) });
      mem_log("note", "The session ends after " + agent.steps + " steps (" + agent.ended + "). Final check from " + agent.entry + ": "
        + (r.ok ? r.text.split("\n")[0] : r.open ? open_brief(r) : err_brief(r)));
      trace("end", { steps: agent.steps, verdict: r.text, files: state.files.map((f) => ({ name: f.name, text: f.text })) });
      // the same record as the session goes on: one session, one entry
      ses_put({ id: agent.wall, started: new Date(agent.wall).toISOString(), task: agent.task, mode: agent.mode,
        profile: cfg.name, entry: agent.entry, steps: agent.steps, ok: !!r.ok && !/^SOME/.test(r.text),
        open: !!r.open, verdict: r.ok ? r.text.split("\n")[0] : r.open ? open_brief(r) : err_brief(r),
        trace: agent.trace, log: agent.log,
        resume: { proj: agent.proj, before: agent.before, holes: agent.holes, close: agent.close, size: agent.size,
          notes: agent.notes, ended: agent.ended, last: agent.last } });
      agent.done = true;
      agent_paint();
      live_soon();
      const changed = JSON.stringify(JSON.parse(agent.before).files) !== JSON.stringify(state.files);
      if (changed) {
        toast(t("agent_done"), t("undo"), agent_undo);
      }
    }
  }

  // A past session of the open project, taken up again: it becomes the
  // session in the tab, ready for Continue.
  function ses_take(r) {
    const k = r.resume;
    const last = r.trace.length ? r.trace[r.trace.length - 1].t : 0;
    Object.assign(agent, { mode: r.mode, entry: r.entry, task: r.task, steps: r.steps, log: r.log, trace: r.trace,
      wall: r.id, t0: performance.now() - last - 1000, before: k.before, proj: k.proj, holes: k.holes.slice(),
      close: k.close, size: k.size, notes: k.notes.slice(), ended: k.ended, last: k.last, done: true, note_draft: "" });
    ses.view = null;
    conv.key = "";
    agent_paint();
  }

  function agent_stop() {
    if (agent.paused) {
      agent.paused(false);
    }
    if (agent.ctl) {
      agent.ctl.abort();
    }
    if (agent.running) {
      agent.ended = "the user stopped it";
    }
    agent.running = false;
    agent_log({ kind: "note", text: t("agent_stopped") });
    trace("stop", { steps: agent.steps });
  }

  function agent_undo() {
    if (agent.before === null || agent.running) {
      return;
    }
    work_restore(agent.before);
    store_save();
    trace("undo", {});
    mem_log("note", "The user undid the session: the files are back as they were before it started.");
    agent_log({ kind: "note", text: t("agent_undone") });
    toast(t("agent_undone"));
  }

  // Where a session starts: from a goal card (that hole), from an error
  // (the project), or from the tab itself.
  function agent_open(opts) {
    if (agent.running) {
      tab_set("agent");
      return;
    }
    agent.mode = opts.mode || "project";
    agent.holes = (opts.holes || []).slice();
    agent.entry = opts.entry || agent_default_entry();
    agent.done = false;
    agent.log = [];
    agent.draft = opts.task || "";
    $(".tab[data-tab=agent]").hidden = false;
    tab_set("agent");
    if (!WIDE.matches) {
      panel_set("full");
    }
  }

  function agent_default_entry() {
    const bends = state.files.filter((f) => f.name.endsWith(".bend")).map((f) => f.name);
    const open = file_now();
    if (bends.includes("PROOF.bend")) {
      return "PROOF.bend";
    }
    return !open.ro && bends.includes(open.name) ? open.name : bends[0] || "";
  }

  // Export
  // ------

  function agent_stamp(wall) {
    const d = new Date(wall || agent.wall || Date.now());
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
  }

  async function agent_export(fmt, trace, wall) {
    trace = trace || agent.trace;
    if (trace.length === 0) {
      return;
    }
    const name = "agent-session-" + agent_stamp(wall) + "." + fmt;
    const data = fmt === "json"
      ? JSON.stringify({ format: "bend-workshop/agent-session/1", events: trace }, null, 1)
      : agent_markdown(trace);
    try {
      await save_file(name, data);
    } catch (e) {
      toast(save_error(e));
    }
  }

  // A fence longer than any run of backticks inside the text.
  function fence(text, kind) {
    const runs = (String(text).match(/`+/g) || []).map((x) => x.length);
    const f = "`".repeat(Math.max(3, ...runs.map((n) => n + 1)));
    return f + (kind || "") + "\n" + text + "\n" + f;
  }

  function agent_markdown(trace) {
    const out = [];
    const json = (x) => fence(JSON.stringify(x, null, 1), "json");
    for (const e of trace || agent.trace) {
      const at = "+" + (e.t / 1000).toFixed(1) + " s";
      if (e.type === "session") {
        out.push("# Agent session, " + e.started, "",
          "- Bend " + e.bend + ", profile " + e.profile.name + " (" + e.profile.provider + (e.profile.model ? ", " + e.profile.model : "") + ")",
          "- Mode: " + e.mode + (e.mode === "holes" ? " " + e.holes.map((h) => "?" + h).join(", ") + (e.close_goals ? ", each fill must close its goal" : ", sub-holes allowed") : "")
            + "; checked from " + e.entry + "; locked: " + (e.locks.length ? e.locks.join(", ") : "none") + "; steps before pausing: " + e.budget,
          "", "## Task", "", e.task, "", "## Tools offered", "", json(e.tools), "", "## Files at the start", "");
        for (const f of e.files) {
          out.push("### " + f.name, "", fence(f.text, f.name.endsWith(".js") ? "js" : "python"), "");
        }
        out.push("## Conversation", "");
      } else if (e.type === "resume") {
        out.push("## Resumed, " + at, "",
          "- The previous leg ended: " + e.ended,
          "- Profile " + e.profile.name + " (" + e.profile.provider + (e.profile.model ? ", " + e.profile.model : "") + ")",
          "- Mode: " + e.mode + (e.mode === "holes" ? " " + e.holes.map((h) => "?" + h).join(", ") + (e.close_goals ? ", each fill must close its goal" : ", sub-holes allowed") : "")
            + "; checked from " + e.entry + "; locked: " + (e.locks.length ? e.locks.join(", ") : "none") + "; steps before pausing: " + e.budget,
          "", "### Instructions for going on", "", e.note || "(none)", "", "### Tools offered", "", json(e.tools), "", "### Files at the resumption", "");
        for (const f of e.files) {
          out.push("#### " + f.name, "", fence(f.text, f.name.endsWith(".js") ? "js" : "python"), "");
        }
      } else if (e.type === "claude_call") {
        out.push("### Call " + e.leg + " to Claude (" + e.model_tier + "), " + at, "", "Prompt:", "", fence(e.prompt, "text"), "");
      } else if (e.type === "claude_reply") {
        out.push("### Claude's answer to call " + e.leg + ", " + at + (e.truncated ? " (truncated)" : ""), "", fence(e.text, "text"), "");
      } else if (e.type === "claude_error" || e.type === "api_error" || e.type === "error") {
        out.push("### Error, " + at, "", json(e), "");
      } else if (e.type === "api_request") {
        out.push("### Request " + e.round + " to " + e.url + " (" + e.model + "), " + at, "");
        if (e.system !== undefined) {
          out.push("System:", "", fence(typeof e.system === "string" ? e.system : JSON.stringify(e.system, null, 1), "text"), "",
            "Tools:", "", json(e.tools), "");
        }
        out.push("Messages sent this round:", "", json(e.new_messages), "");
      } else if (e.type === "api_response") {
        out.push("### Response " + e.round + ", " + at, "", json(e.body), "");
      } else if (e.type === "tool_call") {
        out.push("#### Step " + e.step + ": " + e.name + ", " + at, "", json(e.input), "");
      } else if (e.type === "tool_result") {
        out.push((e.ok ? "Result" : "Error") + " (" + e.ms + " ms):", "", fence(e.result, "json"), "");
        if (e.diff) {
          out.push("Change to " + e.diff.file + ":", "",
            fence(e.diff.del.map((l) => "- " + l).concat(e.diff.add.map((l) => "+ " + l)).join("\n"), "diff"), "");
        }
      } else if (e.type === "end") {
        out.push("## End, " + at, "", "After " + e.steps + " steps. Final check:", "", fence(e.verdict, "text"), "", "## Files at the end", "");
        for (const f of e.files) {
          out.push("### " + f.name, "", fence(f.text, f.name.endsWith(".js") ? "js" : "python"), "");
        }
      } else {
        out.push("*" + e.type + (e.steps !== undefined ? " after " + e.steps + " steps" : "") + ", " + at + "*", "");
      }
    }
    return out.join("\n");
  }


  // Sessions
  // --------
  // Every finished session is kept in this browser (IndexedDB), the last 20,
  // with its whole trace and journal, to be read or exported later.

  const SES_KEEP = 20;
  const ses = { db: null, list: null, view: null, mode: "journal" };

  function ses_db() {
    if (ses.db === null) {
      ses.db = new Promise((done) => {
        try {
          // 1: the past sessions; 2: the agent's memory, a chat per project;
          // 3: a git repository per project
          const req = indexedDB.open("bend-workshop", 3);
          req.onupgradeneeded = () => {
            for (const name of ["sessions", "chats", "git"]) {
              if (!req.result.objectStoreNames.contains(name)) {
                req.result.createObjectStore(name, { keyPath: "id" });
              }
            }
          };
          // a tab of an older page holding the database open blocks the
          // upgrade: wait for it (it closes on versionchange, below) rather
          // than give up, which would leave the memory unsaved
          req.onsuccess = () => {
            const db = req.result;
            db.onversionchange = () => {
              db.close();
              ses.db = null;
            };
            done(db);
          };
          req.onerror = () => done(null);
          req.onblocked = () => setTimeout(() => done(null), 15000);
        } catch (e) {
          done(null);
        }
      });
    }
    return ses.db;
  }

  function ses_req(mode, fn, store = "sessions") {
    return ses_db().then((db) => new Promise((done) => {
      if (db === null) {
        done(null);
        return;
      }
      try {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => done(req ? req.result : true);
        tx.onerror = () => done(null);
      } catch (e) {
        done(null);
      }
    }));
  }

  async function ses_load() {
    const all = await ses_req("readonly", (st) => st.getAll());
    ses.list = (all || []).sort((a, b) => b.id - a.id);
    return ses.list;
  }

  async function ses_put(rec) {
    // a trace is plain data, but a journal entry may hold what no clone takes
    const clean = JSON.parse(JSON.stringify(rec));
    await ses_req("readwrite", (st) => st.put(clean));
    const all = await ses_load();
    for (const old of all.slice(SES_KEEP)) {
      await ses_req("readwrite", (st) => st.delete(old.id));
    }
    await ses_load();
    agent_paint_soon();
  }

  async function ses_del(id) {
    await ses_req("readwrite", (st) => st.delete(id));
    await ses_load();
  }

  function ses_list() {
    const box = el("details", { class: "ses-list" });
    const n = ses.list === null ? "…" : String(ses.list.length);
    box.append(el("summary", { text: t("ses_title", n) }));
    if (ses.list === null) {
      ses_load().then(() => agent_paint_soon());
      return box;
    }
    if (ses.list.length === 0) {
      box.append(el("small", { text: t("ses_none") }));
    }
    for (const r of ses.list) {
      box.append(el("button", { class: "ses-row", type: "button", onclick: () => {
        ses.view = r;
        conv.key = "";
        agent_paint();
      } }, el("span", { class: "ses-mark " + (r.ok ? "ok" : r.open ? "goal" : "bad"), text: r.ok ? "∎" : r.open ? "?" : "✗" }),
        el("span", { class: "ses-when", text: when(r.id) }),
        el("span", { class: "ses-task", text: r.task.split("\n")[0] }),
        el("span", { class: "ses-meta", text: t("ses_meta", r.steps, r.profile) })));
    }
    box.append(el("small", { text: t("ses_hint", SES_KEEP) }));
    return box;
  }

  // Conversation
  // ------------
  // The trace as it happened, every message whole, the long ones folded;
  // appended to as the session goes, so folds opened stay open.

  const conv = { el: null, key: "", n: 0, ids: {}, start: null, tools: null, wall: 0 };

  function kb(n) {
    return (n / 1024).toFixed(1).replace(".", t("decimal")) + " " + t("kb");
  }

  // Calls, sizes both ways, tokens when the API reported them, duration.
  function conv_stats(trace) {
    let calls = 0;
    let sent = 0;
    let got = 0;
    let tin = 0;
    let tout = 0;
    let usage = false;
    for (const e of trace) {
      if (e.type === "claude_call") {
        calls += 1;
        sent += e.prompt.length;
      } else if (e.type === "claude_reply") {
        got += (e.text || "").length;
      } else if (e.type === "api_request") {
        calls += 1;
        sent += JSON.stringify(e.new_messages).length + (e.system ? JSON.stringify(e.system).length : 0);
      } else if (e.type === "api_response") {
        got += JSON.stringify(e.body).length;
        const u = e.body && e.body.usage;
        if (u) {
          usage = true;
          tin += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.prompt_tokens || 0);
          tout += (u.output_tokens || 0) + (u.completion_tokens || 0);
        }
      }
    }
    const last = trace.length ? trace[trace.length - 1].t : 0;
    return t("conv_stats", calls, kb(sent), kb(got), (last / 1000).toFixed(1).replace(".", t("decimal")))
      + (usage ? t("conv_tokens", tin, tout) : "");
  }

  function conv_view(trace, key, wall) {
    conv.wall = wall;
    if (conv.el === null || conv.key !== key || conv.n > trace.length) {
      conv.el = el("div", { class: "conv" });
      conv.key = key;
      conv.n = 0;
      conv.ids = {};
      conv.start = null;
      conv.tools = null;
    }
    // newest first, as the journal
    for (; conv.n < trace.length; conv.n++) {
      const row = conv_event(trace[conv.n]);
      const j = trace[conv.n].j;
      if (j !== undefined) {
        row.firstChild.append(" ", el("button", { class: "cv-to-j", type: "button", text: t("cv_to_journal"), onclick: () => {
          agent.open.add(conv.wall + ":" + j);
          agent.jump = j;
          ses.mode = "journal";
          agent_paint();
        } }));
      }
      conv.el.prepend(row);
    }
    return conv.el;
  }

  // A fold whose body is built when it is first opened.
  function fold(summary, body, open) {
    const d = el("details", { class: "cv-fold" }, el("summary", { text: summary }));
    let filled = false;
    const fill = () => {
      if (!filled) {
        filled = true;
        d.append(body());
      }
    };
    d.addEventListener("toggle", () => d.open && fill());
    d._fill = fill;
    if (open) {
      d.open = true;
      fill();
    }
    return d;
  }

  function cv_pre(text) {
    return el("pre", { class: "cv-pre", text: typeof text === "string" ? text : JSON.stringify(text, null, 1) });
  }

  // Long text folded, short text shown.
  function cv_text(text, label) {
    const s = String(text);
    return s.length > 600 ? fold(label || t("conv_result_size", kb(s.length)), () => cv_pre(s)) : cv_pre(s);
  }

  // Code as the editor shows it: highlighted, its lines numbered.
  function cv_code(text, name) {
    const src = String(text);
    const html = /\.(js|mjs)$/.test(name || "") ? highlight_js(src) : /\.bend$|^bend$/.test(name || "") ? highlight(src) : esc(src);
    const n = src.split("\n").length;
    return el("div", { class: "cv-code" },
      el("pre", { class: "cv-gut", "aria-hidden": "true", text: Array.from({ length: n }, (_, i) => i + 1).join("\n") }),
      el("pre", { class: "cv-src", html }));
  }

  function cv_badge(kind, text) {
    return el("span", { class: "cv-badge " + kind, text });
  }

  // The lines that differ between two texts, as one hunk, as the journal
  // shows a write.
  function cv_diff(a, b) {
    const x = a.split("\n");
    const y = b.split("\n");
    let i = 0;
    while (i < x.length && i < y.length && x[i] === y[i]) {
      i++;
    }
    let j = 0;
    while (j < x.length - i && j < y.length - i && x[x.length - 1 - j] === y[y.length - 1 - j]) {
      j++;
    }
    const box = el("pre", { class: "ag-diff cv-diff" }, el("div", { class: "cv-hunk", text: "@@ " + t("conv_line", i + 1) }));
    for (const l of x.slice(i, x.length - j).slice(0, 400)) {
      box.append(el("div", { class: "del", text: "- " + l }));
    }
    for (const l of y.slice(i, y.length - j).slice(0, 400)) {
      box.append(el("div", { class: "add", text: "+ " + l }));
    }
    return box;
  }

  // The project's files, one fold each; against base (the files at the
  // start), each says whether it is new or changed, and how.
  function cv_files(files, base) {
    const was = base ? new Map(base.map((f) => [f.name, f.text])) : null;
    const changed = was ? files.filter((f) => was.get(f.name) !== f.text).length : 0;
    return fold(t("conv_files", files.length) + (changed ? " · " + t("conv_n_changed", changed) : ""), () => {
      const list = el("div", { class: "cv-list" });
      for (const f of files) {
        const old = was ? was.get(f.name) : undefined;
        const state = !was ? "" : old === undefined ? "new" : old === f.text ? "" : "changed";
        const head = el("span", {}, el("span", { class: "cv-name", text: f.name }), " ",
          el("span", { class: "dim", text: t("conv_lines", f.text.split("\n").length) }),
          state ? cv_badge(state, t("conv_" + state)) : null);
        const d = el("details", { class: "cv-fold cv-file" }, el("summary", {}, head));
        let filled = false;
        d.addEventListener("toggle", () => {
          if (d.open && !filled) {
            filled = true;
            if (state === "changed") {
              d.append(cv_diff(old, f.text), fold(t("conv_whole"), () => cv_code(f.text, f.name)));
            } else {
              d.append(cv_code(f.text, f.name));
            }
          }
        });
        list.append(d);
      }
      return list;
    });
  }

  // The tools offered, one fold each: what it does, what it takes. Against
  // the tools of before (a resumption), what came and went.
  function cv_tools(tools, prev) {
    const names = tools.map((x) => x.name);
    const had = prev ? prev.map((x) => x.name) : names;
    const add = names.filter((n) => !had.includes(n));
    const gone = had.filter((n) => !names.includes(n));
    const delta = (add.length ? " · +" + add.join(", +") : "") + (gone.length ? " · −" + gone.join(", −") : "");
    return fold(t("conv_tools", tools.length) + delta, () => {
      const list = el("div", { class: "cv-list" });
      for (const tl of tools) {
        const sc = tl.schema || tl.input_schema || (tl.function && tl.function.parameters) || {};
        const name = tl.name || (tl.function && tl.function.name);
        const desc = tl.description || (tl.function && tl.function.description) || "";
        const props = Object.entries(sc.properties || {});
        const req = sc.required || [];
        const sig = name + "(" + props.map(([k]) => k + (req.includes(k) ? "" : "?")).join(", ") + ")";
        list.append(fold(sig, () => {
          const body = el("div", { class: "cv-tool-doc" }, el("p", { text: desc }));
          if (props.length) {
            const tb = el("table", { class: "cv-params" });
            for (const [k, v] of props) {
              tb.append(el("tr", {}, el("td", { class: "cv-name", text: k }),
                el("td", { class: "dim", text: (v.type || "") + (v.items ? "<" + v.items.type + ">" : "") }),
                el("td", { text: req.includes(k) ? t("conv_required") : t("conv_optional") })));
            }
            body.append(tb);
          } else {
            body.append(el("small", { class: "dim", text: t("conv_no_params") }));
          }
          return body;
        }));
      }
      return list;
    });
  }

  // A brief, split into its sections: the rules, the task, the project
  // (its files one by one), what was done so far, the reference.
  const BRIEF_OPEN = new Set(["task", "resumed", "so_far"]);

  function cv_brief(text) {
    const box = el("div", { class: "cv-brief" });
    const re = /<(task|resumed|chat|state|files|so_far|bend_reference)>\n?([\s\S]*?)\n?<\/\1>/g;
    let at = 0;
    const loose = (s) => {
      if (s.trim()) {
        box.append(fold(t("conv_sec_rules") + ", " + kb(s.length), () => cv_pre(s.trim())));
      }
    };
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      loose(text.slice(at, m.index));
      at = m.index + m[0].length;
      const tag = m[1];
      const body = m[2];
      const title = t("conv_sec_" + tag);
      if (tag === "files") {
        const files = [...body.matchAll(/<file path="([^"]*)">\n?([\s\S]*?)\n?<\/file>/g)].map((x) => ({ name: x[1], text: x[2] }));
        box.append(cv_files(files, null));
      } else if (BRIEF_OPEN.has(tag)) {
        box.append(el("div", { class: "cv-sec" }, el("div", { class: "cv-sec-head", text: title }), cv_pre(body)));
      } else {
        box.append(fold(title + ", " + kb(body.length), () => {
          const json = body.indexOf("{");
          if (tag === "state" && json >= 0) {
            try {
              return el("div", {}, cv_pre(body.slice(0, json).trim()), cv_pre(JSON.parse(body.slice(json))));
            } catch (e) {
              return cv_pre(body);
            }
          }
          return cv_pre(body);
        }));
      }
    }
    loose(text.slice(at));
    return box;
  }

  // A tool's input, field by field; code shown as code.
  const CODE_KEYS = new Set(["code", "text", "new_text", "old_text", "expr"]);

  function cv_input(input) {
    const box = el("div", { class: "cv-kv" });
    const lang = /\.js$/.test(String(input.path || input.file || "")) ? "x.js" : "bend";
    for (const [k, v] of Object.entries(input || {})) {
      const code = typeof v === "string" && (CODE_KEYS.has(k) || v.includes("\n"));
      box.append(el("div", { class: "cv-k", text: k }),
        code ? cv_code(v, lang) : el("div", { class: "cv-v", text: typeof v === "string" ? v : JSON.stringify(v) }));
    }
    return Object.keys(input || {}).length ? box : el("small", { class: "dim", text: t("conv_no_input") });
  }

  function cv_call(name, input) {
    return el("div", { class: "cv-call" }, el("div", { class: "cv-call-head", text: "⚙ " + name }), cv_input(input));
  }

  // A tool's answer: its verdict up front when it carries one.
  function cv_result(text, ok, name) {
    let obj = null;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      obj = null;
    }
    const v = obj && typeof obj === "object" ? obj.verdict || (obj.check && obj.check.verdict) : null;
    const head = el("div", { class: "cv-call-head" }, name ? "↳ " + name + " " : "",
      ok ? null : cv_badge("bad", t("conv_failed")),
      v ? cv_badge(/^ALL|^PASS/.test(v) ? "ok" : /goal/.test(v) ? "goal" : "bad", v) : null);
    const s = obj && typeof obj === "object" ? JSON.stringify(obj, null, 1) : String(text);
    return el("div", { class: "cv-result" + (ok ? "" : " err") }, head, cv_text(s));
  }

  // Messages as cards: who speaks, what is said, the tools called and
  // their answers. Anthropic's blocks and OpenAI's messages alike.
  // In a request, the model's own replies are sent back as they came: they
  // were shown with the response, so here they fold (echo).
  function cv_msgs(msgs, echo) {
    const list = el("div", { class: "cv-list" });
    for (const m of msgs) {
      if (echo && m.role === "assistant") {
        list.append(fold(t("conv_echo"), () => cv_msgs([m], false)));
        continue;
      }
      const card = el("div", { class: "cv-msg " + m.role }, el("div", { class: "cv-role", text: t("conv_role_" + m.role) }));
      // a tool's answer sent back was shown at its step: folded here
      const answer = (text, ok, name) => {
        if (!echo) {
          return cv_result(text, ok, name);
        }
        let v = "";
        try {
          const o = JSON.parse(text);
          v = (o && (o.verdict || (o.check && o.check.verdict))) || "";
        } catch (e) {
          v = "";
        }
        return fold(t("conv_echo_result", name || "?", ok ? v : t("conv_failed")), () => cv_result(text, ok, name));
      };
      const said = (s) => {
        if (/<task>|<bend_reference>/.test(s)) {
          card.append(cv_brief(s));
        } else if (s.trim()) {
          card.append(cv_text(s));
        }
      };
      if (m.role === "tool") {
        card.append(answer(String(m.content), !/^Error: /.test(String(m.content)), conv.ids[m.tool_call_id]));
      } else if (typeof m.content === "string") {
        said(m.content);
      } else {
        for (const b of m.content || []) {
          if (b.type === "text") {
            said(b.text);
          } else if (b.type === "tool_use") {
            conv.ids[b.id] = b.name;
            card.append(cv_call(b.name, b.input));
          } else if (b.type === "tool_result") {
            card.append(answer(typeof b.content === "string" ? b.content : JSON.stringify(b.content), !b.is_error, conv.ids[b.tool_use_id]));
          } else if (b.type === "thinking" || b.type === "redacted_thinking") {
            card.append(fold(b.thinking ? t("ag_think") : t("cv_think_hidden"), () => cv_pre(b.thinking || t("cv_think_hidden_why"))));
          } else {
            card.append(cv_pre(b));
          }
        }
      }
      for (const c of m.tool_calls || []) {
        const fn = c.function || {};
        conv.ids[c.id] = fn.name;
        let input = fn.arguments;
        try {
          input = typeof input === "string" ? JSON.parse(input || "{}") : input || {};
        } catch (e) {
          input = { arguments: String(fn.arguments) };
        }
        card.append(cv_call(fn.name, input));
      }
      list.append(card);
    }
    return list;
  }

  function conv_event(e) {
    const at = (conv.wall ? clock(conv.wall + e.t) + " · " : "") + "+" + (e.t / 1000).toFixed(1).replace(".", t("decimal")) + " s";
    const row = (cls, head, ...kids) => el("div", { class: "cv " + cls }, el("div", { class: "cv-head" },
      el("span", { class: "cv-at", text: at }), " ", head), ...kids);
    const size = (x) => kb((typeof x === "string" ? x : JSON.stringify(x)).length);
    const raw = (x) => fold(t("conv_raw", size(x)), () => cv_pre(x));
    switch (e.type) {
      case "session": {
        conv.start = e.files;
        conv.tools = e.tools;
        return row("note", t("conv_session", e.profile.name, t("agent_mode_" + e.mode).toLowerCase(), e.entry),
          el("div", { class: "cv-sec" }, el("div", { class: "cv-sec-head", text: t("conv_sec_task") }), cv_pre(e.task)),
          fold(t("conv_settings"), () => cv_pre({ holes: e.holes, close_goals: e.close_goals, locks: e.locks,
            budget: e.budget, bend: e.bend, profile: e.profile })),
          cv_files(e.files, null), cv_tools(e.tools, null));
      }
      case "resume": {
        const prev = conv.tools;
        conv.tools = e.tools;
        return row("note", t("conv_resume", e.profile.name, t("agent_mode_" + e.mode).toLowerCase(), e.entry),
          e.note ? el("div", { class: "cv-sec" }, el("div", { class: "cv-sec-head", text: t("conv_sec_note") }), cv_pre(e.note)) : null,
          fold(t("conv_settings"), () => cv_pre({ ended: e.ended, holes: e.holes, close_goals: e.close_goals, locks: e.locks,
            budget: e.budget, profile: e.profile })),
          cv_files(e.files, conv.start), cv_tools(e.tools, prev));
      }
      case "claude_call":
        return row("out", t("conv_claude_call", e.leg, e.model_tier) + " · " + size(e.prompt), cv_brief(e.prompt));
      case "claude_reply":
        return row("in", t("conv_claude_reply", e.leg) + (e.truncated ? t("conv_truncated") : ""), cv_text(e.text));
      case "api_request": {
        const sys = e.system === undefined ? null : typeof e.system === "string" ? e.system : e.system.map((b) => b.text).join("\n\n");
        return row("out", t("conv_request", e.round, e.model) + " · " + t("conv_messages", e.new_messages.length, size(e.new_messages)),
          sys !== null ? fold(t("conv_system", size(e.system)), () => cv_brief(sys)) : null,
          e.tools !== undefined ? cv_tools(e.tools, null) : null,
          cv_msgs(e.new_messages, true), fold(t("conv_raw_sent", size(e.new_messages)), () => cv_pre(e.new_messages)));
      }
      case "api_response": {
        const u = e.body && e.body.usage;
        const b = e.body || {};
        const msg = b.content ? { role: "assistant", content: b.content } : ((b.choices || [])[0] || {}).message;
        const use = u ? Object.entries(u).filter(([, v]) => typeof v === "number" && v > 0).map(([k, v]) => k.replace(/_tokens$/, "").replace(/_/g, " ") + " " + v).join(", ") : "";
        return row("in", t("conv_response", e.round) + (use ? t("conv_usage", use) : ""),
          msg ? cv_msgs([Object.assign({ role: "assistant" }, msg)]) : null, raw(e.body));
      }
      case "tool_call":
        return row("tool", t("conv_tool", e.step, e.name), cv_input(e.input));
      case "tool_result": {
        const r = cv_result(e.result, e.ok, "");
        const head = r.firstChild;
        head.remove();
        return row(e.ok ? "res" : "err", el("span", {}, t(e.ok ? "conv_result" : "conv_error", e.ms), ...head.childNodes), r,
          e.diff ? el("pre", { class: "ag-diff" }, ...e.diff.del.map((l) => el("div", { class: "del", text: "- " + l })),
            ...e.diff.add.map((l) => el("div", { class: "add", text: "+ " + l }))) : null);
      }
      case "end":
        return row("note", t("conv_end", e.steps), cv_pre(e.verdict), cv_files(e.files, conv.start));
      case "memory":
        return row("note", t("conv_memory", e.merged, e.compactions, kb(e.view), e.messages));
      case "memory_call":
        return row("in", t("conv_memory_call", e.model, e.ms), cv_pre(e.reply));
      case "auto_resume":
        return row("note", t("agent_auto_again", e.why));
      default:
        return row(/error/.test(e.type) ? "err" : "note", e.type + (e.steps !== undefined ? " · " + e.steps : ""),
          /error/.test(e.type) ? cv_pre(e) : null);
    }
  }

  // Memory, shown
  // -------------
  // The project's chat as the agent sees it: its view, line by line, each
  // opened down to its messages on a tap, and a way to forget it all.

  function mem_row(m, id, n) {
    const l = Math.log2(n);
    const d = el("details", { class: "cv-fold mem-row" },
      el("summary", {}, el("span", { class: "cv-name", text: id + "+" + n }), " ", mem_text(m, l, id / n)));
    let filled = false;
    d.addEventListener("toggle", () => {
      if (d.open && !filled) {
        filled = true;
        d.append(n === 1 ? cv_pre(m.msgs[id].kind + " · " + when(m.msgs[id].t) + "\n\n" + m.msgs[id].text)
          : el("div", { class: "cv-list" }, mem_row(m, id, n / 2), mem_row(m, id + n / 2, n / 2)));
      }
    });
    return d;
  }

  function mem_panel() {
    const box = el("div", { class: "mem" });
    const m = mem_store.cache.get(state.id);
    if (m === undefined) {
      box.append(el("small", { class: "dim", text: "…" }));
      return box;
    }
    const lim = agent_limits(ai_cfg());
    box.append(el("p", { class: "dim", text: t("mem_stats", m.msgs.length, m.view.length, kb(mem_size(m)), kb(lim.memory), m.made) }),
      el("small", { class: "dim", text: t("mem_hint") }));
    if (m.msgs.length === 0) {
      box.append(el("p", { class: "empty", text: t("mem_empty") }));
      return box;
    }
    const list = el("div", { class: "cv-list mem-lines" });
    for (const [l, i] of m.view) {
      list.append(mem_row(m, i * 2 ** l, 2 ** l));
    }
    box.append(list, el("div", { class: "row agent-end" }, el("button", { class: "btn danger", type: "button", text: t("mem_forget"),
      disabled: agent.running, onclick: async () => {
        const pid = state.id;
        const keep = JSON.parse(JSON.stringify(m));
        await mem_forget(pid);
        agent.mem = agent.proj === pid ? mem_store.cache.get(pid) : agent.mem;
        agent_paint();
        toast(t("mem_forgotten"), t("undo"), async () => {
          mem_store.cache.set(pid, keep);
          agent.mem = agent.proj === pid ? keep : agent.mem;
          await mem_flush(pid);
          agent_paint();
        });
      } })));
    return box;
  }

  // UniiChat
  // --------
  // A hand-over to UniiChat (uniichat.com, or one's own server), which has
  // a shell where the bend CLI runs whole (the Lean kernel of --verdict,
  // the hub): a message to paste there, with the task, the files and the
  // memory's view; and its answer taken back, the files it gives in fenced
  // blocks marked path=, with a snapshot first and Undo.

  const UNII_URL = "https://uniichat.com";

  function unii_message(task) {
    const files = state.files.filter((f) => /\.(bend|js)$/.test(f.name));
    const m = mem_store.cache.get(state.id);
    const entry = agent.entry || agent_default_entry();
    const history = m && m.msgs.length ? mem_cut(mem_lines(m).join("\n"), 16000) : "";
    return ["I am working on a Bend 2 project in the Bend 2 pocket workshop (https://np.github.io/bend-workshop/), and hand it over to you: work on it with the bend CLI on my computer.",
      "Task: " + task,
      (state.ai.instructions || "").trim() ? "My standing instructions:\n" + state.ai.instructions.trim() : "",
      "Setup: if bend is missing, install it with `curl -fsSL https://bend-lang.com/install.sh | sh`; `bend guide` prints the guide. Write the files below in a new folder and work there: run `bend " + entry + "`"
        + (files.some((f) => f.name === "PROOF.bend") ? " and `bend PROOF.bend`" : "") + " after each change, until the verdict reads ALL PROOFS CHECK, and say what `bend " + entry + " --verdict` answers.",
      "When you are done, give me every file you changed or created, whole, each in a fenced block whose info string is `bend path=<its path>` (or `js path=<its path>`), so that the workshop can take them back. Answer me in " + LANG_NAMES[lang] + ".",
      "Files (checked from " + entry + "):",
      files.map((f) => fence(f.text, (f.name.endsWith(".js") ? "js" : "bend") + " path=" + f.name)).join("\n\n"),
      history ? "What the workshop's agent did on this project so far, as its memory's one-line summaries (id+n|text, oldest first):\n" + fence(history, "text") : "",
    ].filter(Boolean).join("\n\n");
  }

  // The files an answer gives: fenced blocks whose info string says path=.
  function unii_files(text) {
    const out = [];
    const re = /^(`{3,}|~{3,})[^\n]*?\bpath=["']?([^\s"'`]+)["']?[^\n]*\n([\s\S]*?)\n\1[ \t]*$/gm;
    for (const m of String(text).matchAll(re)) {
      const name = m[2].replace(/^\.\//, "");
      const at = state.files.findIndex((f) => f.name === name);
      if (name_ok(name, at) === "" && !out.some((x) => x.name === name)) {
        out.push({ name, text: m[3].replace(/\s*$/, "\n"), fresh: at < 0 });
      }
    }
    return out;
  }

  function unii_take(got) {
    if (agent_guard() || got.length === 0) {
      return false;
    }
    const keep = work_snapshot();
    snap_take(["snap_before_unii"], true);
    const open = view.hub === null ? state.files[state.active] : null;
    for (const g of got) {
      const f = state.files.find((x) => x.name === g.name);
      if (!f) {
        state.files.push({ name: g.name, text: g.text });
      } else if (f !== open) {
        f.text = g.text;
      }
    }
    const mine = open && got.find((g) => g.name === open.name);
    if (mine && mine.text !== open.text) {
      ed_rewrite(mine.text);
    }
    proj_touch();
    store_save();
    files_paint();
    live_soon();
    const m = mem_store.cache.get(state.id);
    if (m) {
      mem_push(m, "note", "The user took files back from UniiChat: " + got.map((g) => g.name + (g.fresh ? " (new)" : "")).join(", ") + ".");
      mem_save(state.id);
    }
    toast(t("unii_taken", got.length), t("undo"), () => work_restore(keep));
    return true;
  }

  function unii_sheet() {
    const draft = ($("#agent-task") || { value: "" }).value.trim() || agent.draft || "";
    const task = draft || agent.task || t("agent_task_default");
    const msg = unii_message(task);
    const shown = el("textarea", { class: "ai-req", rows: "6", readonly: true, spellcheck: "false" });
    shown.value = msg;
    const answer = el("textarea", { class: "ai-req", rows: "5", spellcheck: "false", placeholder: t("unii_answer_ph") });
    const note = el("small", { text: "", style: "white-space: pre-line" });
    const take = el("button", { class: "btn primary", type: "button", text: t("unii_take"), disabled: true });
    let got = [];
    answer.addEventListener("input", () => {
      got = unii_files(answer.value);
      take.disabled = got.length === 0;
      note.textContent = answer.value.trim() === "" ? "" : got.length === 0 ? t("unii_none")
        : t("unii_files", got.map((g) => g.name + (g.fresh ? " +" : "")).join(", "));
    });
    const body = el("div", { class: "form" }, el("p", { class: "sigdoc", text: t("unii_hint") }),
      el("label", {}, t("unii_message", kb(msg.length)), shown),
      el("div", { class: "row" },
        el("button", { class: "btn primary", type: "button", text: t("unii_copy_open"), onclick: () => {
          copy_text(msg);
          window.open(UNII_URL, "_blank", "noopener");
        } }),
        el("button", { class: "btn", type: "button", text: t("copy"), onclick: () => copy_text(msg) })),
      el("label", {}, t("unii_answer"), answer), note, el("div", { class: "row" }, take));
    const close = sheet_open(t("unii_title"), body);
    take.addEventListener("click", () => {
      if (unii_take(got)) {
        close();
      }
    });
  }

  // The pane
  // --------

  function agent_tab() {
    const tab = $(".tab[data-tab=agent]");
    if (tab) {
      tab.hidden = !(agent_ok() || agent.running || agent.log.length > 0);
    }
  }

  function agent_paint_soon() {
    cancelAnimationFrame(agent.raf);
    agent.raf = requestAnimationFrame(agent_paint);
  }

  function agent_paint() {
    const pane = $("#pane-agent");
    if (!pane || pane.hidden) {
      return;
    }
    const keepTask = $("#agent-task") ? $("#agent-task").value : agent.draft || "";
    const kept = journal_keep(pane);
    pane.textContent = "";
    const box = el("div", { class: "agent" });
    if (!agent_ok() && !agent.running) {
      box.append(el("p", { class: "empty", text: t("agent_unavailable") }),
        el("div", { class: "row" }, el("button", { class: "btn", type: "button", text: t("unii_btn"), onclick: unii_sheet })));
      pane.append(box);
      return;
    }
    if (agent.running) {
      const head = el("div", { class: "agent-run" },
        el("span", { class: "grow", text: t("agent_steps", agent.steps, agent.budget) + " · " + agent.entry }));
      if (agent.paused) {
        head.append(el("button", { class: "btn primary", type: "button", text: t("agent_continue", agent.size),
          onclick: () => agent.paused && agent.paused(true) }));
      }
      head.append(el("button", { class: "btn danger", type: "button", text: t("stop"), onclick: agent_stop }));
      if (keep.audio !== null) {
        head.prepend(el("span", { class: "agent-awake", title: t("agent_keep"), text: "🔈 " + t("keep_on") }));
      }
      box.append(head);
      if (typeof agent.shrink === "number") {
        const pc = Math.round(agent.shrink * 100);
        box.append(el("div", { class: "mem-shrink", role: "status" }, el("span", { text: t("mem_shrinking", pc) }),
          el("progress", { max: "100", value: String(pc), "aria-label": t("mem_shrinking", pc) })));
      }
      box.append(el("p", { class: "agent-task-shown", text: agent.task }));
    } else if (agent.done) {
      // a finished session: what it was asked, then what it did
      box.append(el("p", { class: "agent-task-shown", text: agent.task }));
    } else {
      box.append(agent_form(keepTask));
    }
    // a past session being read, or the live one
    const past = ses.view;
    const trace = past ? past.trace : agent.trace;
    const journal = past ? past.log : agent.log;
    if (past) {
      box.textContent = "";
      box.append(el("div", { class: "agent-run" },
        el("span", { class: "grow", text: t("ses_reading", when(past.id), past.profile) }),
        el("button", { class: "btn", type: "button", text: t("ses_back"), onclick: () => { ses.view = null; agent_paint(); } }),
        el("button", { class: "btn danger", type: "button", text: t("delete"), onclick: async () => {
          await ses_del(past.id);
          ses.view = null;
          agent_paint();
        } })),
        el("p", { class: "agent-task-shown", text: past.task }));
    }
    const mem_now = mem_store.cache.get(state.id);
    if (mem_now === undefined) {
      mem_open(state.id).then(() => agent_paint_soon());
    }
    if (trace.length > 0 || (mem_now && mem_now.msgs.length > 0)) {
      const modes = el("div", { class: "row agent-modes" });
      for (const m of ["journal", "conversation", "memory"]) {
        modes.append(el("button", { class: "chip" + (ses.mode === m ? " on" : ""), type: "button", "aria-pressed": String(ses.mode === m),
          text: t("ses_mode_" + m), onclick: () => { ses.mode = m; agent_paint(); } }));
      }
      if (trace.length > 0) {
        modes.append(el("span", { class: "dim conv-stats", text: conv_stats(trace) }));
      }
      box.append(modes);
    }
    if (ses.mode === "memory") {
      box.append(mem_panel());
    } else if (ses.mode === "conversation" && trace.length > 0) {
      box.append(conv_view(trace, past ? "past:" + past.id : "live:" + agent.wall, past ? past.id : agent.wall));
    } else {
      box.append(journal_view(journal, trace, past ? past.id : agent.wall));
    }
    if (trace.length > 0) {
      box.append(el("div", { class: "row agent-export" }, el("span", { class: "dim", text: t("agent_export") }),
        el("button", { class: "chip", type: "button", text: ".json", "aria-label": t("agent_export") + " (.json)",
          onclick: () => agent_export("json", trace, past ? past.id : agent.wall) }),
        el("button", { class: "chip", type: "button", text: ".md", "aria-label": t("agent_export") + " (.md)",
          onclick: () => agent_export("md", trace, past ? past.id : agent.wall) })));
    }
    if (agent.done && agent.before !== null && !past) {
      // a session that ended can be taken up again, its settings refined
      box.append(agent_form(agent.note_draft, true));
    }
    if (past && past.resume && past.resume.proj === state.id && !agent.running) {
      box.append(el("div", { class: "row agent-end" },
        el("button", { class: "btn primary", type: "button", text: t("ses_resume"), onclick: () => ses_take(past) })));
    }
    if (!agent.running && !past) {
      box.append(ses_list());
    }
    pane.append(box);
    journal_restore(pane, kept);
    if (agent.jump !== undefined) {
      const at = pane.querySelector("[data-j=\"" + agent.jump + "\"]");
      agent.jump = undefined;
      if (at) {
        at.scrollIntoView({ block: "start" });
      }
    }
  }

  // The journal is built again on each repaint: what was open in it (the
  // folds of each entry, by title and rank) opens again, and the entry at
  // the top of the view stays where it was, new entries coming above it.
  function fold_keys(item, each) {
    const seen = new Map();
    for (const d of item.querySelectorAll("details")) {
      const s = d.firstElementChild ? d.firstElementChild.textContent : "";
      const n = seen.get(s) || 0;
      seen.set(s, n + 1);
      each(d, item.dataset.j + "|" + s + "|" + n);
    }
  }

  function journal_keep(pane) {
    const open = new Set();
    let anchor = null;
    const top = pane.getBoundingClientRect().top;
    for (const item of pane.querySelectorAll(".ag-item[data-j]")) {
      fold_keys(item, (d, k) => d.open && open.add(k));
      const r = item.getBoundingClientRect();
      if (anchor === null && pane.scrollTop > 0 && r.bottom > top) {
        anchor = { j: item.dataset.j, off: r.top - top };
      }
    }
    return { open, anchor };
  }

  function journal_restore(pane, kept) {
    for (const item of pane.querySelectorAll(".ag-item[data-j]")) {
      // a fold opened may hold folds of its own: a few passes
      for (let pass = 0; pass < 6; pass++) {
        let more = false;
        fold_keys(item, (d, k) => {
          if (!d.open && kept.open.has(k)) {
            d.open = true;
            if (d._fill) {
              d._fill();
            }
            more = true;
          }
        });
        if (!more) {
          break;
        }
      }
    }
    if (kept.anchor) {
      const item = pane.querySelector(".ag-item[data-j=\"" + kept.anchor.j + "\"]");
      if (item) {
        pane.scrollTop += item.getBoundingClientRect().top - pane.getBoundingClientRect().top - kept.anchor.off;
      }
    }
  }

  // The time of day, to the second.
  function clock(ms) {
    return new Date(ms).toLocaleTimeString(t("locale"), { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  // The journal, newest first: each entry with its time, and, when the
  // trace says which events were its own, a fold that opens onto them (the
  // prompt sent, the reply, the tool's exact answer, the summaries
  // written). Folds stay open across repaints.
  function journal_view(journal, trace, wall) {
    const log = el("div", { class: "agent-log" });
    const mine = new Map();
    for (const ev of trace) {
      if (ev.j !== undefined) {
        mine.set(ev.j, (mine.get(ev.j) || []).concat([ev]));
      }
    }
    const first = trace.find((x) => x.type === "session");
    for (let j = journal.length - 1; j >= 0; j--) {
      const e = journal[j];
      const evs = mine.get(j) || [];
      const key = wall + ":" + j;
      const open = agent.open.has(key);
      const item = el("div", { class: "ag-item", "data-j": String(j) });
      const head = el("div", { class: "ag-when" }, el("span", { text: e.at ? clock(e.at) : "" }));
      if (evs.length > 0) {
        head.append(el("button", { class: "ag-unfold", type: "button", "aria-expanded": String(open),
          text: (open ? "▾ " : "▸ ") + t("ag_events", evs.length), onclick: () => {
            if (agent.open.has(key)) {
              agent.open.delete(key);
            } else {
              agent.open.add(key);
            }
            agent_paint();
          } }));
      }
      item.append(head, agent_entry(e));
      if (open) {
        conv.start = first ? first.files : null;
        conv.tools = null;
        conv.wall = wall;
        item.append(el("div", { class: "ag-events" }, ...evs.map(conv_event)));
      }
      log.append(item);
    }
    return log;
  }

  // The settings of a new session, or (resume) of one taken up again: then
  // the text is what to do now, the task itself staying as it was.
  function agent_form(task, resume) {
    const form = el("div", { class: "form agent-form" + (resume ? " agent-resume" : "") });
    const area = el("textarea", { id: resume ? "agent-note" : "agent-task", class: "ai-req", rows: "3", spellcheck: "true",
      placeholder: resume ? t("agent_note_ph")
        : agent.mode === "holes" ? t("agent_task_holes", agent.holes.map((h) => "?" + h).join(", ")) : t("agent_task_default") });
    area.value = task;
    area.addEventListener("input", () => {
      if (resume) {
        agent.note_draft = area.value;
      } else {
        agent.draft = area.value;
      }
    });
    if (resume) {
      form.append(el("h3", { class: "agent-resume-title", text: t("agent_resume_title") }),
        el("small", { text: t("agent_resume_hint") }));
    }
    form.append(el("label", {}, t(resume ? "agent_note" : "agent_task"), area));
    // what it may change
    const modes = el("div", { class: "row" });
    for (const m of ["project", "holes"]) {
      modes.append(el("button", { class: "chip" + (agent.mode === m ? " on" : ""), type: "button", "aria-pressed": String(agent.mode === m),
        text: t("agent_mode_" + m), onclick: () => {
          agent.mode = m;
          if (m === "holes" && agent.holes.length === 0) {
            const live = goals.cards.filter((c) => !c.gone).map((c) => c.name);
            agent.holes = live.slice(0, 1);
          }
          agent_paint();
        } }));
    }
    form.append(el("div", { class: "field" }, el("span", { text: t("agent_mode") }), modes));
    if (agent.mode === "holes") {
      const known = [...new Set(goals.cards.filter((c) => !c.gone).map((c) => c.name).concat(agent.holes))].filter(hole_open);
      const list = el("div", { class: "row agent-holes" });
      if (known.length === 0) {
        list.append(el("small", { text: t("agent_no_holes") }));
      }
      for (const h of known) {
        const box = el("input", { type: "checkbox" });
        box.checked = agent.holes.includes(h);
        box.addEventListener("change", () => {
          agent.holes = box.checked ? agent.holes.concat([h]) : agent.holes.filter((x) => x !== h);
        });
        list.append(el("label", { class: "chip pickable" }, box, "?" + h));
      }
      const close = el("input", { type: "checkbox" });
      close.checked = agent.close;
      close.addEventListener("change", () => { agent.close = close.checked; });
      form.append(el("div", { class: "field" }, el("span", { text: t("agent_holes") }), list),
        el("label", { class: "check" }, close, el("span", {}, t("agent_close"), el("br"), el("small", { text: t("agent_close_hint") }))));
    } else {
      const list = el("div", { class: "row agent-files" });
      for (const f of state.files) {
        const on = agent_locked(f.name);
        list.append(el("button", { class: "chip" + (on ? " locked" : ""), type: "button", "aria-pressed": String(on),
          "aria-label": on ? t("agent_locked", f.name) : t("agent_unlocked", f.name), text: (on ? "🔒 " : "🔓 ") + f.name,
          onclick: () => {
            const locks = new Set(state.locks || []);
            if (locks.has(f.name)) {
              locks.delete(f.name);
            } else {
              locks.add(f.name);
            }
            state.locks = [...locks];
            store_save();
            agent_paint();
          } }));
      }
      form.append(el("div", { class: "field" }, el("span", { text: t("agent_files") }), list, el("small", { text: t("agent_lock_hint") })));
    }
    // checked from, profile, budget
    const entry = el("select", { class: "ai-sel", "aria-label": t("agent_entry") });
    for (const f of state.files.filter((x) => x.name.endsWith(".bend"))) {
      entry.append(el("option", { value: f.name, text: f.name }));
    }
    if (!state.files.some((f) => f.name === agent.entry)) {
      agent.entry = agent_default_entry();
    }
    entry.value = agent.entry;
    entry.addEventListener("change", () => { agent.entry = entry.value; });
    const usable = state.ai.profiles.filter((p) => p.provider !== "claude" || (ai.sample !== null && ai.tools === true));
    const prof = el("select", { class: "ai-sel", "aria-label": t("ai_profile") });
    for (const p of usable) {
      prof.append(el("option", { value: p.id, text: p.name }));
    }
    prof.value = state.ai.active;
    prof.addEventListener("change", () => {
      state.ai.active = prof.value;
      store_main();
    });
    const budget = el("input", { id: "agent-budget", type: "number", min: "1", max: "500", value: String(agent.size) });
    const awake = el("input", { type: "checkbox", id: "agent-keep" });
    awake.checked = agent.keep;
    awake.addEventListener("change", () => { agent.keep = awake.checked; });
    const auto = el("input", { type: "checkbox", id: "agent-auto" });
    auto.checked = agent.auto;
    auto.addEventListener("change", () => { agent.auto = auto.checked; });
    form.append(el("div", { class: "agent-grid" },
      el("label", {}, t("agent_entry"), entry),
      el("label", {}, t("ai_profile"), prof),
      el("label", {}, t("agent_budget"), budget)),
      el("label", { class: "check auto" }, auto, el("span", {}, t("agent_auto"), el("br"), el("small", { text: t("agent_auto_hint") }))),
      el("label", { class: "check keep" }, awake, el("span", {}, t("agent_keep"), el("br"), el("small", { text: t("agent_keep_hint") }))),
      resume
        ? el("div", { class: "row agent-end" },
          el("button", { class: "btn primary", type: "button", text: t("agent_resume"), onclick: agent_resume }),
          el("button", { class: "btn", type: "button", text: t("agent_undo"), onclick: agent_undo }),
          el("button", { class: "btn", type: "button", text: t("agent_new"), onclick: () => {
            agent.done = false;
            agent.log = [];
            agent_paint();
          } }))
        : el("div", { class: "row" }, el("button", { class: "btn primary", type: "button", text: t("agent_start"), onclick: agent_start }),
          el("button", { class: "btn", type: "button", text: t("unii_btn"), onclick: unii_sheet })));
    return form;
  }

  function agent_entry(e) {
    if (e.kind === "say") {
      const say = el("div", { class: "ag-say", text: e.text.replace(/\n?STATUS:\s*\w+\s*$/i, "") || (e.think ? "" : "…") });
      // the model's reasoning, as its summary, folded above what it said
      return e.think ? el("div", {}, el("details", { class: "ag-think" }, el("summary", { text: t("ag_think") }),
        el("div", { class: "ag-think-text", text: e.think })), say) : say;
    }
    if (e.kind === "note") {
      return el("div", { class: "ag-note", text: e.text });
    }
    if (e.kind === "err") {
      return el("div", { class: "ag-err", text: e.text });
    }
    if (e.kind === "memory") {
      return el("div", { class: "ag-note ag-mem" + (e.state === "run" ? " run" : ""),
        text: e.state === "run" ? t("ag_mem_run") : t("ag_mem_done", e.merged || 0, e.asked || 0) });
    }
    if (e.kind === "verdict") {
      return el("div", { class: "ag-verdict " + (e.ok ? "ok" : e.open ? "goal" : "bad"), text: t("agent_verdict", e.text) });
    }
    const args = e.args || {};
    const what = args.path || args.file || (args.hole ? "?" + String(args.hole).replace(/^\?/, "") : "") || args.name || args.section || "";
    const row = el("div", { class: "ag-tool " + e.state },
      el("div", { class: "ag-head" }, el("b", { text: e.state === "run" ? "…" : e.state === "ok" ? "✓" : "✗" }), " ",
        el("span", { class: "ag-name", text: e.name }), what ? " " + what : "",
        e.verdict ? el("span", { class: "ag-v", text: "  " + e.verdict }) : null));
    if (e.diff && (e.diff.del.length || e.diff.add.length)) {
      const d = el("pre", { class: "ag-diff" });
      for (const l of e.diff.del) {
        d.append(el("div", { class: "del", text: "- " + l }));
      }
      for (const l of e.diff.add) {
        d.append(el("div", { class: "add", text: "+ " + l }));
      }
      row.append(d);
    } else if (e.name === "eval" || e.name === "run") {
      row.append(el("pre", { class: "ag-out", text: (args.expr ? args.expr + "\n= " : "")
        + (e.result === undefined ? "…" : agent_clip(e.result).slice(0, 600)) }));
    } else if (e.state === "err") {
      row.append(el("div", { class: "ag-why", text: String(e.result).slice(0, 300) }));
    }
    return row;
  }

