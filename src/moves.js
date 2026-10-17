  // Rename and move
  // ===============
  // A declaration renamed everywhere in the project, or moved to another
  // module with every change it needs: the references in its own file, in
  // the files that import it, and in the moved text itself, the imports
  // added or dropped, its place in the target (safe code names only what is
  // above it). Both are computed on the text, as the signature bar reads
  // it, then checked: written only if no entry file of the project checks
  // worse than before. Base and hub modules are read-only, so only a
  // project file's declarations move or change name.

  // The names in a text, as the checker reads them: comments, strings,
  // characters, numbers, holes, attributes and import lines left out.
  function mv_tokens(text) {
    const out = [];
    const n = text.length;
    let i = 0;
    let bol = true;
    while (i < n) {
      const c = text[i];
      if (bol && text.startsWith("import ", i)) {
        while (i < n && text[i] !== "\n") {
          i++;
        }
        continue;
      }
      bol = false;
      if (c === "\n") {
        bol = true;
        i++;
      } else if (c === "#") {
        while (i < n && text[i] !== "\n") {
          i++;
        }
      } else if (c === "\"") {
        i++;
        while (i < n && text[i] !== "\"" && text[i] !== "\n") {
          i += text[i] === "\\" ? 2 : 1;
        }
        i++;
      } else if (c === "'" && /^'(\\u\{[0-9a-fA-F]+\}|\\.|[^'\\\n])'/.test(text.slice(i, i + 12))) {
        i += /^'(\\u\{[0-9a-fA-F]+\}|\\.|[^'\\\n])'/.exec(text.slice(i, i + 12))[0].length;
      } else if (/[0-9]/.test(c)) {
        while (i < n && /[\w.]/.test(text[i])) {
          i++;
        }
      } else if (/[A-Za-z_]/.test(c)) {
        const a = i;
        while (i < n && /[\w.$]/.test(text[i])) {
          i++;
        }
        let b = i;
        while (b > a && text[b - 1] === ".") {
          b--;
        }
        const before = a > 0 ? text[a - 1] : "";
        if (before !== "?" && before !== "@") {
          out.push({ a, b, name: text.slice(a, b) });
        }
      } else {
        i++;
      }
    }
    return out;
  }

  // The text with each token changed by fn (which answers the new name, or
  // null to keep it), and how many changed.
  function mv_rewrite(text, fn) {
    let out = "";
    let at = 0;
    let count = 0;
    for (const tk of mv_tokens(text)) {
      const next = fn(tk.name);
      if (next !== null && next !== tk.name) {
        out += text.slice(at, tk.a) + next;
        at = tk.b;
        count++;
      }
    }
    return { text: out + text.slice(at), count };
  }

  // A workspace file's imports: alias, target (a workspace file, or hub:…),
  // the line, its index.
  function mv_imports(name, text) {
    const dir = name.includes("/") ? name.slice(0, name.lastIndexOf("/") + 1) : "";
    const out = [];
    text.split("\n").forEach((l, i) => {
      const m = /^import\s+(\S+\.bend)\s+as\s+([A-Za-z_]\w*)\s*(#.*)?$/.exec(l);
      if (m) {
        const rel = /^\.{1,2}\//.test(m[1]);
        out.push({ alias: m[2], path: m[1], target: rel ? path_join(dir, m[1]) : "hub:" + (hub_rel(m[1]) || m[1]), line: l, index: i, rel });
      }
    });
    return out;
  }

  // The path to write in from's import of to: ./x.bend, ../a/x.bend.
  function mv_relpath(from, to) {
    const a = from.split("/").slice(0, -1);
    const b = to.split("/");
    let k = 0;
    while (k < a.length && k < b.length - 1 && a[k] === b[k]) {
      k++;
    }
    const up = a.length - k;
    return (up === 0 ? "./" : "../".repeat(up)) + b.slice(k).join("/");
  }

  // An alias free in a file: the wanted one, else with a number.
  function mv_alias(text, name, want) {
    const taken = new Set(mv_imports(name, text).map((x) => x.alias));
    for (const tk of mv_tokens(text)) {
      taken.add(tk.name.split(".")[0]);
    }
    let alias = want;
    for (let n = 2; taken.has(alias); n++) {
      alias = want + n;
    }
    return alias;
  }

  function mv_stem_alias(file) {
    const stem = file.replace(/\.bend$/, "").split("/").pop().replace(/[^\w]/g, "_");
    return /^[A-Za-z_]/.test(stem) ? stem[0].toUpperCase() + stem.slice(1) : "M_" + stem;
  }

  // The text with an import added after its last import (or at the top).
  function mv_add_import(text, line) {
    const lines = text.split("\n");
    let at = -1;
    lines.forEach((l, i) => {
      if (/^import\s/.test(l)) {
        at = i;
      }
    });
    lines.splice(at + 1, 0, line);
    return lines.join("\n");
  }

  // The files no other project file imports: checking them checks all.
  function mv_roots(files) {
    const bends = files.filter((f) => f.name.endsWith(".bend"));
    const imported = new Set();
    for (const f of bends) {
      for (const im of mv_imports(f.name, f.text)) {
        if (im.rel) {
          imported.add(im.target);
        }
      }
    }
    const roots = bends.filter((f) => !imported.has(f.name)).map((f) => f.name);
    return roots.length > 0 ? roots : bends.map((f) => f.name);
  }

  // A cycle among the project's imports, as the list of files on it.
  function mv_cycle(files) {
    const edges = new Map(files.filter((f) => f.name.endsWith(".bend"))
      .map((f) => [f.name, mv_imports(f.name, f.text).filter((x) => x.rel).map((x) => x.target)]));
    const state = new Map();
    const path = [];
    const visit = (v) => {
      state.set(v, 1);
      path.push(v);
      for (const w of edges.get(v) || []) {
        if (state.get(w) === 1) {
          return path.slice(path.indexOf(w)).concat([w]);
        }
        if (!state.has(w) && edges.has(w)) {
          const got = visit(w);
          if (got) {
            return got;
          }
        }
      }
      path.pop();
      state.set(v, 2);
      return null;
    };
    for (const v of edges.keys()) {
      if (!state.has(v)) {
        const got = visit(v);
        if (got) {
          return got;
        }
      }
    }
    return null;
  }

  // Rename
  // ------

  // Every change a rename makes: in the declaring file, its bare name; in
  // the files that import it as A, A.name. A type takes its namespace with
  // it (Shape.add becomes Form.add), since operators find their defs there.
  function rename_plan(files, d, to) {
    to = String(to || "").trim();
    if (!/^[A-Za-z_][\w$]*(\.[A-Za-z_][\w$]*)*$/.test(to)) {
      return { error: "rn_bad" };
    }
    if (to === d.name) {
      return { error: "rn_same" };
    }
    const home = files.find((f) => f.name === d.file);
    if (!home) {
      return { error: "mv_ro" };
    }
    if (decl_scan(home.text, home.name).some((x) => x.name === to)) {
      return { error: "rn_taken", arg: to };
    }
    const from = d.name;
    const swap = (prefix) => (tok) => {
      if (tok === prefix + from) {
        return prefix + to;
      }
      if (d.kind === "type" && tok.startsWith(prefix + from + ".")) {
        return prefix + to + tok.slice(prefix.length + from.length);
      }
      return null;
    };
    const texts = {};
    const counts = {};
    for (const f of files.filter((x) => x.name.endsWith(".bend"))) {
      const prefixes = f.name === d.file ? [""] : [];
      for (const im of mv_imports(f.name, f.text)) {
        if (im.target === d.file) {
          prefixes.push(im.alias + ".");
        }
      }
      let text = f.text;
      let n = 0;
      for (const p of prefixes) {
        const r = mv_rewrite(text, swap(p));
        text = r.text;
        n += r.count;
      }
      if (n > 0) {
        texts[f.name] = text;
        counts[f.name] = n;
      }
    }
    return Object.keys(texts).length ? { texts, counts } : { error: "rn_none" };
  }

  // Move
  // ----

  // The lines a declaration takes: its doc comment, its block, and with a
  // def proven by a law, the law too (they share a name and travel
  // together); a constructor brings its type.
  function mv_blocks(text, file, d) {
    const decls = decl_scan(text, file);
    const name = d.kind === "ctor" ? d.of : d.name;
    const mine = decls.filter((x) => x.name === name && x.kind !== "ctor" && (d.kind === "type" || d.kind === "ctor" ? x.kind === "type" : x.kind !== "type"));
    const lines = text.split("\n");
    const spans = mine.map((x) => {
      let from = x.line - 1;
      while (from > 0 && /^#/.test(lines[from - 1]) && !/^# ?[=-]{3,}/.test(lines[from - 1])) {
        from--;
      }
      if (from > 0 && /^#/.test(lines[from - 1])) {
        from = x.line - 1;
      }
      return { from, to: x.line - 1 + x.text.split("\n").length };
    }).sort((a, b) => a.from - b.from);
    const names = new Set(mine.map((x) => x.name));
    for (const x of decls) {
      if (x.kind === "ctor" && names.has(x.of) && mine.some((m) => m.kind === "type")) {
        names.add(x.name);
      }
    }
    return { spans, names, decls };
  }

  function mv_lines_out(lines, spans) {
    const drop = new Set();
    for (const s of spans) {
      for (let k = s.from; k < s.to; k++) {
        drop.add(k);
      }
      // one blank line after the block goes with it
      if (lines[s.to] !== undefined && lines[s.to].trim() === "" && (s.to + 1 >= lines.length || !drop.has(s.to + 1))) {
        drop.add(s.to);
      }
    }
    return lines.filter((_, k) => !drop.has(k));
  }

  // Every change a move makes, or why it cannot be made.
  function move_plan(files, d, target, fresh) {
    const F = d.file;
    const G = target;
    const home = files.find((f) => f.name === F);
    if (!home || !G || !G.endsWith(".bend")) {
      return { error: "mv_ro" };
    }
    if (G === F) {
      return { error: "mv_same" };
    }
    const there = files.find((f) => f.name === G);
    if (fresh ? there : !there) {
      return { error: fresh ? "name_taken_mv" : "mv_ro" };
    }
    const { spans, names: moved, decls } = mv_blocks(home.text, F, d);
    if (spans.length === 0) {
      return { error: "mv_ro" };
    }
    const lines = home.text.split("\n");
    const block = spans.map((s) => lines.slice(s.from, s.to).join("\n")).join("\n\n");
    const stay = new Set(decls.filter((x) => !moved.has(x.name)).map((x) => x.name));
    const f_imps = mv_imports(F, home.text);
    let g_text = there ? there.text : (/^import Base\b/m.test(home.text) ? "import Base\n" : "");
    const texts = {};
    const notes = [];
    // the alias a file uses for another, made when missing
    const alias_in = (text, name, of) => {
      const im = mv_imports(name, text).find((x) => x.target === of);
      if (im) {
        return { text, alias: im.alias };
      }
      const want = of.startsWith("hub:") ? (f_imps.find((x) => x.target === of) || {}).alias || "P" : mv_stem_alias(of);
      const alias = mv_alias(text, name, want);
      const path = of.startsWith("hub:") ? f_imps.find((x) => x.target === of).path : mv_relpath(name, of);
      notes.push(["mv_note_import", name, path, alias]);
      return { text: mv_add_import(text, "import " + path + " as " + alias), alias };
    };
    // the moved text: names of its old file go through an import of it,
    // names through F's imports through G's, names of G become bare
    let moved_text = block;
    const needs = new Map();
    for (const tk of mv_tokens(block)) {
      if (stay.has(tk.name) || [...stay].some((s) => tk.name.startsWith(s + ".") && decls.some((x) => x.name === s && x.kind === "type"))) {
        needs.set(F, true);
      }
      const dot = tk.name.indexOf(".");
      const im = dot > 0 ? f_imps.find((x) => x.alias === tk.name.slice(0, dot)) : null;
      if (im && im.target !== G) {
        needs.set(im.target, true);
      }
    }
    const g_alias = new Map();
    for (const of of needs.keys()) {
      const r = alias_in(g_text, G, of);
      g_text = r.text;
      g_alias.set(of, r.alias);
    }
    moved_text = mv_rewrite(block, (tok) => {
      if (stay.has(tok)) {
        return g_alias.get(F) + "." + tok;
      }
      for (const s of stay) {
        if (tok.startsWith(s + ".") && decls.some((x) => x.name === s && x.kind === "type")) {
          return g_alias.get(F) + "." + tok;
        }
      }
      const dot = tok.indexOf(".");
      const im = dot > 0 ? f_imps.find((x) => x.alias === tok.slice(0, dot)) : null;
      if (im) {
        return im.target === G ? tok.slice(dot + 1) : g_alias.get(im.target) + tok.slice(dot);
      }
      return null;
    }).text;
    // G's own references to the moved names, through its import of F, become bare
    const g_old = mv_imports(G, g_text).find((x) => x.target === F);
    if (g_old) {
      g_text = mv_rewrite(g_text, (tok) => (tok.startsWith(g_old.alias + ".") && moved.has(tok.slice(g_old.alias.length + 1)) ? tok.slice(g_old.alias.length + 1) : null)).text;
    }
    // where it goes in G: after what it uses there, before what uses it
    const g_lines = g_text.split("\n");
    const g_decls = decl_scan(g_text, G).filter((x) => x.kind !== "ctor");
    const used = new Set(mv_tokens(moved_text).map((x) => x.name));
    const span_of = (x) => {
      let from = x.line - 1;
      while (from > 0 && /^#/.test(g_lines[from - 1]) && !/^# ?[=-]{3,}/.test(g_lines[from - 1])) {
        from--;
      }
      return { from, to: x.line - 1 + x.text.split("\n").length };
    };
    const deps = g_decls.filter((x) => used.has(x.name) || [...used].some((u) => u.startsWith(x.name + ".") || (x.kind === "type" && decl_scan(g_text, G).some((c) => c.kind === "ctor" && c.of === x.name && c.name === u))));
    const users = g_decls.filter((x) => mv_tokens(x.text).some((tk) => moved.has(tk.name)));
    const after = deps.length ? Math.max(...deps.map((x) => span_of(x).to)) : 0;
    let at;
    if (users.length) {
      at = Math.min(...users.map((x) => span_of(x).from));
      if (at < after) {
        return { error: "mv_order", arg: users[0].name };
      }
    } else {
      at = g_lines.length;
      while (at > 0 && g_lines[at - 1].trim() === "") {
        at--;
      }
    }
    const ins = (at > 0 && g_lines[at - 1].trim() !== "" ? [""] : []).concat(moved_text.split("\n"),
      at < g_lines.length && g_lines[at].trim() !== "" ? [""] : []);
    g_lines.splice(at, 0, ...ins);
    g_text = g_lines.join("\n").replace(/\n*$/, "\n");
    // what stays in F reaches the moved names through an import of G
    let f_text = mv_lines_out(lines, spans).join("\n").replace(/\n*$/, "\n");
    if (mv_tokens(f_text).some((tk) => moved.has(tk.name))) {
      const r = alias_in(f_text, F, G);
      f_text = mv_rewrite(r.text, (tok) => (moved.has(tok) ? r.alias + "." + tok : null)).text;
    }
    texts[F] = f_text;
    texts[G] = g_text;
    // the files that import F reach the moved names through G
    for (const f of files.filter((x) => x.name.endsWith(".bend") && x.name !== F && x.name !== G)) {
      const via = mv_imports(f.name, f.text).filter((x) => x.target === F).map((x) => x.alias);
      if (via.length === 0 || !mv_tokens(f.text).some((tk) => via.some((a) => tk.name.startsWith(a + ".") && moved.has(tk.name.slice(a.length + 1))))) {
        continue;
      }
      const r = alias_in(f.text, f.name, G);
      texts[f.name] = mv_rewrite(r.text, (tok) => {
        const a = via.find((x) => tok.startsWith(x + ".") && moved.has(tok.slice(x.length + 1)));
        return a ? r.alias + tok.slice(a.length) : null;
      }).text;
    }
    // imports the move left unused go
    for (const [name, text] of Object.entries(texts)) {
      const before = (files.find((f) => f.name === name) || { text: "" }).text;
      const toks = mv_tokens(text);
      const drop = mv_imports(name, text).filter((im) => im.rel && !toks.some((tk) => tk.name.startsWith(im.alias + "."))
        && mv_tokens(before).some((tk) => tk.name.startsWith(im.alias + ".")));
      if (drop.length) {
        const gone = new Set(drop.map((x) => x.index));
        texts[name] = text.split("\n").filter((_, k) => !gone.has(k)).join("\n");
        for (const im of drop) {
          notes.push(["mv_note_unimport", name, im.path]);
        }
      }
    }
    const after_files = files.map((f) => (texts[f.name] !== undefined ? { name: f.name, text: texts[f.name] } : f))
      .concat(fresh ? [{ name: G, text: texts[G] }] : []);
    const cycle = mv_cycle(after_files);
    if (cycle) {
      return { error: "mv_cycle", arg: cycle.join(" → ") };
    }
    return { texts, notes, moved: [...moved], fresh: !!fresh };
  }

  // Applying
  // --------

  // How a check went, to compare before and after.
  function ref_kind(r) {
    return r.ok ? (/^SOME/.test(r.text) ? "some" : "ok") : r.open ? "open:" + (r.goals || []).length : "err:" + r.text.split("\n").slice(0, 3).join("|");
  }

  // Writes a plan's texts if no entry file of the project checks worse than
  // before; else says what the checker said. A snapshot first, and Undo in
  // the toast; the open file goes through the editor's own undo stack.
  async function ref_apply(plan, done, note) {
    if (agent_guard()) {
      return false;
    }
    const files = files_map();
    const next = { ...files, ...plan.texts };
    const before_files = state.files.map((f) => ({ name: f.name, text: f.text }));
    const after_files = Object.entries(next).map(([name, text]) => ({ name, text }));
    for (const root of new Set(mv_roots(before_files).concat(mv_roots(after_files)))) {
      const was = files[root] === undefined ? null : await comp_ask(root, false, files);
      const now = await comp_ask(root, false, next);
      const better = now.ok && !/^SOME/.test(now.text);
      if (was !== null && ref_kind(now) !== ref_kind(was) && !better) {
        note(t("ref_worse", root, now.ok ? now.text.split("\n")[0] : now.open ? open_brief(now) : err_brief(now)));
        return false;
      }
      if (was === null && !now.ok && !now.open) {
        note(t("ref_worse", root, err_brief(now)));
        return false;
      }
    }
    if (Object.entries(files).some(([name, text]) => (state.files.find((f) => f.name === name) || {}).text !== text)) {
      return false;
    }
    const keep = work_snapshot();
    snap_take(["snap_before_refactor"], true);
    const open = view.hub === null ? state.files[state.active] : null;
    for (const [name, text] of Object.entries(plan.texts)) {
      const f = state.files.find((x) => x.name === name);
      if (!f) {
        state.files.push({ name, text });
      } else if (f !== open) {
        f.text = text;
      }
    }
    if (open && plan.texts[open.name] !== undefined && plan.texts[open.name] !== open.text) {
      ed_rewrite(plan.texts[open.name]);
    }
    proj_touch();
    store_save();
    files_paint();
    live_soon();
    toast(done, t("undo"), () => work_restore(keep));
    return true;
  }

  // What can be renamed or moved: a project file's own declarations.
  function ref_ok(d) {
    return d.file !== null && !d.file.startsWith("hub:") && d.file.endsWith(".bend") && state.files.some((f) => f.name === d.file)
      && ["def", "law", "type", "ctor"].includes(d.kind);
  }

  function rename_sheet(d) {
    if (agent_guard()) {
      return;
    }
    const input = el("input", { type: "text", value: d.name, autocapitalize: "off", autocomplete: "off",
      autocorrect: "off", spellcheck: "false" });
    const note = el("small", { text: t("rn_hint") });
    const go = el("button", { class: "btn primary", type: "button", text: t("rn_go") });
    const body = el("div", { class: "form" }, el("label", {}, t("rn_new"), input, note), el("div", { class: "row" }, go));
    const close = sheet_open(t("rn_title", d.name), body);
    const say = (text, bad) => {
      note.textContent = text;
      note.style.color = bad ? "var(--fail)" : "";
    };
    const preview = () => {
      const plan = rename_plan(state.files, d, input.value);
      if (plan.error) {
        say(plan.error === "rn_same" ? t("rn_hint") : t(plan.error, plan.arg), plan.error !== "rn_same");
        return null;
      }
      say(t("rn_where", Object.entries(plan.counts).map(([f, n]) => f + " (" + n + ")").join(", ")), false);
      return plan;
    };
    input.addEventListener("input", preview);
    const submit = async () => {
      const plan = preview();
      if (plan === null) {
        return;
      }
      go.disabled = true;
      go.textContent = t("ref_checking");
      const ok = await ref_apply(plan, t("rn_done", d.name, input.value.trim()), (m) => say(m, true));
      go.disabled = false;
      go.textContent = t("rn_go");
      if (ok) {
        close();
      }
    };
    go.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        submit();
      }
    });
    input.focus();
    input.select();
  }

  function move_sheet(d) {
    if (agent_guard()) {
      return;
    }
    const others = state.files.filter((f) => f.name.endsWith(".bend") && f.name !== d.file).map((f) => f.name);
    const pick = el("select", { class: "ai-sel" });
    for (const name of others) {
      pick.append(el("option", { value: name, text: name }));
    }
    pick.append(el("option", { value: "", text: t("mv_new_file") }));
    const fresh = el("input", { type: "text", autocapitalize: "off", autocomplete: "off", autocorrect: "off", spellcheck: "false",
      placeholder: "lib.bend" });
    const fresh_row = el("label", {}, t("file_name"), fresh);
    const note = el("small", { text: "", style: "white-space: pre-line" });
    const go = el("button", { class: "btn primary", type: "button", text: t("mv_go") });
    const what = d.kind === "ctor" ? d.of : d.name;
    const body = el("div", { class: "form" }, el("p", { class: "sigdoc", text: t("mv_hint", what, d.file) }),
      el("label", {}, t("mv_to"), pick), fresh_row, note, el("div", { class: "row" }, go));
    const close = sheet_open(t("mv_title", what), body);
    const say = (text, bad) => {
      note.textContent = text;
      note.style.color = bad ? "var(--fail)" : "";
    };
    const plan_now = () => {
      const target = pick.value || fresh.value.trim();
      if (!pick.value) {
        const bad = name_ok(target, -1);
        if (bad || !target.endsWith(".bend")) {
          say(target === "" ? "" : bad || t("name_rule"), target !== "");
          return null;
        }
      }
      const plan = move_plan(state.files, d, target, !pick.value);
      if (plan.error) {
        say(t(plan.error, plan.arg), true);
        return null;
      }
      const lines = [t("mv_files", Object.keys(plan.texts).join(", "))].concat(plan.notes.map((n) => t(n[0], n[1], n[2], n[3])));
      say(lines.join("\n"), false);
      return plan;
    };
    const sync = () => {
      fresh_row.hidden = pick.value !== "";
      plan_now();
    };
    pick.addEventListener("change", sync);
    fresh.addEventListener("input", plan_now);
    sync();
    go.addEventListener("click", async () => {
      const plan = plan_now();
      if (plan === null) {
        return;
      }
      go.disabled = true;
      go.textContent = t("ref_checking");
      const target = pick.value || fresh.value.trim();
      const ok = await ref_apply(plan, t("mv_done", what, target), (m) => say(m, true));
      go.disabled = false;
      go.textContent = t("mv_go");
      if (ok) {
        close();
      }
    });
  }
