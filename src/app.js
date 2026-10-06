(function () {
  "use strict";

  // Helpers
  // =======

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") {
        n.className = v;
      } else if (k === "text") {
        n.textContent = v;
      } else if (k === "html") {
        n.innerHTML = v;
      } else if (k.startsWith("on")) {
        n.addEventListener(k.slice(2), v);
      } else if (v !== false && v !== null && v !== undefined) {
        n.setAttribute(k, v === true ? "" : v);
      }
    }
    for (const kid of kids) {
      if (kid !== null && kid !== undefined) {
        n.append(kid);
      }
    }
    return n;
  }

  // Language
  // ========
  // English unless the person chose French, or their browser speaks it.
  // t(key, ...args) is the text; static parts of the page carry data-i18n.

  const LANGS = window.BEND_LANGS;
  let lang = "en";

  function t(key, ...args) {
    const got = LANGS[lang][key] ?? LANGS.en[key] ?? key;
    return typeof got === "function" ? got(...args) : got;
  }

  function lang_static() {
    document.documentElement.lang = lang;
    for (const n of $$("[data-i18n]")) {
      n.textContent = t(n.dataset.i18n);
    }
    for (const n of $$("[data-i18n-html]")) {
      n.innerHTML = t(n.dataset.i18nHtml);
    }
    for (const n of $$("[data-i18n-aria]")) {
      n.setAttribute("aria-label", t(n.dataset.i18nAria));
    }
    for (const n of $$("[data-i18n-ph]")) {
      n.setAttribute("placeholder", t(n.dataset.i18nPh));
    }
  }

  function ms(n) {
    const d = t("decimal");
    return n < 10 ? n.toFixed(1).replace(".", d) + " ms"
      : n < 1000 ? Math.round(n) + " ms"
      : (n / 1000).toFixed(2).replace(".", d) + " s";
  }

  const COARSE = window.matchMedia("(pointer: coarse)").matches;
  const WIDE = window.matchMedia("(min-width: 900px)");

  if (/iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
    document.documentElement.classList.add("ios");
  }

  const EXAMPLES = JSON.parse($("#bend-examples").textContent);
  const CORE_SRC = $("#bend-core").textContent;
  const PRELUDE  = $("#bend-prelude").textContent;
  const TAIL     = $("#bend-tail").textContent;
  const Core     = window.BendCore;

  // Store
  // =====
  // Work is kept as named projects in localStorage, per viewer: an index, a
  // key per project, and a key per project's snapshots, so a keystroke only
  // rewrites the project being edited. Every access is guarded: storage may
  // be missing, full, or empty.

  const LS_OLD  = "bend-play:v1";
  const LS_MAIN = "bend-play:v2";
  const LS_PROJ = "bend-play:p:";
  const LS_SNAP = "bend-play:s:";
  const SNAP_CAP = 30;
  const SNAP_SLOT = 3 * 60 * 1000;

  // The open project's fields sit on state; the others wait in store.others.
  const state = {
    id: "", name: "", scratch: false, updated: 0,
    files: EXAMPLES[0].files.map((f) => ({ name: f.name, text: f.text })),
    active: 0,
    args: "",
    live: true,
    size: 14,
    ai: { active: "", profiles: [] },
    fonts: true,
  };

  // Where an assistant answers from: Claude through the claude.ai viewer,
  // a vendor's API, or any OpenAI-shaped server such as a local one.
  const AI_PROVIDERS = {
    none: { label: "—" },
    claude: { label: "Claude (claude.ai)" },
    anthropic: { label: "Anthropic API", url: "https://api.anthropic.com", model: "claude-sonnet-4-6" },
    openai: { label: "OpenAI API", url: "https://api.openai.com", model: "gpt-4.1" },
    custom: { label: "OpenAI-compatible URL", url: "http://localhost:11434", model: "" },
  };

  const store = { others: [], snaps: [], slots: 0 };

  function ls_get(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function ls_del(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (e) {}
  }

  // A full store makes room by letting go of the oldest automatic snapshots.
  function ls_set(key, value) {
    const text = JSON.stringify(value);
    for (let tries = 0; tries < 12; tries++) {
      try {
        window.localStorage.setItem(key, text);
        return true;
      } catch (e) {
        if (!snap_prune()) {
          return false;
        }
      }
    }
    return false;
  }

  function files_ok(files) {
    return Array.isArray(files) && files.length > 0
      && files.every((f) => f && typeof f.name === "string" && typeof f.text === "string");
  }

  function proj_id() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function proj_pack() {
    return { id: state.id, name: state.name, scratch: state.scratch, updated: state.updated,
      files: state.files, active: state.active, args: state.args, locks: state.locks || [] };
  }

  function proj_unpack(p) {
    state.id = p.id;
    state.name = p.name;
    state.scratch = p.scratch === true;
    state.updated = p.updated || Date.now();
    state.files = p.files;
    state.active = Math.min(Math.max(0, p.active | 0), p.files.length - 1);
    state.args = typeof p.args === "string" ? p.args : "";
    state.locks = Array.isArray(p.locks) ? p.locks.filter((x) => typeof x === "string") : [];
    store.snaps = ls_get(LS_SNAP + p.id) || [];
    if (!Array.isArray(store.snaps)) {
      store.snaps = [];
    }
    store.slots = 0;
  }

  function proj_name_free(want) {
    const taken = new Set(store.others.map((p) => p.name).concat(state.name));
    let name = want;
    for (let n = 2; taken.has(name); n++) {
      name = want + " " + n;
    }
    return name;
  }

  function store_main() {
    ls_set(LS_MAIN, { current: state.id, order: [state.id].concat(store.others.map((p) => p.id)),
      live: state.live, size: state.size, lang, ai: state.ai, fonts: state.fonts });
  }

  // The browser's language when the page speaks it, else English.
  function lang_guess() {
    const want = (navigator.language || "").toLowerCase();
    return /^fr\b/.test(want) ? "fr" : /^pt\b/.test(want) ? "pt" : "en";
  }

  // The language an assistant is asked to answer in.
  const LANG_NAMES = { en: "English", fr: "French", pt: "Brazilian Portuguese" };

  function ex_text(x) {
    return typeof x === "string" ? x : x[lang] || x.en;
  }

  function store_load() {
    const main = ls_get(LS_MAIN);
    lang = main && LANGS[main.lang] ? main.lang : lang_guess();
    state.fonts = !(main && main.fonts === false);
    if (main && main.ai && typeof main.ai === "object") {
      if (Array.isArray(main.ai.profiles)) {
        state.ai.profiles = main.ai.profiles.filter((p) => p && typeof p.id === "string" && AI_PROVIDERS[p.provider]);
        state.ai.active = state.ai.profiles.some((p) => p.id === main.ai.active) ? main.ai.active : "";
      } else if (AI_PROVIDERS[main.ai.provider] && main.ai.provider !== "none") {
        // the one assistant of before profiles: it becomes the first profile
        const p = { id: proj_id(), name: AI_PROVIDERS[main.ai.provider].label, provider: main.ai.provider,
          url: main.ai.url || "", model: main.ai.model || "", key: main.ai.key || "", models: [] };
        state.ai.profiles = [p];
        state.ai.active = p.id;
      }
    }
    if (main && Array.isArray(main.order)) {
      state.live = main.live !== false;
      state.size = Math.min(22, Math.max(11, Number(main.size) || 14));
      const all = main.order.map((id) => ls_get(LS_PROJ + id))
        .filter((p) => p && typeof p.id === "string" && typeof p.name === "string" && files_ok(p.files));
      const cur = all.find((p) => p.id === main.current) || all[0];
      if (cur) {
        store.others = all.filter((p) => p !== cur);
        proj_unpack(cur);
        return;
      }
    }
    // first visit, or a workspace from before projects existed
    const old = ls_get(LS_OLD);
    const had = old && files_ok(old.files);
    if (had) {
      state.live = old.live !== false;
      state.size = Math.min(22, Math.max(11, Number(old.size) || 14));
    }
    proj_unpack({ id: proj_id(), name: had ? t("my_project") : ex_text(EXAMPLES[0].title), scratch: !had,
      files: had ? old.files : state.files, active: had ? old.active : 0, args: had ? old.args : "" });
    store_flush();
  }

  let save_timer = 0;

  function store_flush() {
    clearTimeout(save_timer);
    ls_set(LS_PROJ + state.id, proj_pack());
    store_main();
  }

  function store_save() {
    state.updated = Date.now();
    clearTimeout(save_timer);
    save_timer = setTimeout(store_flush, 400);
  }

  // Hub
  // ===
  // The hub's files, as the CLI keeps them under ~/.bend/lib: 0x<hash>/...
  // for a package's files and names/<name>@<version> for the hash a name
  // stands for. A check that fetched any brings them back, and they are
  // kept here, for every project: a package is named by its hash, so it
  // never changes. Where the page cannot reach the hub (claude.ai's viewer),
  // a zip of ~/.bend/lib, or of one package's folder, fills the cache.
  // The modules a project imports open as read-only tabs.

  const LS_HUB = "bend-play:hub";
  const hub = { files: {}, version: 0 };
  const view = { hub: null, file: null };

  function hub_load() {
    const got = ls_get(LS_HUB);
    if (got && got.files && typeof got.files === "object") {
      hub.files = got.files;
      hub.version += 1;
    }
  }

  function hub_merge(news) {
    let n = 0;
    for (const [k, v] of Object.entries(news || {})) {
      if (typeof v === "string" && hub.files[k] !== v) {
        hub.files[k] = v;
        n += 1;
      }
    }
    if (n > 0) {
      hub.version += 1;
      ls_set(LS_HUB, { files: hub.files });
      if (typeof files_paint === "function" && document.readyState !== "loading") {
        files_paint();
      }
    }
    return n;
  }

  // The package path an import names: 0x<hash>/a/b.bend, or name@version/...
  // through the names the cache knows.
  function hub_rel(path) {
    const nv = /^([^/]*@[^/]*)\//.exec(path);
    if (nv === null) {
      return /^0x[0-9a-f]+\//.test(path) ? path : null;
    }
    const hash = (hub.files["names/" + nv[1]] || "").trim();
    return /^0x[0-9a-f]{32}$/.test(hash) ? hash + path.slice(nv[1].length) : null;
  }

  // The hub modules the open project imports, directly or through another
  // hub module: [{alias, rel}], each once.
  function hub_imports() {
    const out = [];
    const seen = new Set();
    const visit = (text, from, alias0) => {
      for (const m of text.matchAll(/^import\s+(\S+\.bend)\s+as\s+([A-Za-z_]\w*)/gm)) {
        let rel = null;
        if (/^\.{1,2}\//.test(m[1]) && from !== null) {
          rel = path_join(from.slice(0, from.lastIndexOf("/") + 1), m[1]);
        } else if (!/^\.{1,2}\//.test(m[1])) {
          rel = hub_rel(m[1]);
        }
        if (rel !== null && !seen.has(rel) && hub.files[rel] !== undefined) {
          seen.add(rel);
          out.push({ alias: from === null ? m[2] : alias0 + "·" + m[2], rel });
          visit(hub.files[rel], rel, from === null ? m[2] : alias0);
        }
      }
    };
    for (const f of state.files) {
      if (f.name.endsWith(".bend")) {
        visit(f.text, null, "");
      }
    }
    return out;
  }

  function path_join(dir, rel) {
    const parts = [];
    for (const seg of (dir + rel).split("/")) {
      if (seg === "..") {
        parts.pop();
      } else if (seg !== "." && seg !== "") {
        parts.push(seg);
      }
    }
    return parts.join("/");
  }

  function hub_pick(rel, alias) {
    if (hub.files[rel] === undefined) {
      return;
    }
    view.hub = rel;
    view.file = { name: "hub:" + rel, text: hub.files[rel], ro: true, alias: alias || "" };
    ed.ta.readOnly = true;
    files_paint();
    ed_set(view.file.text);
    ed.box.scrollTop = 0;
    ed.box.scrollLeft = 0;
    laws_set(null);
    diag_show(null);
    verdict_set("idle", t("hub_ro", rel.split("/").pop()));
  }

  function hub_leave() {
    view.hub = null;
    view.file = null;
    ed.ta.readOnly = false;
  }

  // A zip from ~/.bend/lib: its 0x<hash>/ folders and names/ entries go to
  // the cache, checked against the package's manifest when there is one.
  async function hub_take(entries) {
    const got = {};
    for (const e of entries) {
      const m = /(?:^|\/)((?:0x[0-9a-f]{32}\/.+)|(?:names\/[a-z][a-z0-9-]*@[0-9.]+))$/.exec(e.name);
      if (m !== null && !m[1].includes("..")) {
        got[m[1]] = e.text;
      }
    }
    const pkgs = new Set(Object.keys(got).filter((k) => k.startsWith("0x")).map((k) => k.split("/")[0]));
    const sha = async (text) => {
      const sum = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return [...new Uint8Array(sum)].map((b) => b.toString(16).padStart(2, "0")).join("");
    };
    if (window.crypto && crypto.subtle) {
      for (const pkg of pkgs) {
        const man = got[pkg + "/manifest"];
        if (man === undefined) {
          continue;
        }
        const bad = (await sha(man)).slice(0, 32) !== pkg.slice(2)
          || (await Promise.all(man.trim().split("\n").map(async (l) => {
            const [h, p] = l.split(" ");
            return got[pkg + "/" + p] !== undefined && (await sha(got[pkg + "/" + p])).slice(0, h.length) !== h;
          }))).some((x) => x);
        if (bad) {
          for (const k of Object.keys(got)) {
            if (k.startsWith(pkg + "/")) {
              delete got[k];
            }
          }
          toast(t("hub_bad", pkg));
        }
      }
    }
    return hub_merge(got);
  }

  // Snapshots
  // =========
  // A state worth coming back to is kept without being asked: each time the
  // open file checks, or checks but for its open goals. Edits within three
  // minutes share a slot, so a burst of typing costs one entry, not thirty;
  // the first slot since the project was opened is left alone, so the state
  // a session started from stays within reach.

  function snap_files() {
    return state.files.map((f) => [f.name, f.text]);
  }

  function snap_take(label, keep) {
    const files = snap_files();
    const text = JSON.stringify(files);
    const last = store.snaps[store.snaps.length - 1];
    if (last && JSON.stringify(last.files) === text) {
      return false;
    }
    const now = Date.now();
    if (!keep && last && !last.keep && store.slots >= 2 && now - last.born < SNAP_SLOT) {
      last.files = files;
      last.at = now;
      last.label = label;
    } else {
      store.snaps.push({ at: now, born: now, label, keep: keep === true, files });
      store.slots += 1;
    }
    while (store.snaps.length > SNAP_CAP) {
      const i = store.snaps.findIndex((x) => !x.keep);
      store.snaps.splice(i < 0 ? 0 : i, 1);
    }
    ls_set(LS_SNAP + state.id, store.snaps);
    return true;
  }

  // Drops the oldest automatic snapshot of the longest history; false when
  // there is nothing left to drop.
  function snap_prune() {
    let best = null;
    const ids = [state.id].concat(store.others.map((p) => p.id));
    for (const id of ids) {
      const list = id === state.id ? store.snaps : ls_get(LS_SNAP + id);
      if (Array.isArray(list) && list.some((x) => !x.keep) && (best === null || list.length > best.list.length)) {
        best = { id, list };
      }
    }
    if (best === null) {
      return false;
    }
    best.list.splice(best.list.findIndex((x) => !x.keep), 1);
    try {
      window.localStorage.setItem(LS_SNAP + best.id, JSON.stringify(best.list));
    } catch (e) {
      ls_del(LS_SNAP + best.id);
    }
    return true;
  }

  function file_now() {
    return view.file !== null ? view.file : state.files[state.active];
  }

  function files_map() {
    return Object.fromEntries(state.files.map((f) => [f.name, f.text]));
  }

  // Highlight
  // =========

  const TOK = new RegExp([
    "(#[^\\n]*)",                                                  // 1 comment
    "(\"(?:[^\"\\\\\\n]|\\\\.)*\"?)",                              // 2 string
    "('(?:\\\\u\\{[0-9a-fA-F]+\\}|\\\\.|[^'\\\\\\n])')",           // 3 char
    "(\\{==\\})",                                                  // 4 refl
    "(\\?[A-Za-z_][\\w.]*)",                                       // 5 hole
    "(@unsafe\\b)",                                                // 6 attribute
    "(&[012]\\b|\\b0x[0-9a-fA-F]+\\b|\\b\\d+(?:\\.\\d+)?n?\\b)",   // 7 number
    "([A-Za-z_][\\w.$]*)",                                         // 8 name
    "(->|=>|<-|<>|\\+\\+|&&|\\|\\||==|!=|<=|>=|<<|>>|\\.&\\.|\\.\\|\\.|\\.\\^\\.|[+\\-*\\/%&|~!=<>:@])", // 9 operator
  ].join("|"), "g");

  const KW = new Set(["def", "type", "law", "match", "case", "do", "return",
    "for", "exs", "where", "is", "import"]);
  const KINDS = new Set(["Type", "Data", "Kind", "Quant"]);

  function highlight(src) {
    let out = "";
    let at = 0;
    let names_def = false;
    let line_import = false;
    TOK.lastIndex = 0;
    for (let m = TOK.exec(src); m !== null; m = TOK.exec(src)) {
      if (m.index > at) {
        const gap = src.slice(at, m.index);
        if (gap.includes("\n")) {
          line_import = false;
        }
        out += esc(gap);
      }
      at = m.index + m[0].length;
      const t = m[0];
      let cls = "";
      if (m[1] !== undefined) {
        cls = "com";
      } else if (m[2] !== undefined || m[3] !== undefined) {
        cls = "str";
      } else if (m[4] !== undefined) {
        cls = "qed";
      } else if (m[5] !== undefined) {
        cls = "hol";
      } else if (m[6] !== undefined) {
        cls = "kw";
      } else if (m[7] !== undefined) {
        cls = "num";
      } else if (m[8] !== undefined) {
        if (names_def) {
          cls = "def";
        } else if (KW.has(t) || (t === "as" && line_import)) {
          cls = "kw";
          line_import = line_import || t === "import";
        } else if (KINDS.has(t)) {
          cls = "ty";
        } else {
          const last = t.slice(t.lastIndexOf(".") + 1);
          cls = /^[A-Z]/.test(last) ? "ty" : "";
        }
        names_def = cls === "kw" && (t === "def" || t === "law" || t === "type");
      } else {
        cls = "op";
      }
      if (m[8] === undefined) {
        names_def = false;
      }
      out += cls === "" ? esc(t) : "<span class=\"tk-" + cls + "\">" + esc(t) + "</span>";
      if (at === m.index) {
        TOK.lastIndex += 1;
      }
    }
    return out + esc(src.slice(at));
  }

  const JS_TOK = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\b\d+(?:\.\d+)?n?\b)|\b(function|return|const|let|var|if|else|for|while|do|break|continue|switch|case|default|new|typeof|throw|try|catch|true|false|null|undefined|export|import|async|await|yield|of|in|static|inline|void|struct|typedef|enum|union|sizeof|goto|unsigned|signed|int|char|long|short|bool|u8|u16|u32|u64|i32|i64|f32|f64|kernel|device|constant)\b/g;

  function highlight_js(src) {
    let out = "";
    let at = 0;
    JS_TOK.lastIndex = 0;
    for (let m = JS_TOK.exec(src); m !== null; m = JS_TOK.exec(src)) {
      out += esc(src.slice(at, m.index));
      at = m.index + m[0].length;
      const cls = m[1] !== undefined ? "com" : m[2] !== undefined ? "str" : m[3] !== undefined ? "num" : "kw";
      out += "<span class=\"tk-" + cls + "\">" + esc(m[0]) + "</span>";
    }
    return out + esc(src.slice(at));
  }

  // Editor
  // ======

  const ed = {
    box: $("#ed"), ta: $("#ed-ta"), hl: $("#ed-hl"), gut: $("#ed-gutter"),
    mark: $("#ed-mark"), marks: $("#ed-marks"), chw: 8, lh: 22, pad: 12,
    err_line: 0, err: null, raf: 0,
  };

  // The offset of a 1-based line and column in the text.
  function text_offset(text, line, col) {
    let pos = 0;
    for (let l = 1; l < line; l++) {
      const nl = text.indexOf("\n", pos);
      if (nl < 0) {
        return text.length;
      }
      pos = nl + 1;
    }
    const nl = text.indexOf("\n", pos);
    return Math.min(pos + Math.max(0, col - 1), nl < 0 ? text.length : nl);
  }

  // The exact span of the error, underlined on a layer of its own: the same
  // text in the same font, invisible but for the marks.
  function ed_marks(text) {
    const w = ed.err;
    if (w === null) {
      return "";
    }
    const a = text_offset(text, w.line, w.col);
    let b = Math.max(a, text_offset(text, w.end_line, w.end_col));
    if (w.end_line - w.line > 12) {
      const nl = text.indexOf("\n", a);
      b = nl < 0 ? text.length : nl;
    }
    if (b === a && a < text.length && text[a] !== "\n") {
      b = a + 1;
    }
    const mid = b === a ? "<mark class=\"eol\"> </mark>" : "<mark>" + esc(text.slice(a, b)) + "</mark>";
    return esc(text.slice(0, a)) + mid + esc(text.slice(b)) + "\n";
  }

  function ed_measure() {
    const probe = el("span", { style: "position:absolute;visibility:hidden;white-space:pre", text: "M".repeat(50) });
    ed.hl.append(probe);
    ed.chw = probe.getBoundingClientRect().width / 50 || 8;
    probe.remove();
    ed.lh = Math.round(state.size * 1.55);
    ed.pad = parseFloat(getComputedStyle(ed.hl.parentNode).paddingTop) || 12;
  }

  function ed_paint() {
    const text = ed.ta.value;
    ed.hl.innerHTML = (file_now().name.endsWith(".js") ? highlight_js(text) : highlight(text)) + "\n";
    const n = text.split("\n").length;
    let g = "";
    for (let i = 1; i <= n; i++) {
      g += i === ed.err_line ? "<span class=\"err\">" + i + "</span>\n" : i + "\n";
    }
    ed.gut.innerHTML = g;
    ed.marks.innerHTML = ed_marks(text);
    ed.mark.hidden = ed.err_line === 0 || ed.err_line > n;
    if (!ed.mark.hidden) {
      ed.mark.style.top = (ed.pad + (ed.err_line - 1) * ed.lh) + "px";
    }
  }

  function ed_paint_soon() {
    cancelAnimationFrame(ed.raf);
    ed.raf = requestAnimationFrame(ed_paint);
  }

  function ed_set(text) {
    ed.ta.value = text;
    ed.ta.setSelectionRange(0, 0);
    ed.err_line = 0;
    ed.err = null;
    ed_paint();
  }

  // Marks the error in the open file: its line in the gutter, its span in the text.
  function ed_error(w) {
    ed.err = w || null;
    ed.err_line = w ? w.line : 0;
    ed_paint_soon();
  }

  function ed_caret() {
    const head = ed.ta.value.slice(0, ed.ta.selectionEnd);
    const line = head.split("\n").length;
    return { line, col: head.length - head.lastIndexOf("\n") - 1 };
  }

  // Keeps the caret inside the scroller: the textarea never scrolls itself.
  function ed_reveal() {
    const { line, col } = ed_caret();
    const pad = ed.pad;
    const gut = ed.gut.offsetWidth;
    const y = pad + (line - 1) * ed.lh;
    const x = gut + pad + col * ed.chw;
    const b = ed.box;
    if (y < b.scrollTop + ed.lh) {
      b.scrollTop = Math.max(0, y - ed.lh);
    } else if (y + ed.lh * 2 > b.scrollTop + b.clientHeight) {
      b.scrollTop = y + ed.lh * 2 - b.clientHeight;
    }
    if (x - gut < b.scrollLeft + ed.chw * 2) {
      b.scrollLeft = Math.max(0, x - gut - ed.chw * 4);
    } else if (x + ed.chw * 3 > b.scrollLeft + b.clientWidth) {
      b.scrollLeft = x + ed.chw * 6 - b.clientWidth;
    }
  }

  // Puts the caret at a place, or selects a span so it cannot be missed.
  function ed_goto(line, col, end_line, end_col) {
    const text = ed.ta.value;
    const a = text_offset(text, line, col || 1);
    const b = end_line === undefined ? a : Math.max(a, text_offset(text, end_line, end_col));
    ed.ta.focus({ preventScroll: true });
    ed.ta.setSelectionRange(a, b);
    ed_reveal();
  }

  // Inserts through execCommand so the browser's undo stack survives.
  function ed_insert(text) {
    if (agent_guard()) {
      return;
    }
    ed.ta.focus({ preventScroll: true });
    let ok = false;
    try {
      ok = text === "" ? document.execCommand("delete") : document.execCommand("insertText", false, text);
    } catch (e) {}
    if (!ok) {
      ed.ta.setRangeText(text, ed.ta.selectionStart, ed.ta.selectionEnd, "end");
      ed.ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  function ed_newline() {
    const v = ed.ta.value;
    const a = ed.ta.selectionStart;
    const from = v.lastIndexOf("\n", a - 1) + 1;
    const head = v.slice(from, a);
    let ind = /^ */.exec(head)[0];
    if (/:\s*(#.*)?$/.test(head) && !/^\s*#/.test(head)) {
      ind += "  ";
    }
    ed_insert("\n" + ind);
  }

  // Shifts the selected lines (or the caret's line) by two spaces.
  function ed_shift(out) {
    const v = ed.ta.value;
    const a = ed.ta.selectionStart;
    const b = ed.ta.selectionEnd;
    if (a === b && !out) {
      const from = v.lastIndexOf("\n", a - 1) + 1;
      ed_insert((a - from) % 2 === 1 && /^ *$/.test(v.slice(from, a)) ? " " : "  ");
      return;
    }
    const from = v.lastIndexOf("\n", a - 1) + 1;
    let to = v.indexOf("\n", Math.max(b - 1, a));
    to = to < 0 ? v.length : to;
    const block = v.slice(from, to);
    let da = 0;
    let dt = 0;
    const next = block.split("\n").map((l, i) => {
      const d = out ? -Math.min(2, /^ */.exec(l)[0].length) : (l === "" ? 0 : 2);
      if (i === 0) {
        da = out ? Math.max(d, from - a) : d;
      }
      dt += d;
      return d < 0 ? l.slice(-d) : " ".repeat(d) + l;
    }).join("\n");
    if (next === block) {
      return;
    }
    ed.ta.setSelectionRange(from, to);
    ed_insert(next);
    ed.ta.setSelectionRange(a + da, a === b ? a + da : b + dt);
  }

  function ed_init() {
    const has_before = typeof InputEvent !== "undefined"
      && typeof InputEvent.prototype.getTargetRanges === "function";
    ed.ta.addEventListener("beforeinput", (e) => {
      if (e.isComposing) {
        return;
      }
      if (e.inputType === "insertLineBreak") {
        e.preventDefault();
        ed_newline();
      } else if (e.inputType === "insertText" && e.data && /[\u201C\u201D\u2018\u2019\u2014\u2013\u2026]/.test(e.data)) {
        // phone keyboards "correct" quotes and dashes into characters Bend rejects
        e.preventDefault();
        ed_insert(e.data.replace(/[\u201C\u201D]/g, "\"").replace(/[\u2018\u2019]/g, "'")
          .replace(/\u2014/g, "--").replace(/\u2013/g, "-").replace(/\u2026/g, "..."));
      }
    });
    ed.ta.addEventListener("keydown", (e) => {
      if (e.isComposing) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        run_start(true);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        run_start(false);
      } else if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        ed_shift(e.shiftKey);
      } else if (e.key === "Enter" && !has_before) {
        e.preventDefault();
        ed_newline();
      } else if (e.key === "Backspace" && ed.ta.selectionStart === ed.ta.selectionEnd) {
        const v = ed.ta.value;
        const a = ed.ta.selectionStart;
        const from = v.lastIndexOf("\n", a - 1) + 1;
        const head = v.slice(from, a);
        if (head.length >= 2 && head.length % 2 === 0 && /^ +$/.test(head)) {
          e.preventDefault();
          ed.ta.setSelectionRange(a - 2, a);
          ed_insert("");
        }
      }
    });
    ed.ta.addEventListener("input", () => {
      file_now().text = ed.ta.value;
      proj_touch();
      out_soon();
      out.log.classList.add("stale");
      ed.err_line = 0;
      ed.err = null;
      tip_hide();
      ed_paint_soon();
      store_save();
      live_soon();
      requestAnimationFrame(ed_reveal);
    });
    ed.ta.addEventListener("focus", () => {
      if (COARSE && !WIDE.matches && panel.state !== "closed") {
        panel_set("closed");
      }
    });
    ed.box.addEventListener("click", (e) => {
      if (e.target === ed.box || e.target === ed.gut) {
        ed.ta.focus({ preventScroll: true });
      }
    });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        ed_measure();
        ed_paint();
      });
    }
  }

  // Key bar
  // =======

  const KEYS = ["⇥", "⇤", "|", "(", ")", ":", "{", "}", "->", ",", ".", "=", "+", "<", ">", "[", "]",
    "\"", "_", "#", "&", "~", "%", "?", "!", "'", "=>", "<-", "<>", "++", "*", "/", "-", "@", "{==}",
    "|", "def ", "match ", "case ", "law ", "type ", "do ", "return ", "#goal:", "|", "↶", "↷"];

  function keys_init() {
    const bar = $("#keys");
    bar.textContent = "";
    for (const k of KEYS) {
      if (k === "|") {
        bar.append(el("i"));
        continue;
      }
      const ctl = "⇥⇤↶↷".includes(k);
      const names = { "⇥": "key_indent", "⇤": "key_dedent", "↶": "key_undo", "↷": "key_redo" };
      const b = el("button", { type: "button", tabindex: "-1",
        class: ctl ? "ctl" : /^[a-z]/.test(k) ? "word" : "", text: k.trim(),
        "aria-label": names[k] ? t(names[k]) : k.trim() });
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => {
        if (k === "⇥" || k === "⇤") {
          ed.ta.focus({ preventScroll: true });
          ed_shift(k === "⇤");
        } else if (k === "↶" || k === "↷") {
          ed.ta.focus({ preventScroll: true });
          try {
            document.execCommand(k === "↶" ? "undo" : "redo");
          } catch (e) {}
        } else if (k === "#goal:") {
          marks_insert();
        } else {
          ed_insert(k);
        }
      });
      bar.append(b);
    }
  }

  // Compiler
  // ========
  // bend.ts and comp.ts run in a worker built from this page's own bundle, so
  // a long check never freezes the editor and can be stopped. Where a worker
  // cannot start, the same bundle runs on the page.

  const WORKER_GLUE = `
    var chain = Promise.resolve();
    self.onmessage = function (ev) {
      var m = ev.data;
      chain = chain.then(function () {
        return m.op === "tt" ? BendCore.bendtt(m.files, m.entry, m.lib)
          : m.op === "emit" ? BendCore.emit(m.files, m.entry, m.target, m.lib, m.extra)
          : BendCore.run(m.files, m.entry, m.emit, m.lib);
      }).then(function (out) {
        self.postMessage({ id: m.id, out: out });
      }, function (e) {
        self.postMessage({ id: m.id, out: { ok: false, text: "Error: " + String(e && e.message || e), ms: { check: 0, emit: 0 } } });
      });
    };
    self.postMessage({ ready: true });
  `;

  const comp = { mode: null, worker: null, boot: null, seq: 0, waits: new Map(), line: Promise.resolve(), lib_sent: -1 };

  function comp_boot() {
    if (comp.boot !== null) {
      return comp.boot;
    }
    comp.boot = new Promise((done) => {
      let settled = false;
      const fall = () => {
        if (!settled) {
          settled = true;
          if (comp.worker) {
            comp.worker.terminate();
            comp.worker = null;
          }
          comp.mode = "page";
          done("page");
        }
      };
      try {
        const url = URL.createObjectURL(new Blob([CORE_SRC, "\n", WORKER_GLUE], { type: "text/javascript" }));
        const w = new Worker(url);
        comp.worker = w;
        comp.lib_sent = -1;
        comp.extra_sent = false;
        w.onmessage = (ev) => {
          if (ev.data.ready) {
            if (!settled) {
              settled = true;
              comp.mode = "worker";
              done("worker");
            }
            return;
          }
          const wait = comp.waits.get(ev.data.id);
          if (wait) {
            comp.waits.delete(ev.data.id);
            wait(ev.data.out);
          }
        };
        w.onerror = (e) => {
          if (!settled) {
            fall();
          } else {
            const waits = [...comp.waits.values()];
            comp.waits.clear();
            comp.worker = null;
            comp.boot = null;
            waits.forEach((f) => f({ ok: false, text: "Error: the checker crashed (" + (e.message || "out of memory?") + ")", ms: { check: 0, emit: 0 } }));
          }
        };
        setTimeout(fall, 6000);
      } catch (e) {
        fall();
      }
    });
    return comp.boot;
  }

  // The hub's files the checker has not been given yet: all of them once
  // per checker, then nothing until the cache grows.
  function lib_due() {
    if (comp.lib_sent === hub.version) {
      return undefined;
    }
    comp.lib_sent = hub.version;
    return hub.files;
  }

  // op: "run" (check, and emit JS for a run when emit), "tt" (BendTT), or
  // "emit" with opts.target, one of the compiler's outputs; opts.extra, the
  // files that target reads, sent once per checker.
  async function comp_ask(entry, emit, files = files_map(), op = "run", opts = {}) {
    const mode = await comp_boot();
    const extra = opts.extra && comp.extra_sent !== true ? opts.extra : undefined;
    if (extra) {
      comp.extra_sent = true;
    }
    const call = (C, lib, more) => (op === "tt" ? C.bendtt(files, entry, lib)
      : op === "emit" ? C.emit(files, entry, opts.target, lib, more) : C.run(files, entry, emit, lib));
    let out;
    if (mode === "page") {
      const turn = comp.line.then(() => new Promise((r) => setTimeout(r, 30)))
        .then(() => call(Core, lib_due(), extra));
      comp.line = turn.catch(() => {});
      out = await turn;
    } else {
      const lib = lib_due();
      out = await new Promise((done) => {
        const id = ++comp.seq;
        comp.waits.set(id, done);
        comp.worker.postMessage({ id, files, entry, emit, op, lib, target: opts.target, extra });
      });
      if (out.overflow) {
        // A worker's stack is smaller than the page's, and the compiler recurses
        // deep on large programs: what overflowed there gets one try here.
        await new Promise((r) => setTimeout(r, 30));
        out = await call(Core, hub.files, opts.extra);
        out.page = true;
      }
    }
    hub_merge(out.lib_new);
    return out;
  }

  function comp_cancel() {
    if (comp.mode !== "worker" || comp.worker === null) {
      return;
    }
    comp.worker.terminate();
    comp.worker = null;
    comp.lib_sent = -1;
    comp.extra_sent = false;
    comp.boot = null;
    const waits = [...comp.waits.values()];
    comp.waits.clear();
    waits.forEach((f) => f({ ok: false, stopped: true, text: "", ms: { check: 0, emit: 0 } }));
  }

  // Runner
  // ======
  // The compiled program is the source of its own worker: nothing is eval'd,
  // and Stop is a terminate. The page itself is the fallback.

  const WORKER_HOST = `
    var __bendHost = (function (cfg) {
      var buf = [], size = 0, last = performance.now();
      var host = {
        args: cfg.args,
        env: cfg.env,
        write: function (fd, text) {
          if (text === "") { return; }
          var top = buf[buf.length - 1];
          if (top && top[0] === fd) { top[1] += text; } else { buf.push([fd, text]); }
          size += text.length;
          if (size > 32768 || performance.now() - last > 40) { host.flush(); }
        },
        flush: function () {
          if (buf.length > 0) { self.postMessage({ out: buf }); buf = []; size = 0; }
          last = performance.now();
        },
        exit: function (code) { self.postMessage({ exit: code }); },
        wait: function (ms) {
          try {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
          } catch (e) {
            var until = performance.now() + ms;
            while (performance.now() < until) {}
          }
        }
      };
      host.inbox = [];
      host.pool = [];
      host.flying = 0;
      host.post = function (msg, transfer) { self.postMessage(msg, transfer || []); };
      self.onmessage = function (ev) {
        var m = ev.data;
        if (m.ev) {
          host.inbox.push(m.ev);
          if (host.inbox.length > 4096) { host.inbox.shift(); }
        } else if (m.recycle) {
          host.pool.push(m.recycle);
          host.flying = Math.max(0, host.flying - 1);
        }
      };
      self.postMessage({ start: true });
      return host;
    })`;

  const runner = { worker: null, stop: null, send: null };

  // A program that opens a Window gets the display tail: its IO loop yields,
  // and its window_* effects reach the page. Any other runs as compiled.
  function uses_window(js) {
    return /io_eff\("Window\.open"/.test(js);
  }

  function run_source(js, display) {
    return PRELUDE.replace("/*__TAIL__*/", () => (display ? TAIL : ""))
      .replace("/*__PROGRAM__*/", () => js);
  }

  function run_worker(js, cfg, on_out) {
    return new Promise((done, fail) => {
      let started = false;
      let w;
      try {
        const src = WORKER_HOST + "(" + JSON.stringify(cfg) + ");\n"
          + run_source(js, uses_window(js)) + "(__bendHost);";
        w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
      } catch (e) {
        fail(e);
        return;
      }
      const t0 = performance.now();
      const end = (r) => {
        w.terminate();
        runner.worker = null;
        runner.stop = null;
        runner.send = null;
        done({ ...r, ms: performance.now() - t0 });
      };
      runner.worker = w;
      runner.send = (ev) => w.postMessage({ ev });
      runner.stop = () => end({ code: null, stopped: true });
      w.onmessage = (ev) => {
        const m = ev.data;
        if (m.start) {
          started = true;
        } else if (m.out) {
          m.out.forEach(([fd, text]) => on_out(fd, text));
        } else if (m.win) {
          screen_win(m.win);
        } else if (m.frame) {
          screen_frame(m.frame, w);
        } else if (m.exit !== undefined) {
          end({ code: m.exit });
        }
      };
      w.onerror = (e) => {
        if (e.preventDefault) {
          e.preventDefault();
        }
        if (!started) {
          w.terminate();
          runner.worker = null;
          runner.stop = null;
          runner.send = null;
          fail(new Error(e.message || "worker"));
        } else {
          on_out(2, "bend: " + (e.message || "the program crashed") + "\n");
          end({ code: 1 });
        }
      };
    });
  }

  // Without a worker the program runs on the page. A Window program still
  // gets its display: its loop awaits between frames, so the page's own
  // events keep flowing, and Stop is heard at the next frame.
  function run_page(js, cfg, on_out) {
    return new Promise((done) => {
      const t0 = performance.now();
      let over = false;
      let last = 0;
      let warned = false;
      const end = (r) => {
        if (!over) {
          over = true;
          host.stopped = true;
          runner.send = null;
          runner.stop = null;
          done({ ...r, ms: performance.now() - t0 });
        }
      };
      const back = { postMessage: (m) => {
        host.pool.push(m.recycle);
        host.flying = Math.max(0, host.flying - 1);
      } };
      const host = { args: cfg.args, env: cfg.env, inbox: [], pool: [], flying: 0,
        alive: false, stopped: false,
        write: (fd, text) => { if (!over) { on_out(fd, text); } },
        flush() {},
        exit: (c) => end({ code: c }),
        post(m) {
          if (over) {
            return;
          }
          if (m.win) {
            screen_win(m.win);
          } else if (m.frame) {
            const now = performance.now();
            if (!warned && last > 0 && now - last > 2500) {
              warned = true;
              on_out(2, t("page_heavy"));
            }
            last = now;
            screen_frame(m.frame, back);
          }
        },
        wait(n) {
          const until = performance.now() + Math.min(n, 3000);
          while (performance.now() < until) {}
        } };
      const display = uses_window(js);
      if (display) {
        runner.send = (ev) => {
          host.inbox.push(ev);
          if (host.inbox.length > 4096) {
            host.inbox.shift();
          }
        };
        runner.stop = () => end({ code: null, stopped: true });
      }
      const src = run_source(js, display);
      try {
        new Function("__h", "return (\n" + src + "\n)(__h);")(host);
      } catch (e) {
        if (!host.alive && (e instanceof EvalError || /unsafe-eval|Content Security/i.test(String(e)))) {
          window.__bendHost = host;
          const tag = el("script");
          tag.textContent = "(\n" + src + "\n)(window.__bendHost);";
          document.head.append(tag);
          tag.remove();
        } else if (!over) {
          on_out(2, String(e) + "\n");
          end({ code: 1 });
        }
      }
      if (!host.alive) {
        end({ code: null, blocked: true });
      }
    });
  }

  async function run_program(js, cfg, on_out) {
    try {
      return await run_worker(js, cfg, on_out);
    } catch (e) {
      await new Promise((r) => setTimeout(r, 30));
      return { ...(await run_page(js, cfg, on_out)), page: true };
    }
  }

  function args_split(s) {
    const out = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    for (let m = re.exec(s); m !== null; m = re.exec(s)) {
      out.push(m[1] ?? m[2] ?? m[3]);
    }
    return out;
  }


  // Screen
  // ======
  // The canvas a Window opens on. Frames arrive as pixels from the program's
  // worker; keys and the pointer go back as the events of its next frame,
  // with the codes the native windows use: a character in lower case, the
  // arrows from 63232, a modifier past 65536.

  const scr = { canvas: $("#screen"), ctx: null, open: false, w: 0, h: 0, title: "",
    frames: 0, since: 0, fps: 0, held: new Set() };

  const KEY_CODES = { Escape: 27, Enter: 13, Tab: 9, Backspace: 127, ArrowUp: 63232, ArrowDown: 63233,
    ArrowLeft: 63234, ArrowRight: 63235, Insert: 63271, Delete: 63272, Home: 63273, End: 63275,
    PageUp: 63276, PageDown: 63277 };
  const MOD_CODES = { MetaRight: 65590, MetaLeft: 65591, ShiftLeft: 65592, CapsLock: 65593,
    AltLeft: 65594, ControlLeft: 65595, ShiftRight: 65596, AltRight: 65597, ControlRight: 65598 };

  function key_code(e) {
    if (MOD_CODES[e.code] !== undefined) {
      return MOD_CODES[e.code];
    }
    if (KEY_CODES[e.key] !== undefined) {
      return KEY_CODES[e.key];
    }
    const f = /^F(\d{1,2})$/.exec(e.key);
    if (f && Number(f[1]) >= 1 && Number(f[1]) <= 12) {
      return 63236 + Number(f[1]) - 1;
    }
    if (e.key.length === 1 || [...e.key].length === 1) {
      return e.key.toLowerCase().codePointAt(0);
    }
    return 65536 + (e.keyCode || 0);
  }

  function screen_send(ev) {
    if (scr.open && runner.send !== null) {
      runner.send(ev);
    }
  }

  function screen_info() {
    $("#screen-info").textContent = scr.w === 0 ? t("screen_none")
      : (scr.title ? scr.title + "  " : "") + scr.w + "×" + scr.h
        + (scr.open ? (scr.fps > 0 ? t("fps", scr.fps) : "") : t("screen_closed"));
    $("#screen-close").hidden = !scr.open;
    $("#pane-screen").classList.toggle("live", scr.open);
  }

  function screen_win(m) {
    if (m.open !== undefined) {
      scr.open = true;
      scr.w = m.w;
      scr.h = m.h;
      scr.title = m.title;
      scr.canvas.width = m.w;
      scr.canvas.height = m.h;
      scr.ctx = scr.canvas.getContext("2d");
      scr.ctx.fillStyle = "#000";
      scr.ctx.fillRect(0, 0, m.w, m.h);
      scr.frames = 0;
      scr.since = performance.now();
      scr.fps = 0;
      $(".tab[data-tab=screen]").hidden = false;
      tab_set("screen");
      if (!WIDE.matches) {
        panel_set("full");
      }
      ed.ta.blur();
      screen_fit();
      scr.canvas.focus({ preventScroll: true });
    } else if (m.title !== undefined) {
      scr.title = m.title;
    } else if (m.close !== undefined) {
      scr.open = false;
      scr.held.clear();
    }
    screen_info();
  }

  // The canvas takes the room there is, whole pixels kept square, and is
  // never blown up past twice its size.
  function screen_fit() {
    const wrap = scr.canvas.parentNode;
    if (scr.w === 0 || wrap.clientWidth === 0) {
      return;
    }
    const k = Math.min((wrap.clientWidth - 20) / scr.w, (wrap.clientHeight - 20) / scr.h, 2);
    const scale = k >= 1 ? Math.max(1, Math.floor(k * 2) / 2) : Math.max(k, 0.05);
    scr.canvas.style.width = Math.floor(scr.w * scale) + "px";
    scr.canvas.style.height = Math.floor(scr.h * scale) + "px";
  }

  function screen_frame(f, worker) {
    if (scr.ctx !== null && f.w === scr.w && f.h === scr.h) {
      scr.ctx.putImageData(new ImageData(new Uint8ClampedArray(f.buf), f.w, f.h), 0, 0);
      scr.frames += 1;
      const now = performance.now();
      if (now - scr.since >= 500) {
        scr.fps = Math.round(scr.frames * 1000 / (now - scr.since));
        scr.frames = 0;
        scr.since = now;
        screen_info();
      }
    }
    try {
      worker.postMessage({ recycle: f.buf }, [f.buf]);
    } catch (e) {}
  }

  // The program ended or was stopped: whatever it held is released.
  function screen_end() {
    if (scr.open) {
      scr.open = false;
      scr.held.clear();
      screen_info();
    }
  }

  function screen_point(e) {
    const r = scr.canvas.getBoundingClientRect();
    const clip = (v, most) => Math.max(0, Math.min(most - 1, Math.floor(v)));
    return [clip((e.clientX - r.left) * scr.w / r.width, scr.w), clip((e.clientY - r.top) * scr.h / r.height, scr.h)];
  }

  function screen_key(code, down) {
    if (down && scr.held.has(code)) {
      screen_send([0, code, 0]);   // a held key repeats as the native pump does: up, then down
    }
    if (down) {
      scr.held.add(code);
    } else {
      scr.held.delete(code);
    }
    screen_send([0, code, down ? 1 : 0]);
  }

  // A phone has no keys: the pad stands in for the ones games ask for,
  // a cluster under each thumb, so two keys can be held at once.
  function screen_pad() {
    const pad = $("#pad");
    const key = (label, code, area) => {
      const b = el("button", { type: "button", tabindex: "-1", text: label,
        "aria-label": t("key_named", label), style: area ? "grid-area:" + area : null });
      const up = () => {
        if (scr.held.has(code)) {
          screen_key(code, false);
        }
      };
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        try {
          b.setPointerCapture(e.pointerId);
        } catch (err) {}
        screen_key(code, true);
      });
      b.addEventListener("pointerup", up);
      b.addEventListener("pointercancel", up);
      b.addEventListener("contextmenu", (e) => e.preventDefault());
      return b;
    };
    pad.textContent = "";
    pad.append(
      el("div", { class: "pad-cross" }, key("W", 119, "u"), key("A", 97, "l"), key("S", 115, "d"), key("D", 100, "r")),
      el("div", { class: "pad-mid" }, key("Esc", 27), key("Q", 113), key("E", 101), key(t("pad_space"), 32), key(t("pad_enter"), 13)),
      el("div", { class: "pad-cross" }, key("↑", 63232, "u"), key("←", 63234, "l"), key("↓", 63233, "d"), key("→", 63235, "r")));
  }

  function screen_init() {
    const typing = (t) => t instanceof HTMLElement
      && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable);
    for (const type of ["keydown", "keyup"]) {
      document.addEventListener(type, (e) => {
        if (!scr.open || panel.tab !== "screen" || typing(e.target) || e.ctrlKey || e.metaKey) {
          return;
        }
        e.preventDefault();
        screen_key(key_code(e), type === "keydown");
      });
    }
    const c = scr.canvas;
    c.addEventListener("pointerdown", (e) => {
      if (!scr.open) {
        return;
      }
      e.preventDefault();
      c.focus({ preventScroll: true });
      try {
        c.setPointerCapture(e.pointerId);
      } catch (err) {}
      const [x, y] = screen_point(e);
      screen_send([2, x, y]);
      screen_send([1, x, y, [0, 2, 1][e.button] || 0, 1]);
    });
    c.addEventListener("pointerup", (e) => {
      const [x, y] = screen_point(e);
      screen_send([1, x, y, [0, 2, 1][e.button] || 0, 0]);
    });
    c.addEventListener("pointermove", (e) => {
      if (scr.open) {
        const [x, y] = screen_point(e);
        screen_send([2, x, y]);
      }
    });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    $("#screen-close").addEventListener("click", () => screen_send([3]));
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(screen_fit).observe(scr.canvas.parentNode);
    }
    window.addEventListener("resize", screen_fit);
    screen_pad();
    screen_info();
  }

  // Output
  // ======

  const out = { diag: $("#diag"), log: $("#log"), hint: $("#out-hint"), size: 0, last: null };
  const OUT_CAP = 300000;

  function out_clear() {
    out.log.textContent = "";
    out.log.classList.remove("stale");
    out.size = 0;
    out.last = null;
    out.hint.hidden = true;
  }

  function out_add(cls, text) {
    if (out.last !== null && out.last.className === cls) {
      out.last.append(text);
    } else {
      out.last = el("span", { class: cls, text });
      out.log.append(out.last);
    }
    out.size += text.length;
    while (out.size > OUT_CAP && out.log.firstChild !== out.last) {
      out.size -= out.log.firstChild.textContent.length;
      out.log.firstChild.remove();
    }
    if (out.size > OUT_CAP * 2) {
      const keep = out.last.textContent.slice(-OUT_CAP);
      out.last.textContent = keep;
      out.size = keep.length;
    }
    const pane = $("#pane-out");
    pane.scrollTop = pane.scrollHeight;
  }

  function where_label(w) {
    return t("where_label", w.file, w.line, w.col);
  }

  function where_go(w) {
    if (w.file !== null && w.file.startsWith("hub:")) {
      if (view.hub !== w.file.slice(4)) {
        hub_pick(w.file.slice(4));
      }
    } else if (w.file !== null) {
      const i = state.files.findIndex((f) => f.name === w.file);
      if (i >= 0 && (i !== state.active || view.hub !== null)) {
        files_pick(i);
      }
    }
    if (!WIDE.matches && panel.state === "full") {
      panel_set("closed");
    }
    ed_goto(w.line, w.col, w.end_line, w.end_col);
    if (w.end_line !== undefined && !w.goal) {
      ed_error(w);
    }
  }

  function goto_link(text, w) {
    return el("span", { class: "goto", role: "link", tabindex: "0", text,
      onclick: () => where_go(w),
      onkeydown: (e) => { if (e.key === "Enter") { where_go(w); } } });
  }

  function goal_where(g) {
    return { file: g.file, line: g.line, col: g.col, end_line: g.line,
      end_col: g.col + g.name.length + 1, goal: true };
  }

  // A check's report: the verdict, or the error with a link to its location.
  function diag_make(r) {
    const box = document.createDocumentFragment();
    if (r.ok) {
      box.append(el("span", { class: "ok", text: "∎ " + r.text + "\n" }));
      return box;
    }
    // the goals broken to the pane's width, as in the cards
    const pane = $("#pane-out");
    const chw = (goals.chw || 7.5) * 13 / 12.5;
    const cols = Math.max(30, Math.floor(((pane.clientWidth || 480) - 36) / chw));
    const hang = (lead, text) => {
      const lines = pp(text, cols - lead.length);
      return lead + lines.join("\n" + " ".repeat(lead.length)) + "\n";
    };
    for (const g of r.goals || []) {
      box.append(el("span", { class: "goalmark", text: "? " }),
        goto_link("?" + g.name + "  " + t("where_line", g.file, g.line), goal_where(g)), "\n");
      for (const [k, ty] of g.ctx) {
        box.append(el("span", { class: "dim", text: hang("  " + k + " : ", ty) }));
      }
      box.append(el("span", { class: "errbody", text: hang("  ⊢ ", g.expected) + "\n" }));
    }
    if (r.open) {
      box.append(el("span", { class: "goalmark", text: open_brief(r) + "\n" }));
      return box;
    }
    if (r.where) {
      box.append(el("span", { class: "err", text: "✗ " }), goto_link(where_label(r.where), r.where), "\n");
    }
    box.append(el("span", { class: "errbody", text: r.text + "\n" }));
    if (ai.on()) {
      box.append(el("span", { class: "goto", role: "link", tabindex: "0", text: t("ai_explain"),
        onclick: () => ai_sheet({ kind: "error", r }),
        onkeydown: (e) => { if (e.key === "Enter") { ai_sheet({ kind: "error", r }); } } }), "\n");
    }
    return box;
  }

  // The block above the log always holds the latest live check of the open
  // file; a run writes its own report into the log, under its command line.
  function diag_show(r) {
    out.diag.textContent = "";
    if (r !== null) {
      out.hint.hidden = true;
      out.diag.append(diag_make(r));
      if (out.log.textContent !== "") {
        out.diag.append("\n");
      }
    }
  }

  function out_report(r) {
    out.diag.textContent = "";
    out.log.append(diag_make(r));
    out.last = null;
  }

  // Verdict strip
  // =============

  const verdict = { btn: $("#verdict"), text: $("#verdict-text"), seal: $("#seal"),
    laws: $("#laws"), state: "idle" };

  function err_brief(r) {
    const exp = /^- expected : (.*)$/m.exec(r.text);
    const obs = /^- observed : (.*)$/m.exec(r.text);
    const msg = /^- message  : (.*)$/m.exec(r.text);
    const what = exp && obs ? "expected " + exp[1] + ", observed " + obs[1]
      : msg ? msg[1] : r.text.replace(/^Error:\s*/, "").split("\n")[0];
    const at = r.where ? (r.where.file !== null && r.where.file !== file_now().name
      ? r.where.file + " l. " : "l. ") + r.where.line + ":" + r.where.col + "  " : "";
    return at + what;
  }

  function open_brief(r) {
    const n = (r.goals || []).length;
    const todo = /(\d+) TODOs? found/.exec(r.text);
    const parts = [];
    if (n > 0) {
      parts.push(t("goals_open", n));
    }
    if (todo) {
      parts.push(t("todos", todo[1]));
    }
    return parts.join(", ");
  }

  function verdict_set(st, text, time) {
    const was = verdict.state;
    verdict.state = st;
    verdict.btn.dataset.state = st;
    verdict.seal.textContent = st === "ok" ? "∎" : st === "bad" ? "✗" : st === "goal" ? "?"
      : st === "warn" ? "!" : st === "busy" ? "…" : "·";
    verdict.text.textContent = text;
    if (time !== undefined) {
      verdict.text.append(el("span", { class: "verdict-ms", text: "  " + ms(time) }));
    }
    if (st === "ok" && was === "bad") {
      verdict.btn.classList.remove("stamp");
      void verdict.btn.offsetWidth;
      verdict.btn.classList.add("stamp");
    }
  }

  function verdict_of(r, entry) {
    if (r.stopped) {
      verdict_set("idle", t("check_stopped"));
    } else if (r.ok && /^SOME PROOFS FAIL/.test(r.text)) {
      // the file checks, but relies on unsafe or foreign code: not a proof
      verdict_set("warn", r.text.split("\n")[0], r.ms.check);
    } else if (r.ok) {
      verdict_set("ok", r.text.split("\n")[0].replace(/:$/, ""), r.ms.check);
    } else if (r.open) {
      verdict_set("goal", open_brief(r), r.ms.check);
    } else {
      verdict_set("bad", err_brief(r));
    }
    const open = file_now().name;
    const here = !r.ok && r.where && (r.where.file === open || (r.where.file === null && entry === open));
    ed_error(here ? r.where : null);
    files_status(entry, r.stopped ? "" : r.ok ? "good" : r.open ? "open" : "bad");
  }

  // Live check
  // ==========
  // The open file is checked as you type; a PROOF.bend in the workspace is
  // checked along with it, since it is the gate for every law.

  const live = { timer: 0, busy: false, dirty: false, watchdog: 0 };

  function live_soon() {
    clearTimeout(live.timer);
    if (!state.live) {
      return;
    }
    live.timer = setTimeout(live_run, 380);
  }

  async function live_run() {
    if (run.busy) {
      return;
    }
    if (live.busy) {
      live.dirty = true;
      return;
    }
    const f = file_now();
    if (f.ro) {
      verdict_set("idle", t("hub_ro", f.name.split("/").pop()));
      return;
    }
    if (!f.name.endsWith(".bend")) {
      const e = run_entry();
      verdict_set("idle", e === null ? t("foreign") : t("foreign_runs", e.name));
      laws_set(null);
      return;
    }
    run.last = f.name;
    const mode = await comp_boot();
    if (mode === "page" && f.text.length > 20000) {
      verdict_set("idle", t("check_on_demand"));
      return;
    }
    live.busy = true;
    if (verdict.state === "idle") {
      verdict_set("busy", t("checking"));
    }
    live.watchdog = setTimeout(() => {
      comp_cancel();
    }, 15000);
    try {
      const r = await comp_ask(f.name, false);
      if (file_now() === f && !run.busy) {
        if (r.stopped) {
          verdict_set("idle", t("check_too_long"));
        } else {
          verdict_of(r, f.name);
          diag_show(r);
          if ((r.ok || r.open) && !state.scratch) {
            snap_take(r.ok ? "snap_checks" : "snap_goals");
          }
        }
      }
      const proof = state.files.find((x) => /(^|\/)PROOF\.bend$/.test(x.name));
      let found = r.stopped ? null : (r.goals || []);
      if (proof && proof !== f && !r.stopped) {
        const p = await comp_ask(proof.name, false);
        laws_set(p.stopped ? null : p, proof.name);
        found = p.stopped ? found : found.concat(p.goals || []);
      } else {
        laws_set(null);
      }
      if (found !== null) {
        goals_feed(found, r);
      }
    } finally {
      clearTimeout(live.watchdog);
      live.busy = false;
      if (live.dirty) {
        live.dirty = false;
        live_soon();
      }
    }
  }

  function laws_set(r, name) {
    verdict.laws.hidden = r === null;
    if (r !== null) {
      verdict.laws.dataset.state = r.ok ? "ok" : r.open ? "goal" : "bad";
      verdict.laws.textContent = t("laws") + (r.ok ? " ∎" : r.open ? " ?" : " ✗");
      verdict.laws.title = name + " : " + (r.ok ? r.text : r.open ? open_brief(r) : err_brief(r));
      files_status(name, r.ok ? "good" : r.open ? "open" : "bad");
    }
  }


  // Goals
  // =====
  // Every ?name the checker reached gets a card under the editor: what is in
  // scope, and what is wanted. A card outlives its hole, so the goal stays in
  // sight while the term that meets it is being written; an unpinned one goes
  // once the file checks, a pinned one when it is unpinned.

  const goals = { cards: [], open: true, near: null, box: $("#goals"), list: $("#goals-list"),
    head: $("#goals-head"), count: $("#goals-count") };

  // The places of ?name in a text, in order.
  function hole_places(text, name) {
    const re = new RegExp("\\?" + name.replace(/[.$]/g, "\\$&") + "(?![\\w.])", "g");
    const at = [];
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      at.push(m.index);
    }
    return at;
  }

  // The declaration a line of a file falls in, as {from, upto} lines.
  function decl_span(file, line) {
    for (const d of decls_of(file)) {
      const upto = d.line + d.text.split("\n").length - 1;
      if (d.kind !== "ctor" && d.line <= line && line <= upto) {
        return { from: d.line, upto };
      }
    }
    return null;
  }

  // Has the checker got past the def this card's hole was in? Then the term
  // written in its place was accepted, and the card has done its job.
  function goal_met(c, r) {
    if (r.ok || r.open) {
      return true;
    }
    const span = decl_span(c.file, c.line);
    return !!(span && r.where && r.where.file === c.file && r.where.line > span.upto);
  }

  function goals_feed(found, r) {
    const texts = files_map();
    const seen = new Set();
    for (const g of found) {
      const text = texts[g.file] || "";
      const pos = text_offset(text, g.line, g.col);
      const k = Math.max(0, hole_places(text, g.name).indexOf(pos));
      const key = g.file + "\n" + g.name + "\n" + k;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const card = goals.cards.find((c) => c.key === key);
      if (card) {
        if (card.split !== undefined && ![...card.split].every((k) => g.ctx.some(([v]) => v === k))) {
          card.split = undefined;
        }
        if (card.lemma !== undefined && ![...card.lemma].every((k) => g.ctx.some(([v]) => v === k))) {
          card.lemma = undefined;
        }
        Object.assign(card, g, { gone: false, refine: card.refine === "busy" ? "busy" : undefined });
        if (!probe_fresh(card)) {
          card.fits = undefined;
        }
      } else {
        goals.cards.push({ ...g, key, k, pinned: false, gone: false });
      }
    }
    goals.cards = goals.cards.filter((c) => {
      if (seen.has(c.key)) {
        return true;
      }
      // not reached this time: an earlier error may hide it, or it left the code
      const text = texts[c.file];
      const at = text === undefined ? [] : hole_places(text, c.name);
      c.gone = at[c.k] === undefined;
      if (!c.gone) {
        c.line = text.slice(0, at[c.k]).split("\n").length;
        c.col = at[c.k] - text.lastIndexOf("\n", at[c.k] - 1);
      }
      return c.pinned || !(c.gone && goal_met(c, r));
    });
    // a kept card is the goal being worked on: it goes first
    goals.cards.sort((a, b) => Number(b.gone) - Number(a.gone)
      || a.file.localeCompare(b.file) || a.line - b.line || a.col - b.col);
    goals_paint();
    probe_soon(r);
  }

  function goals_clear() {
    goals.cards = [];
    goals_paint();
  }

  // Pretty-printing
  // ===============
  // A type too long for the card is broken where it reads best: an
  // equality {a == b : T} puts each side on a line of its own, == under
  // {, so the two sides line up; an application puts one argument per
  // line under its head; a function type or a pair breaks after each
  // arrow or &. Only what is too long is broken, and no name is ever cut.

  // The parts of s between top-level occurrences of sep.
  function top_split(s, sep) {
    const out = [];
    let depth = 0;
    let from = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if ("([{".includes(c) || (c === "<" && /[\w.]/.test(s[i - 1] || "") && !/[>=\-\s]/.test(s[i + 1] || " "))) {
        depth++;
      } else if (")]}".includes(c) || (c === ">" && depth > 0 && /[\w)\]}>]/.test(s[i - 1] || ""))) {
        depth--;
      } else if (depth === 0 && s.startsWith(sep, i)) {
        out.push(s.slice(from, i));
        from = i + sep.length;
        i += sep.length - 1;
      }
    }
    out.push(s.slice(from));
    return out;
  }

  // The lines of a type in width columns.
  function pp(text, width) {
    const out = [];
    pp_go(text.replace(/\s+/g, " ").trim(), 0, Math.max(24, width), out, "", "");
    return out;
  }

  // Pushes s at column col, lead before it, tail after it; what s breaks
  // into hangs under where s starts.
  function pp_go(s, col, width, out, lead, tail) {
    const pad = " ".repeat(col);
    const at = col + lead.length;
    if (at + s.length + tail.length <= width) {
      out.push(pad + lead + s + tail);
      return;
    }
    // {a == b : T}
    if (s[0] === "{" && close_of(s, 0) === s.length - 1) {
      const eq = top_split(s.slice(1, -1), " == ");
      if (eq.length === 2) {
        const side = top_split(eq[1], " : ");
        const rhs = side.length > 1 ? side.slice(0, -1).join(" : ") : eq[1];
        const ty = side.length > 1 ? side[side.length - 1] : null;
        // {  lhs
        // == rhs
        //  : T}
        pp_go(eq[0].trim(), col, width, out, lead + "{  ", "");
        pp_go(rhs.trim(), at, width, out, "== ", ty === null ? "}" + tail : "");
        if (ty !== null) {
          pp_go(ty.trim(), at, width, out, " : ", "}" + tail);
        }
        return;
      }
    }
    // a pair or a function type: break after each & or ->
    for (const op of [" -> ", " & "]) {
      const parts = top_split(s, op);
      if (parts.length > 1) {
        parts.forEach((part, k) => pp_go(part.trim(), k === 0 ? col : at, width, out,
          k === 0 ? lead : "", k === parts.length - 1 ? tail : op.trimEnd()));
        return;
      }
    }
    // head(args) or Ctor{args}, the brackets around all the rest
    const m = /^[^\s(){}<>,]*[({]/.exec(s);
    if (m !== null && m[0].length > 1 && close_of(s, m[0].length - 1) === s.length - 1) {
      const args = split_top(s.slice(m[0].length, -1));
      out.push(pad + lead + m[0]);
      args.forEach((arg, k) => pp_go(arg, at + 2, width, out, "",
        k === args.length - 1 ? s[s.length - 1] + tail : ","));
      return;
    }
    out.push(pad + lead + s + tail);
  }

  // Columns of goal text the card has room for.
  function goal_cols() {
    const list = goals.list;
    if (goals.chw === undefined || goals.chw === 0) {
      const probe = el("pre", { class: "goal-body", style: "position:absolute;visibility:hidden;margin:0;padding:0",
        text: "M".repeat(40) });
      list.append(probe);
      goals.chw = probe.getBoundingClientRect().width / 40 || 7.5;
      probe.remove();
    }
    return Math.max(24, Math.floor((list.clientWidth - 34) / goals.chw));
  }

  const GOAL_FOLD = 8;
  const GOAL_SHOW = 5;

  // The goal line of a card: whole when short, folded when long, with a
  // tap to unfold and, under a mouse, the whole goal in a block beside it.
  function goal_turn(c, cols) {
    const lines = pp(c.expected, cols - 2);
    const fold = lines.length > GOAL_FOLD && c.full !== true;
    const shown = fold ? lines.slice(0, GOAL_SHOW) : lines;
    const text = el("span", { class: "goal-ty", html: highlight(shown.join("\n")) });
    const turn = el("div", { class: "goal-turn" + (c.ctx.length ? " ruled" : "") + (fold ? " folded" : "") },
      el("b", { text: "⊢ " }), text);
    if (lines.length > GOAL_FOLD) {
      turn.append(el("button", { class: "fold", type: "button",
        text: fold ? t("more_lines", lines.length - GOAL_SHOW) : t("fewer_lines"),
        onclick: () => {
          c.full = !(c.full === true);
          tip_hide();
          goals_paint();
        } }));
      if (fold && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
        turn.addEventListener("mouseenter", () => tip_goal(turn, c));
        turn.addEventListener("mouseleave", tip_hide);
      }
    }
    return turn;
  }

  function tip_goal(anchor, c) {
    const tip = sigs.tip;
    tip.textContent = "";
    tip.append(el("pre", { class: "tip-text tip-goal", html: "<b>⊢ </b>" + highlight(pp(c.expected, 70).join("\n")) }));
    tip.hidden = false;
    const r = anchor.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(r.left, window.innerWidth - box.width - 8)) + "px";
    tip.style.top = (r.bottom + 6 + box.height < window.innerHeight ? r.bottom + 6 : Math.max(8, r.top - box.height - 6)) + "px";
  }

  function goals_paint() {
    const n = goals.cards.length;
    goals.box.hidden = n === 0;
    goals.box.classList.toggle("shut", !goals.open);
    goals.head.setAttribute("aria-expanded", String(goals.open));
    const live = goals.cards.filter((c) => !c.gone).length;
    goals.count.textContent = t("goals_count", live, n - live);
    goals.list.textContent = "";
    if (!goals.open) {
      return;
    }
    const cols = goal_cols();
    const open = file_now().name;
    for (const c of goals.cards) {
      const pin = el("button", { class: "chip pin", type: "button", "aria-pressed": String(c.pinned),
        text: c.pinned ? t("pinned") : t("pin"),
        onclick: () => { c.pinned = !c.pinned; goals_paint(); } });
      const ask = !c.gone && ai.on() ? el("button", { class: "chip", type: "button", text: t("ai_short"),
        "aria-label": t("ai_ask"), onclick: () => ai_sheet({ kind: "goal", card: c }) }) : null;
      // Split: the variables get a box each; Match writes one match on the
      // ticked ones, a case per combination of their constructors.
      const alone = !c.gone && hole_alone(c);
      const can = alone && c.ctx.some(([, ty]) => split_plan(ty, c.ctx) !== null);
      const lemming = c.lemma !== undefined;
      const picking = c.split !== undefined || lemming;
      const need = lemming ? lemma_needs(c) : null;
      const tools = [];
      if (!c.gone && !picking) {
        // Tried: one fit that closes the goal is Solve; any other outcome is
        // the list (a term with holes of its own is seen there before it
        // lands). Not tried yet, the budget having passed this card by: a
        // dashed button, which tries when touched.
        const fits = probe_fresh(c) ? c.fits.filter((k) => k.ok) : null;
        if (fits !== null && fits.length === 1 && !/\?[A-Za-z_]/.test(fits[0].text)) {
          tools.push(el("button", { class: "chip go", type: "button", text: t("solve"),
            "aria-label": t("solve_aria", fits[0].text), onclick: () => refine_put(c, fits[0].text) }));
        } else if (fits !== null) {
          tools.push(el("button", { class: "chip", type: "button", text: t("constructors"),
            "aria-label": t("constructors_aria"), onclick: () => refine(c) }));
        } else {
          tools.push(el("button", { class: "chip lazy", type: "button", text: t("constructors") + "…",
            disabled: c.probing === true, "aria-label": c.probing === true ? t("checking") : t("constructors_lazy"),
            onclick: () => refine(c) }));
        }
      }
      if (!c.gone && !picking) {
        tools.push(el("button", { class: "chip", type: "button", text: t("lemma"), "aria-label": t("lemma_aria"),
          onclick: () => {
            c.split = undefined;
            c.lemma = new Set();
            c.lemma_name = lemma_default(c);
            goals_paint();
          } }));
      }
      if (!c.gone && !picking) {
        const why = can ? "" : alone ? t("split_nothing") : t("split_alone");
        tools.push(el("button", { class: "chip" + (can ? "" : " off"), type: "button", text: t("split"),
          "aria-disabled": String(!can), "aria-label": can ? t("split_aria") : why, title: why,
          onclick: () => {
            if (can) {
              c.split = new Set();
              goals_paint();
            } else {
              toast(why);
            }
          } }));
      } else if (lemming) {
        const name = el("input", { class: "lemma-name", type: "text", value: c.lemma_name, spellcheck: "false",
          autocapitalize: "off", autocomplete: "off", autocorrect: "off", "aria-label": t("lemma_name") });
        name.addEventListener("input", () => { c.lemma_name = name.value.trim(); });
        name.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            lemma_extract(c);
          }
        });
        tools.push(name, el("button", { class: "chip go", type: "button", text: t("extract"),
          onclick: () => lemma_extract(c) }),
          el("button", { class: "chip", type: "button", text: t("cancel"),
            onclick: () => { c.lemma = undefined; goals_paint(); } }));
      } else if (picking) {
        tools.push(el("button", { class: "chip go", type: "button", text: t("match"), disabled: c.split.size === 0,
          onclick: () => { const vars = c.ctx.map(([k]) => k).filter((k) => c.split.has(k)); c.split = undefined; split_case(c, vars); } }),
          el("button", { class: "chip", type: "button", text: t("cancel"),
            onclick: () => { c.split = undefined; goals_paint(); } }));
      }
      const head = el("div", { class: "goal-head" },
        c.gone ? el("span", { class: "goal-name", text: "?" + c.name })
          : el("button", { class: "goal-name", type: "button", text: "?" + c.name,
            "aria-label": t("goto_goal", c.name), onclick: () => where_go(goal_where(c)) }),
        el("span", { class: "goal-at", text: c.gone ? t("goal_gone")
          : t("goal_at", c.file === open ? "" : c.file, c.line, c.def) }),
        el("span", { class: "goal-tools" }, ...tools, picking ? null : ask, picking ? null : pin,
          c.gone ? el("button", { class: "chip", type: "button", "aria-label": t("remove_goal"), text: "×",
            onclick: () => { goals.cards = goals.cards.filter((x) => x !== c); goals_paint(); } }) : null));
      const body = el("pre", { class: "goal-body" });
      for (const [k, ty] of c.ctx) {
        const row = el("div", { class: picking ? "pick" : "" });
        if (lemming) {
          // what the goal names, and what the ticked ones name, the lemma must take
          const req = need.has(k) && !c.lemma.has(k);
          const box = el("input", { type: "checkbox", disabled: req, "aria-label": req ? t("lemma_needed", k) : t("lemma_take", k) });
          box.checked = req || c.lemma.has(k);
          box.addEventListener("change", () => {
            if (box.checked) {
              c.lemma.add(k);
            } else {
              c.lemma.delete(k);
            }
            goals_paint();
          });
          row.append(el("label", { class: req ? "req" : "", title: req ? t("lemma_needed", k) : "" }, box,
            el("span", { class: "goal-var", text: k })));
        } else if (picking) {
          const ok = split_plan(ty, c.ctx) !== null;
          const box = el("input", { type: "checkbox", disabled: !ok, "aria-label": t("split_on", k) });
          box.checked = c.split.has(k);
          box.addEventListener("change", () => {
            if (box.checked) {
              c.split.add(k);
            } else {
              c.split.delete(k);
            }
            $(".chip.go", c.node).disabled = c.split.size === 0;
          });
          row.append(el("label", { class: ok ? "" : "off" }, box, el("span", { class: "goal-var", text: k })));
        } else {
          row.append(el("span", { class: "goal-var", text: k }));
        }
        row.append(" : ", el("span", { class: "goal-ty", html: highlight(pp(ty, cols - k.length - 3).join("\n")) }));
        body.append(row);
      }
      body.append(goal_turn(c, cols));
      if (c.refine !== undefined && !c.gone) {
        const row = el("div", { class: "cands" });
        if (c.refine === "busy") {
          row.append(el("span", { class: "dim", text: t("checking") }));
        } else if (c.refine.length === 0) {
          row.append(el("span", { class: "dim", text: t("refine_none") }));
        } else {
          if (c.normal) {
            row.append(el("span", { class: "dim norm", html: "= " + highlight(pp(c.normal, cols - 2).join("\n")) }));
          }
          for (const k of c.refine) {
            // a term that does not type stays visible, and says why when touched
            row.append(el("button", { class: "chip cand" + (k.ok ? " fits" : " bad"), type: "button",
              "aria-disabled": String(!k.ok), title: k.ok ? "" : t("cand_bad", k.why), html: highlight(k.text),
              "aria-label": k.ok ? k.text : t("cand_bad", k.why),
              onclick: () => (k.ok ? refine_put(c, k.text) : toast(t("cand_bad", k.why))) }));
          }
        }
        row.append(el("button", { class: "chip", type: "button", text: "×", "aria-label": t("close"),
          onclick: () => { c.refine = undefined; goals_paint(); } }));
        body.append(row);
      }
      const card = el("div", { class: "goal" + (c.gone ? " gone" : "") }, head, body);
      c.node = card;
      goals.list.append(card);
    }
    goals.near = null;
    goals_near();
    agent_tab();
  }

  // The goal of the def the caret is in comes into view, and is marked.
  function goals_near() {
    if (!goals.open || goals.cards.length === 0) {
      return;
    }
    const f = file_now();
    const line = ed_caret().line;
    const span = decl_span(f.name, line);
    const here = goals.cards.filter((c) => !c.gone && c.file === f.name && span
      && c.line >= span.from && c.line <= span.upto);
    const near = here.sort((a, b) => Math.abs(a.line - line) - Math.abs(b.line - line))[0] || null;
    if (near === goals.near) {
      return;
    }
    goals.near = near;
    for (const c of goals.cards) {
      if (c.node) {
        c.node.classList.toggle("near", c === near);
      }
    }
    if (near && near.node && !goals.cards.some((c) => c.gone)) {
      goals.list.scrollTop = near.node.offsetTop - goals.list.offsetTop;
    }
  }

  function goals_init() {
    let seen = 0;
    const refit = () => {
      const w = goals.list.clientWidth;
      if (w !== 0 && w !== seen && goals.cards.length > 0) {
        seen = w;
        goals_paint();
      }
    };
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(() => requestAnimationFrame(refit)).observe(goals.box);
    } else {
      window.addEventListener("resize", () => requestAnimationFrame(refit));
    }
    goals.head.addEventListener("mousedown", (e) => e.preventDefault());
    goals.head.addEventListener("click", () => {
      goals.open = !goals.open;
      goals_paint();
      requestAnimationFrame(ed_reveal);
    });
    goals.list.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) {
        e.preventDefault();
      }
    });
  }



  // Constructors
  // ============
  // The terms a goal's type is built with: its constructors, each field a
  // hole; {==} for an equality; a pair for a pair. Every one is tried in the
  // checker in place of the hole, and offered only if it types there: the
  // others are shown greyed, with the reason.

  function hole_free(text, want) {
    let name = want;
    for (let n = 2; hole_places(text, name).length > 0; n++) {
      name = want + n;
    }
    return name;
  }

  function refine_list(c, text) {
    const exp = (c.normal || c.expected).trim();
    const holes = new Set();
    const hole = (want) => {
      let name = hole_free(text, c.name + "_" + want);
      for (let n = 2; holes.has(name); n++) {
        name = c.name + "_" + want + n;
      }
      holes.add(name);
      return "?" + name;
    };
    if (/^\{.* == .* : .*\}$/.test(exp) && split_top(exp.slice(1, -1)).length === 1) {
      return ["{==}"];
    }
    if (split_top(exp.replace(/\s*&\s*/g, " & ")).length === 1 && / & /.test(exp)) {
      return ["(" + hole("fst") + ", " + hole("snd") + ")"];
    }
    const head = type_head(exp);
    if (head === "Nat") {
      return ["0n", "1n+" + hole("p")];
    }
    if (head === "List") {
      return ["[]", hole("h") + " <> " + hole("t")];
    }
    if (head === "" || head === "Type" || head === "Data" || /^[a-z]/.test(head)) {
      return [];
    }
    const out = [];
    for (const file of state.files.map((f) => f.name).concat([null])) {
      for (const d of decls_of(file)) {
        if (d.kind === "ctor" && d.of === head && !out.some((x) => x.startsWith(d.name + "{"))) {
          out.push(d.name + "{" + d.params.map((p) => hole(param_name(p))).join(", ") + "}");
        }
      }
    }
    return out;
  }

  // The file with the hole replaced by a term.
  function hole_swap(text, c, term) {
    const lines = text.split("\n");
    const l = lines[c.line - 1] || "";
    const at = l.indexOf("?" + c.name, Math.max(0, c.col - 1));
    if (at < 0) {
      return null;
    }
    lines[c.line - 1] = l.slice(0, at) + term + l.slice(at + c.name.length + 1);
    return lines.join("\n");
  }

  // Tries every candidate in the checker; the results are kept with the
  // text they were computed for.
  async function probe_card(c) {
    const f = state.files.find((x) => x.name === c.file);
    if (!f) {
      return null;
    }
    c.probing = true;
    goals_paint();
    try {
      return await probe_try(c, f);
    } finally {
      c.probing = false;
    }
  }

  async function probe_try(c, f) {
    const text = f.text;
    const cands = refine_list(c, text);
    const files = files_map();
    const base = await comp_ask(c.file, false, files);
    const same = (q) => !q.ok && !q.open && !base.ok && !base.open && q.where && base.where
      && q.where.file === base.where.file && q.where.line === base.where.line && q.text === base.text;
    const out = [];
    for (const term of cands) {
      const swapped = hole_swap(text, c, term);
      if (swapped === null) {
        break;
      }
      const q = await comp_ask(c.file, false, { ...files, [c.file]: swapped });
      if (q.stopped) {
        return null;
      }
      out.push({ text: term, ok: q.ok || q.open === true || same(q), why: q.ok || q.open ? "" : err_brief(q) });
    }
    if (f.text !== text) {
      return null;
    }
    c.fits = out;
    c.fits_text = text;
    return out;
  }

  function probe_fresh(c) {
    const f = state.files.find((x) => x.name === c.file);
    return c.fits !== undefined && f !== undefined && c.fits_text === f.text;
  }

  // The probes run by themselves after a check, when the file checks fast
  // enough for a handful of extra checks to go unnoticed; on a slow file
  // the Constructors button does the work when asked.
  const probe = { timer: 0, busy: false, again: false };
  const PROBE_MS = Number(new URLSearchParams(location.search).get("probe_ms")) || 400;
  const PROBE_MAX = 24;

  function probe_soon(r) {
    if (r.stopped || r.ms.check > PROBE_MS) {
      return;
    }
    clearTimeout(probe.timer);
    probe.timer = setTimeout(probe_run, 250);
  }

  async function probe_run() {
    if (probe.busy) {
      probe.again = true;
      return;
    }
    probe.busy = true;
    try {
      let spent = 0;
      // the goal being worked on first: the nearest to the caret, in its file
      const here = file_now().name;
      const line = ed_caret().line;
      const order = goals.cards.slice().sort((a, b) =>
        Number(b.file === here) - Number(a.file === here) || Math.abs(a.line - line) - Math.abs(b.line - line));
      for (const c of order) {
        if (c.gone || probe_fresh(c) || !goals.cards.includes(c)) {
          continue;
        }
        const f = state.files.find((x) => x.name === c.file);
        const n = f ? refine_list(c, f.text).length : 0;
        if (n === 0 || spent + n > PROBE_MAX) {
          if (n === 0 && f) {
            c.fits = [];
            c.fits_text = f.text;
          }
          continue;
        }
        spent += n;
        if ((await probe_card(c)) !== null && goals.cards.includes(c)) {
          goals_paint();
        }
      }
    } finally {
      probe.busy = false;
      if (probe.again) {
        probe.again = false;
        probe_run();
      }
    }
  }

  async function refine(c) {
    if (!probe_fresh(c)) {
      const out = await probe_card(c);
      if (out === null) {
        goals_paint();
        return;
      }
      const fits = out.filter((k) => k.ok);
      if (fits.length === 1 && !/\?[A-Za-z_]/.test(fits[0].text)) {
        goals_paint();
        return;
      }
    }
    c.refine = c.fits;
    goals_paint();
  }

  function refine_put(c, term) {
    const i = state.files.findIndex((x) => x.name === c.file);
    if (i < 0) {
      return;
    }
    if (i !== state.active) {
      files_pick(i);
    }
    const text = ed.ta.value;
    const l = text.split("\n")[c.line - 1] || "";
    const at = l.indexOf("?" + c.name, Math.max(0, c.col - 1));
    if (at < 0) {
      toast(t("ai_hole_gone"));
      return;
    }
    const keep = work_snapshot();
    const from = text_offset(text, c.line, at + 1);
    ed.ta.focus({ preventScroll: true });
    ed.ta.setSelectionRange(from, from + c.name.length + 1);
    ed_insert(term);
    const first = /\?[A-Za-z_][\w.]*/.exec(term);
    if (first) {
      ed.ta.setSelectionRange(from + first.index, from + first.index + first[0].length);
    }
    ed_reveal();
    c.refine = undefined;
    toast(t("refined", term), t("undo"), () => work_restore(keep));
  }


  // Lemma
  // =====
  // A goal becomes a def of its own: the ticked variables are its
  // parameters, with their quantities, the goal its type, a hole its body.
  // The variables the goal names, and the ones the ticked variables' types
  // name, are ticked for you; add the hypotheses the proof will want. The
  // lemma goes above the declaration the hole is in (above its law and its
  // comments), since a safe def may only name what is written above it,
  // and the hole becomes a call to it. The result is checked first: a
  // lemma that would not check is not written.

  // The context variables a text names.
  function names_in(text, names) {
    const out = [];
    for (const m of text.matchAll(/(^|[^\w.?])([A-Za-z_]\w*)(?![\w.])/g)) {
      if (names.has(m[2])) {
        out.push(m[2]);
      }
    }
    return out;
  }

  // What the lemma must take: the goal's variables, the ticked ones, and
  // everything their types name, however far.
  function lemma_needs(c) {
    const names = new Set(c.ctx.map(([k]) => k));
    const types = Object.fromEntries(c.ctx);
    const need = new Set();
    const visit = (text) => {
      for (const k of names_in(text, names)) {
        if (!need.has(k)) {
          need.add(k);
          visit(types[k]);
        }
      }
    };
    visit(c.expected);
    for (const k of c.lemma || []) {
      if (!need.has(k)) {
        need.add(k);
        visit(types[k]);
      }
    }
    return need;
  }

  function lemma_taken(name, file) {
    return decls_of(file).some((d) => d.name === name) || decls_of(null).some((d) => d.name === name);
  }

  function lemma_default(c) {
    const want = /^[A-Za-z_][\w]*$/.test(c.name) && c.name !== "TODO" ? c.name : "lemma";
    let name = want;
    for (let n = 2; lemma_taken(name, c.file); n++) {
      name = want + n;
    }
    return name;
  }

  // The line a new top-level declaration goes above: the start of the one
  // the hole is in, above its law and the comments on top of them.
  function lemma_line(c, lines) {
    // the declaration the hole is in starts at the nearest line above it
    // that opens one at column 0
    let at = c.line;
    while (at > 1 && !/^(@unsafe\s+)?(def|law|type)\s/.test(lines[at - 1])) {
      at--;
    }
    const own = decls_of(c.file).find((d) => d.line === at) || null;
    const law = own && own.kind === "def" ? decls_of(c.file).find((d) => d.kind === "law" && d.name === own.name && d.line < at) : null;
    if (law) {
      at = law.line;
    }
    while (at > 1 && /^#/.test(lines[at - 2])) {
      at--;
    }
    return at;
  }

  // The lemma's header, as the demos write theirs: on one line when it
  // fits; else the parameters packed on lines of their own between
  // "def name(" and ")", and the type broken the way the cards break it.
  // plain: everything on one line, the form that always reads back.
  function lemma_text(name, params, goal, plain) {
    const flat = goal.replace(/\s*\n\s*/g, " ");
    const one = "def " + name + "(" + params.join(", ") + ") -> " + flat + ":";
    if (plain || one.length <= 80) {
      return one;
    }
    const lines = [];
    const head = "def " + name + "(" + params.join(", ") + ")";
    if (head.length <= 80) {
      lines.push(head);
    } else {
      lines.push("def " + name + "(");
      let cur = "";
      params.forEach((p, k) => {
        const piece = p + (k === params.length - 1 ? "" : ",");
        if (cur !== "" && 2 + cur.length + 1 + piece.length > 80) {
          lines.push("  " + cur);
          cur = piece;
        } else {
          cur = cur === "" ? piece : cur + " " + piece;
        }
      });
      lines.push("  " + cur, ")");
    }
    const last = lines.pop();
    const ty = pp(flat, 76);
    if (last.length + 4 + ty[0].length <= 80 && ty.length === 1) {
      lines.push(last + " -> " + ty[0] + ":");
    } else {
      lines.push(last, "  -> " + ty[0]);
      for (const l of ty.slice(1)) {
        lines.push("     " + l);
      }
      lines[lines.length - 1] += ":";
    }
    return lines.join("\n");
  }

  async function lemma_extract(c) {
    const name = (c.lemma_name || "").trim();
    if (!/^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)*$/.test(name)) {
      toast(t("lemma_name_bad"));
      return;
    }
    if (lemma_taken(name, c.file)) {
      toast(t("lemma_taken", name));
      return;
    }
    const i = state.files.findIndex((x) => x.name === c.file);
    if (i < 0) {
      return;
    }
    const need = lemma_needs(c);
    const vars = c.ctx.map(([k]) => k).filter((k) => need.has(k));
    const types = Object.fromEntries(c.ctx);
    const params = vars.map((k) => (c.quant && c.quant[k] !== undefined ? c.quant[k] : "") + k + ": "
      + types[k].replace(/\s*\n\s*/g, " "));
    const f = state.files[i];
    const lines = f.text.split("\n");
    const cur = lines[c.line - 1] || "";
    const at = cur.indexOf("?" + c.name, Math.max(0, c.col - 1));
    if (at < 0) {
      toast(t("ai_hole_gone"));
      return;
    }
    lines[c.line - 1] = cur.slice(0, at) + name + "(" + vars.join(", ") + ")" + cur.slice(at + c.name.length + 1);
    const top = lemma_line(c, lines);
    // checked before it is written: the lemma's own hole is the one goal
    // expected; the laid-out header first, the one-line one if it misreads
    const files = files_map();
    const base = await comp_ask(c.file, false, files);
    let lemma = null;
    let next = null;
    let q = null;
    for (const plain of [false, true]) {
      lemma = (lemma_text(name, params, c.expected, plain) + "\n  ?" + c.name + "\n").split("\n");
      const all = lines.slice();
      all.splice(top - 1, 0, ...lemma);
      next = all.join("\n");
      q = await comp_ask(c.file, false, { ...files, [c.file]: next });
      const same = !q.ok && !q.open && !base.ok && !base.open && q.where && base.where
        && q.where.line === base.where.line + lemma.length && q.text.split("\n")[1] === base.text.split("\n")[1];
      if (q.ok || q.open || same) {
        break;
      }
      q = { bad: q };
    }
    if (q.bad !== undefined) {
      toast(t("lemma_bad", err_brief(q.bad)));
      return;
    }
    if (state.files[i].text !== f.text) {
      return;
    }
    c.lemma = undefined;
    if (i !== state.active) {
      files_pick(i);
    }
    const keep = work_snapshot();
    ed_rewrite(next);
    ed_goto(top + lemma.length - 2, 3, top + lemma.length - 2, 3 + c.name.length + 1);
    toast(t("lemma_done", name), t("undo"), () => work_restore(keep));
  }

  // Split case
  // ==========
  // A hole alone on its line can become a match on a variable of its
  // context, one case per constructor of the variable's type, each with a
  // hole of its own. The constructors come from the declarations the
  // signature bar already reads; Nat and List take their sugar; a pair is
  // taken apart with (a, b) = x.

  function hole_alone(c) {
    const f = state.files.find((x) => x.name === c.file);
    const line = f ? (f.text.split("\n")[c.line - 1] || "") : "";
    return line.trim() === "?" + c.name;
  }

  // The type's head name, the file's own namespace stripped.
  function type_head(ty) {
    let head = (/^[A-Za-z_][\w.]*/.exec(ty.trim()) || [""])[0];
    for (const f of state.files) {
      const stem = f.name.replace(/\.bend$/, "").replace(/\//g, ".");
      if (head.startsWith(stem + ".")) {
        return head.slice(stem.length + 1);
      }
    }
    return head;
  }

  function fresh_name(want, taken) {
    let name = want;
    for (let n = 2; taken.has(name); n++) {
      name = want + n;
    }
    taken.add(name);
    return name;
  }

  // The cases to write for a type, as [pattern, tag]; null when the type
  // is not one to split on. A pair answers a single binding instead.
  function split_plan(ty, ctx) {
    const taken = new Set(ctx.map(([k]) => k));
    const text = ty.trim();
    if (split_top(text.replace(/\s*&\s*/g, " & ")).length === 1 && / & /.test(text)) {
      return { cases: [["Tuple{" + fresh_name("a", taken) + ", " + fresh_name("b", taken) + "}", "tuple"]] };
    }
    const head = type_head(text);
    if (head === "Nat") {
      return { cases: [["0n", "zero"], ["1n+" + fresh_name("p", taken), "succ"]] };
    }
    if (head === "List") {
      return { cases: [["[]", "nil"], [fresh_name("h", taken) + " <> " + fresh_name("t", taken), "cons"]] };
    }
    if (head === "String") {
      return { cases: [["SNil{}", "snil"], ["SCon{" + fresh_name("c", taken) + ", " + fresh_name("cs", taken) + "}", "scon"]] };
    }
    if (head === "" || head === "Type" || head === "Data" || /^[a-z]/.test(head)) {
      return null;
    }
    const ctors = [];
    for (const file of state.files.map((f) => f.name).concat([null])) {
      for (const d of decls_of(file)) {
        if (d.kind === "ctor" && d.of === head && !ctors.some((c) => c.name === d.name)) {
          ctors.push(d);
        }
      }
    }
    if (ctors.length === 0) {
      return null;
    }
    return { cases: ctors.map((d) => [d.name + "{" + d.params.map((p) => fresh_name(param_name(p), taken)).join(", ") + "}",
      d.name.toLowerCase().replace(/[^a-z0-9]/g, "_")]) };
  }

  const SPLIT_CAP = 64;

  function split_case(c, vars) {
    const i = state.files.findIndex((x) => x.name === c.file);
    if (vars.length === 0 || i < 0) {
      goals_paint();
      return;
    }
    // each variable's cases, the pattern names kept apart from each other's
    const ctx = c.ctx.slice();
    const plans = [];
    for (const v of vars) {
      const ty = (ctx.find(([k]) => k === v) || [])[1];
      const plan = ty === undefined ? null : split_plan(ty, ctx);
      if (plan === null) {
        goals_paint();
        return;
      }
      plans.push(plan.cases);
      for (const [pat] of plan.cases) {
        for (const m of pat.matchAll(/[A-Za-z_]\w*/g)) {
          ctx.push([m[0], ""]);
        }
      }
    }
    const count = plans.reduce((n, p) => n * p.length, 1);
    if (count > SPLIT_CAP) {
      toast(t("split_too_many", count));
      goals_paint();
      return;
    }
    if (i !== state.active) {
      files_pick(i);
    }
    const text = ed.ta.value;
    const cur = text.split("\n")[c.line - 1] || "";
    if (cur.trim() !== "?" + c.name) {
      toast(t("split_alone"));
      goals_paint();
      return;
    }
    let combos = [[]];
    for (const cases of plans) {
      combos = combos.flatMap((done) => cases.map((one) => done.concat([one])));
    }
    const ind = /^\s*/.exec(cur)[0];
    const out = [ind + "match " + vars.join(" ") + ":"];
    for (const combo of combos) {
      out.push(ind + "  case " + combo.map(([pat]) => pat).join(" ") + ":");
      out.push(ind + "    ?" + c.name + "_" + combo.map(([, tag]) => tag).join("_"));
    }
    const keep = work_snapshot();
    const from = text_offset(text, c.line, 1);
    ed.ta.focus({ preventScroll: true });
    ed.ta.setSelectionRange(from, from + cur.length);
    ed_insert(out.join("\n"));
    const pos = text_offset(ed.ta.value, c.line + 2, 1) + ind.length + 4;
    ed.ta.setSelectionRange(pos, pos);
    ed_reveal();
    toast(t("split_done", vars.join(" ")), t("undo"), () => work_restore(keep));
  }

  // Law and def
  // ===========
  // A typed def is a law and a def in one: the parameters are the law's
  // binders, the return type its claim, the body the def that fills it.
  // Either shape becomes the other, in the open file.

  // The header of a def: from its first line to the colon that ends it.
  function def_header(lines, d) {
    const block = lines.slice(d.line - 1, d.line - 1 + d.text.split("\n").length).join("\n");
    const open = block.indexOf("(");
    const shut = open < 0 ? -1 : close_of(block, open);
    if (shut < 0) {
      return null;
    }
    let depth = 0;
    for (let k = shut + 1; k < block.length; k++) {
      const ch = block[k];
      depth += "([{".includes(ch) ? 1 : ")]}".includes(ch) ? -1 : 0;
      if (ch === ":" && depth === 0 && /^[ \t]*(#.*)?(\n|$)/.test(block.slice(k + 1))) {
        return { block, end: k, params: split_top(block.slice(open + 1, shut).replace(/\s+/g, " ")),
          lines: block.slice(0, k + 1).split("\n").length };
      }
    }
    return null;
  }

  function law_of(d, file) {
    return d.kind === "def" ? decls_of(file).find((x) => x.kind === "law" && x.name === d.name) || null : d;
  }

  function def_of(d, file) {
    return d.kind === "law" ? decls_of(file).find((x) => x.kind === "def" && x.name === d.name) || null : d;
  }

  // What the refactor would do for this declaration: "split", "merge" or null.
  function refactor_kind(d, file) {
    if (d.file === null || file !== d.file || !file.endsWith(".bend")) {
      return null;
    }
    if (d.kind === "def" && law_of(d, file) === null) {
      return d.tail.startsWith(" -> ") && d.params.length > 0 && !/^@unsafe/.test(d.text)
        && d.params.every((p) => p.includes(":") && !p.startsWith("~")) ? "split" : null;
    }
    const law = law_of(d, file);
    const def = def_of(d, file);
    if (law === null || def === null) {
      return null;
    }
    const body = law.text.split("\n").slice(1).map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
    const fine = body.every((l) => !/^(exs|where)\b/.test(l)) && !body.some((l) => /^for\b.*\bwhere\b/.test(l))
      && law.params.length === def.params.length;
    return fine ? "merge" : null;
  }

  function refactor(d, file) {
    const kind = refactor_kind(d, file);
    const f = state.files.find((x) => x.name === file);
    if (kind === null || !f || f !== file_now()) {
      return;
    }
    const lines = ed.ta.value.split("\n");
    let out;
    let at;
    if (kind === "split") {
      const h = def_header(lines, d);
      if (h === null) {
        return;
      }
      const law = ["law " + d.name + ":"].concat(d.params.map((p) => "  for " + p.replace(/\s*:\s*/, ": ")),
        pp(d.tail.slice(4).trim(), 78).map((l) => "  " + l), [""]);
      const head = "def " + d.name + "(" + d.params.map(param_name).join(", ") + "):";
      out = lines.slice(0, d.line - 1).concat(law, [head], lines.slice(d.line - 1 + h.lines));
      at = d.line + law.length;
    } else {
      const law = law_of(d, file);
      const def = def_of(d, file);
      const h = def_header(lines, def);
      if (h === null) {
        return;
      }
      const head = "def " + def.name + "(" + law.params.map((p, i) =>
        p.replace(/^([+\-~]?)[^:\s]+/, "$1" + param_name(def.params[i] || p))).join(", ") + ") ->" + law.tail.slice(2) + ":";
      const lawLen = law.text.split("\n").length + (lines[law.line - 1 + law.text.split("\n").length] === "" ? 1 : 0);
      out = lines.slice();
      out.splice(def.line - 1, h.lines, head);
      out.splice(law.line - 1, lawLen);
      at = def.line - (law.line < def.line ? lawLen : 0);
    }
    const keep = work_snapshot();
    ed_rewrite(out.join("\n"));
    ed_goto(at, 1);
    toast(t(kind === "split" ? "split_law_done" : "merge_law_done", d.name), t("undo"), () => work_restore(keep));
  }


  // Operators
  // =========
  // An operator is a call. The infix table of bend.ts, read when this page
  // was built, names the def: Bool.and for &&, String.append for ++, Con
  // for <>. For + - * / %, the bit operations, the shifts and the
  // comparisons it names a verb, and the annotation around the operator,
  // (a + b : T), names the type whose def it is: T.add.

  const OP_CHARS = /[+\-*/%<>=&|^.!~]/;

  // The operator the caret is on or next to, when it stands between
  // spaces, as Bend writes its operators.
  function op_at(text, pos) {
    let a = pos;
    let b = pos;
    while (a > 0 && OP_CHARS.test(text[a - 1])) {
      a--;
    }
    while (b < text.length && OP_CHARS.test(text[b])) {
      b++;
    }
    if (b === a) {
      return null;
    }
    const op = text.slice(a, b);
    if (!Core.INFIX[op] || !Core.INFIX[op][2] || (a > 0 && !/\s/.test(text[a - 1])) || (b < text.length && !/\s/.test(text[b]))) {
      return null;
    }
    return { op, a, b };
  }

  // The type of the annotation (.. : T) the operator at a sits in.
  function op_type(text, a) {
    let depth = 0;
    for (let i = a - 1; i >= 0 && a - i < 4000; i--) {
      const c = text[i];
      if (")]}".includes(c)) {
        depth++;
      } else if ("([{".includes(c)) {
        if (depth > 0) {
          depth--;
          continue;
        }
        const shut = c === "(" ? close_of(text, i) : -1;
        if (shut < 0) {
          return null;
        }
        const parts = top_split(text.slice(i + 1, shut), " : ");
        return parts.length > 1 ? parts[parts.length - 1].trim() : null;
      }
    }
    return null;
  }

  // The def an operator calls here; with no annotation around it, a
  // stand-in that says so and lists the types that have the verb.
  function op_decl(o, text, file) {
    const def = Core.INFIX[o.op][2];
    if (!def.startsWith(".")) {
      return resolve(def, file, text);
    }
    const ty = op_type(text, o.a);
    const head = ty === null ? null : (/^[A-Za-z_][\w.]*/.exec(ty) || [null])[0];
    const d = head === null ? null : resolve(head + def, file, text);
    if (d) {
      return d;
    }
    const verb = def.slice(1);
    const seen = new Set();
    const cands = [];
    for (const f of state.files.map((x) => x.name).concat([null])) {
      for (const x of decls_of(f)) {
        if (x.kind === "def" && x.name.endsWith("." + verb) && !seen.has(x.name)) {
          seen.add(x.name);
          cands.push(x);
        }
      }
    }
    return { name: (head || "T") + "." + verb, kind: "op", file: null, params: [], tail: "", op: o.op, verb,
      head, cands, doc: head === null ? t("op_needs", o.op, verb) : t("op_missing", head, verb), text: "" };
  }

  // Signatures
  // ==========
  // What a name stands for, read off the text: Base and the workspace files
  // are scanned for their def, law and type headers, so a signature shows
  // even while the file does not check. The bar under the editor follows the
  // caret: the call being written, with the argument at hand marked, and the
  // name under the caret. A pointer gets the same in a tooltip.

  const sigs = { base: null, cache: new Map(), bar: $("#sig"), tip: $("#tip"), raf: 0, timer: 0 };

  // Splits at top-level commas: brackets nest, and so do the < > of a type.
  function split_top(s) {
    const out = [];
    let depth = 0;
    let from = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if ("([{".includes(c) || (c === "<" && /[\w.]/.test(s[i - 1] || "") && !/[>=\-\s]/.test(s[i + 1] || " "))) {
        depth++;
      } else if (")]}".includes(c) || (c === ">" && depth > 0 && /[\w)\]}>]/.test(s[i - 1] || ""))) {
        depth--;
      } else if (c === "," && depth === 0) {
        out.push(s.slice(from, i).trim());
        from = i + 1;
      }
    }
    const last = s.slice(from).trim();
    if (last !== "") {
      out.push(last);
    }
    return out;
  }

  function close_of(s, open) {
    let depth = 0;
    for (let i = open; i < s.length; i++) {
      if ("([{".includes(s[i])) {
        depth++;
      } else if (")]}".includes(s[i]) && --depth === 0) {
        return i;
      }
    }
    return -1;
  }

  function param_name(p) {
    return p.replace(/^[+\-~]/, "").split(/[:\s]/)[0];
  }

  // The declarations of a text: {name, kind, line, params, tail, doc, text}.
  function decl_scan(text, file) {
    const lines = text.split("\n");
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const m = /^(@unsafe\s+)?(def|law|type)\s+([^\s(<:]+)/.exec(lines[i]);
      if (m === null) {
        continue;
      }
      // the block runs to the next line that starts a thing of its own:
      // indented lines, a blank line inside the body, and the ) that
      // closes a header written on several lines all belong to it
      let j = i + 1;
      while (j < lines.length && (/^\s+\S/.test(lines[j]) || /^[)\]}]/.test(lines[j])
        || (lines[j].trim() === "" && /^(\s+\S|[)\]}])/.test(lines[j + 1] || "")))) {
        j++;
      }
      let d = i;
      while (d > 0 && /^#/.test(lines[d - 1]) && !/^# ?[=-]{3,}/.test(lines[d - 1])) {
        d--;
      }
      if (d > 0 && /^#/.test(lines[d - 1])) {
        d = i;
      }
      const block = lines.slice(i, j).join("\n");
      const decl = { name: m[3], kind: m[2], file, line: i + 1, params: [], tail: "",
        doc: lines.slice(d, i).map((l) => l.replace(/^# ?/, "")).join("\n"), text: block };
      if (m[2] === "def") {
        const open = block.indexOf("(");
        const shut = open < 0 ? -1 : close_of(block, open);
        if (shut > 0) {
          decl.params = split_top(block.slice(open + 1, shut).replace(/\s+/g, " "));
          const rest = block.slice(shut + 1);
          const arrow = /^\s*->\s*/.exec(rest);
          if (arrow) {
            let depth = 0;
            let end = rest.length;
            for (let k = arrow[0].length; k < rest.length; k++) {
              const c = rest[k];
              depth += "([{".includes(c) ? 1 : ")]}".includes(c) ? -1 : 0;
              if (c === ":" && depth === 0 && /^[ \t]*(#.*)?(\n|$)/.test(rest.slice(k + 1))) {
                end = k;
                break;
              }
            }
            decl.tail = " -> " + rest.slice(arrow[0].length, end).replace(/\s+/g, " ").trim();
          }
        }
      } else if (m[2] === "law") {
        const claim = [];
        for (const l of lines.slice(i + 1, j)) {
          const b = /^\s+for\s+(.*?)\s*(#.*)?$/.exec(l);
          if (b) {
            decl.params.push(b[1].replace(/\s*:\s*/, ": "));
          } else if (l.trim() !== "" && !/^\s*#/.test(l)) {
            claim.push(l.trim());
          }
        }
        decl.tail = " ⊢ " + claim.join(" ");
      } else {
        const head = lines[i].replace(/:\s*(#.*)?$/, "");
        const lt = head.indexOf("<");
        decl.params = lt < 0 ? [] : split_top(head.slice(lt + 1, head.lastIndexOf(">")));
        decl.tail = head.replace(/^.*?\sis\s/, " is ");
        for (const l of lines.slice(i + 1, j)) {
          for (const c of l.matchAll(/(^|\s)([A-Z][\w.]*)\{([^{}]*)\}/g)) {
            out.push({ name: c[2], kind: "ctor", file, line: i + 1, of: m[3], params: split_top(c[3]),
              tail: "", doc: t("ctor_of", m[3]), text: block });
          }
        }
      }
      out.push(decl);
    }
    return out;
  }

  function decls_of(file) {
    if (file === null) {
      if (sigs.base === null) {
        sigs.base = decl_scan(Core.base_text(), null);
      }
      return sigs.base;
    }
    const f = file.startsWith("hub:") ? (hub.files[file.slice(4)] === undefined ? null
      : { name: file, text: hub.files[file.slice(4)] }) : state.files.find((x) => x.name === file);
    if (!f || !f.name.endsWith(".bend")) {
      return [];
    }
    const hit = sigs.cache.get(file);
    if (hit && hit.text === f.text) {
      return hit.decls;
    }
    const decls = decl_scan(f.text, file);
    sigs.cache.set(file, { text: f.text, decls });
    return decls;
  }

  function pick_decl(decls, name, kind) {
    const all = decls.filter((d) => d.name === name);
    if (kind !== undefined) {
      return all.find((d) => d.kind === kind) || null;
    }
    return all.find((d) => d.kind === "law") || all.find((d) => d.kind === "def" && d.tail !== "")
      || all[0] || null;
  }

  // import ./math.bend as M: the alias, and the workspace file it names.
  // The aliases a file's imports bind: a workspace file's name, or
  // "hub:<path>" for a module of the hub (a hub module's own relative
  // imports stay in its package).
  function imports_of(file, text) {
    const inhub = file.startsWith("hub:");
    const base = inhub ? file.slice(4) : file;
    const dir = base.includes("/") ? base.slice(0, base.lastIndexOf("/") + 1) : "";
    const out = new Map();
    for (const m of text.matchAll(/^import\s+(\S+\.bend)\s+as\s+([A-Za-z_]\w*)/gm)) {
      if (/^\.{1,2}\//.test(m[1])) {
        out.set(m[2], (inhub ? "hub:" : "") + path_join(dir, m[1]));
      } else {
        const rel = hub_rel(m[1]);
        if (rel !== null) {
          out.set(m[2], "hub:" + rel);
        }
      }
    }
    return out;
  }

  function resolve(name, file, text, kind) {
    const own = pick_decl(decls_of(file), name, kind);
    if (own) {
      return own;
    }
    const dot = name.indexOf(".");
    if (dot > 0) {
      const target = imports_of(file, text).get(name.slice(0, dot));
      const far = target === undefined ? null : pick_decl(decls_of(target), name.slice(dot + 1), kind);
      if (far) {
        return far;
      }
    }
    return pick_decl(decls_of(null), name, kind);
  }

  // The parameter a bare name refers to, in the def around the caret.
  function param_at(name, file, text, pos) {
    if (name.includes(".")) {
      return null;
    }
    const line = text.slice(0, pos).split("\n").length;
    const defs = decls_of(file).filter((d) => d.kind === "def" && d.line <= line);
    const d = defs[defs.length - 1];
    if (!d || line >= d.line + d.text.split("\n").length) {
      return null;
    }
    const i = d.params.findIndex((p) => param_name(p) === name);
    if (i < 0) {
      return null;
    }
    let shown = d.params[i];
    if (!shown.includes(":")) {
      const law = resolve(d.name, file, text);
      if (law && law.kind === "law" && law.params[i] !== undefined) {
        shown = name + ": " + law.params[i].replace(/^[^:]*:\s*/, "");
      }
    }
    return { name, kind: "param", file, line: d.line, params: [], tail: "", of: d.name,
      doc: t("param_of", d.name), text: shown, shown };
  }

  function word_at(text, pos) {
    let a = pos;
    let b = pos;
    while (a > 0 && /[\w.]/.test(text[a - 1])) {
      a--;
    }
    while (b < text.length && /[\w.]/.test(text[b])) {
      b++;
    }
    while (b > a && text[b - 1] === ".") {
      b--;
    }
    const name = text.slice(a, b);
    return /^[A-Za-z_]/.test(name) ? { name, a, b } : null;
  }

  // The call the caret sits in: its name, and how many arguments came before.
  function call_at(text, pos) {
    let depth = 0;
    let angle = 0;
    let commas = 0;
    for (let i = pos - 1, n = 0; i >= 0 && n < 4000; i--, n++) {
      const c = text[i];
      if (c === "\"") {
        const from = text.lastIndexOf("\n", i);
        let q = i - 1;
        while (q > from && !(text[q] === "\"" && text[q - 1] !== "\\")) {
          q--;
        }
        i = q > from ? q : i;
      } else if (c === "\n" && /^\S/.test(text.slice(i + 1, i + 2)) && depth === 0) {
        return null;
      } else if (")]}".includes(c)) {
        depth++;
      } else if (c === ">" && /[\w)\]}>]/.test(text[i - 1] || "") && text[i - 1] !== "-") {
        angle++;
      } else if (c === "<" && angle > 0 && /[\w.]/.test(text[i - 1] || "")) {
        angle--;
      } else if (c === "<" && angle === 0 && depth === 0 && /[\w.]/.test(text[i - 1] || "")
        && !/[-=>]/.test(text[i + 1] || "") && text.slice(i + 1, i + 3) !== "&>") {
        // an open type application: List<..., with the caret among its arguments
        const m = /([A-Za-z_][\w.]*)$/.exec(text.slice(Math.max(0, i - 120), i));
        const decl = m && /(^|\n)\s*(@unsafe\s+)?(def|law|type)\s+$/.test(text.slice(Math.max(0, i - 160), i - m[1].length));
        if (m && !decl) {
          return { name: m[1], index: commas, brace: false, angle: true, total: angle_args(text, pos, commas) };
        }
        return null;
      } else if ("([{".includes(c)) {
        if (depth > 0) {
          depth--;
          continue;
        }
        const m = /([A-Za-z_][\w.]*)$/.exec(text.slice(Math.max(0, i - 120), i));
        const last = m ? m[1].slice(m[1].lastIndexOf(".") + 1) : "";
        const decl = m && /(^|\n)\s*(@unsafe\s+)?(def|law|type)\s+$/.test(text.slice(Math.max(0, i - 160), i - m[1].length));
        if (m && !decl && (c === "(" || (c === "{" && /^[A-Z]/.test(last)))) {
          return { name: m[1], index: commas, brace: c === "{", start: i - m[1].length };
        }
        commas = 0;
        angle = 0;
      } else if (c === "," && depth === 0 && angle === 0) {
        commas++;
      }
    }
    return null;
  }

  // How many arguments a type application has in all: the commas before
  // the caret, plus those up to its closing >.
  function angle_args(text, pos, before) {
    let depth = 0;
    let n = before + 1;
    for (let i = pos; i < text.length && i < pos + 4000; i++) {
      const c = text[i];
      if (c === "\n" || (c === ">" && depth === 0)) {
        return n;
      }
      depth += "([{<".includes(c) ? 1 : ")]}>".includes(c) ? -1 : 0;
      if (c === "," && depth === 0) {
        n++;
      }
    }
    return n;
  }

  function op_tag(op) {
    return op ? "<span class=\"op-tag\">" + esc(op) + "</span> " : "";
  }

  // One line for a declaration, the argument at hand in bold.
  function sig_html(d, active) {
    if (d.kind === "param") {
      return highlight(d.shown);
    }
    if (d.kind === "op") {
      return "<span class=\"tk-def\">" + esc(d.name) + "</span> <span class=\"dim\">"
        + esc(d.head === null ? "(… : T)" : "?") + "</span>";
    }
    const open = d.kind === "ctor" ? "{" : d.kind === "type" ? "<" : "(";
    const shut = d.kind === "ctor" ? "}" : d.kind === "type" ? ">" : ")";
    const args = d.params.map((p, i) =>
      i === active ? "<b class=\"arg\">" + highlight(p) + "</b>" : highlight(p)).join(", ");
    const word = d.kind === "ctor" ? "" : "<span class=\"tk-kw\">" + d.kind + "</span> ";
    const list = d.kind === "type" && d.params.length === 0 ? "" : esc(open) + args + esc(shut);
    return word + "<span class=\"tk-def\">" + esc(d.name) + "</span>" + list + highlight(d.tail);
  }

  function sig_source(d) {
    if (d.kind === "op") {
      return d.head === null ? t("op_no_ann") : t("op_undef");
    }
    return d.file === null ? "Base" : d.file.startsWith("hub:") ? "hub · " + d.file.split("/").pop() : d.file;
  }

  function sig_sheet(d, at) {
    if (d.kind === "op") {
      const body = el("div", { class: "sigsheet" }, el("p", { class: "sigdoc", text: d.doc }));
      let close = () => {};
      const list = el("div", { class: "form" });
      const row = el("div", { class: "row" });
      for (const x of d.cands.slice(0, 40)) {
        row.append(el("button", { class: "btn", type: "button", text: x.name,
          onclick: () => { close(); sig_sheet(x); } }));
      }
      list.append(d.cands.length > 0 ? row : el("small", { text: t("op_none", d.verb) }));
      body.append(list);
      close = sheet_open(d.op + "  →  " + d.name, body);
      return;
    }
    const body = el("div", { class: "sigsheet" });
    if (d.doc) {
      body.append(el("p", { class: "sigdoc", text: d.doc }));
    }
    body.append(el("pre", { class: "decl", html: highlight(d.kind === "param" ? d.shown : d.text) }));
    let close = () => {};
    const go = el("button", { class: "btn", type: "button",
      text: d.file === null ? t("see_base") : t("goto_def"), onclick: () => {
        close();
        if (d.file === null) {
          tab_set("base");
          base_mount();
          $("#base-q").value = d.kind === "ctor" ? d.of : d.name;
          base_find();
          if (!WIDE.matches) {
            panel_set("full");
          }
        } else {
          where_go({ file: d.file, line: d.line, col: 1 });
        }
      } });
    const row = el("div", { class: "row" }, go);
    const kind = refactor_kind(d, file_now().name);
    if (kind !== null) {
      row.append(el("button", { class: "btn", type: "button", text: t(kind === "split" ? "split_law" : "merge_law"),
        onclick: () => { close(); refactor(d, file_now().name); } }));
    }
    // operators and calls, the one into the other
    const f = file_now();
    const plan = at && !f.ro && f.name.endsWith(".bend") ? opcall_plan(f.text, at) : null;
    if (plan !== null) {
      row.append(el("button", { class: "btn", type: "button", text: t(plan.kind === "calls" ? "opc_to_calls" : "opc_to_ops"),
        title: plan.text || "", onclick: () => { close(); opcall_apply(plan, f.name); } }));
    }
    if (ai.on()) {
      row.append(el("button", { class: "btn", type: "button", text: t("ai_ask"),
        onclick: () => { close(); ai_sheet({ kind: "decl", decl: d }); } }));
    }
    body.append(el("div", { class: "form" }, row));
    close = sheet_open((d.kind === "param" ? d.name : d.name) + "  (" + sig_source(d) + ")", body);
  }

  // What the caret is on: the enclosing call, then the name itself.
  function sig_items(text, pos, file) {
    const items = [];
    const o = op_at(text, pos);
    if (o) {
      const d = op_decl(o, text, file);
      if (d) {
        items.push({ d, active: -1, op: o.op, at: { op: o.op, a: o.a } });
      }
    }
    const call = call_at(text, pos);
    if (call) {
      // a type's arguments live in < >; a type-level def's, like IO(A), in ( )
      const d = call.angle ? resolve(call.name, file, text, "type") : resolve(call.name, file, text);
      if (d && (d.kind === "ctor") === call.brace) {
        // the short form leaves the leading quantity binders out: List<U32> for List<&2, U32>
        let skip = 0;
        if (call.angle && call.total < d.params.length) {
          while (skip < d.params.length - call.total && !d.params[skip].includes(":")) {
            skip++;
          }
        }
        items.push({ d, active: call.index + skip, at: call.angle ? null : { start: call.start } });
      }
    }
    const w = word_at(text, pos);
    if (w) {
      const d = param_at(w.name, file, text, pos) || resolve(w.name, file, text);
      // a name right before its ( or { is a call too
      const calls = /^\s*[({]/.test(text.slice(w.b));
      if (d && !items.some((x) => x.d === d)) {
        items.push({ d, active: -1, at: calls ? { start: w.a } : null });
      }
    }
    return items;
  }

  function sig_update() {
    const f = file_now();
    const focus = document.activeElement === ed.ta;
    const items = focus && f.name.endsWith(".bend") && ed.ta.selectionStart === ed.ta.selectionEnd
      ? sig_items(ed.ta.value, ed.ta.selectionStart, f.name) : [];
    sigs.bar.hidden = items.length === 0;
    sigs.bar.textContent = "";
    if (focus) {
      goals_near();
    }
    for (const it of items) {
      const row = el("button", { class: "sig-row", type: "button", "aria-label": t("details_of", it.d.name) },
        el("span", { class: "sig-text", html: op_tag(it.op) + sig_html(it.d, it.active) }),
        el("span", { class: "sig-src", text: it.d.kind === "param" ? it.d.doc : sig_source(it.d) }));
      row.addEventListener("mousedown", (e) => e.preventDefault());
      row.addEventListener("click", () => sig_sheet(it.d, it.at));
      sigs.bar.append(row);
      const arg = $(".arg", row);
      if (arg) {
        const t = $(".sig-text", row);
        t.scrollLeft = Math.max(0, arg.offsetLeft - 40);
      }
    }
  }

  function sig_soon() {
    cancelAnimationFrame(sigs.raf);
    sigs.raf = requestAnimationFrame(sig_update);
  }

  function tip_hide() {
    clearTimeout(sigs.timer);
    sigs.tip.hidden = true;
  }

  // A pointer at rest over a name shows its declaration, as an editor would.
  function tip_at(e) {
    const f = file_now();
    if (!f.name.endsWith(".bend")) {
      return;
    }
    const text = ed.ta.value;
    const line = Math.floor((e.offsetY - ed.pad) / ed.lh) + 1;
    const col = Math.floor((e.offsetX - ed.pad) / ed.chw) + 1;
    const lines = text.split("\n");
    if (line < 1 || line > lines.length || col < 1 || col > lines[line - 1].length) {
      return;
    }
    const pos = text_offset(text, line, col);
    const o = op_at(text, pos) || op_at(text, pos + 1);
    const w = o ? null : word_at(text, pos);
    const d = o ? op_decl(o, text, f.name) : w && (param_at(w.name, f.name, text, pos) || resolve(w.name, f.name, text));
    if (!d) {
      return;
    }
    const tip = sigs.tip;
    tip.textContent = "";
    tip.append(el("div", { class: "tip-sig", html: op_tag(o ? o.op : "") + sig_html(d, -1) }));
    if (d.kind === "law" || d.kind === "type" || d.kind === "ctor") {
      tip.append(el("pre", { class: "tip-text", html: highlight(d.text.split("\n").slice(0, 14).join("\n")) }));
    }
    tip.append(el("div", { class: "tip-doc", text: (d.doc ? d.doc + "\n" : "") + sig_source(d)
      + (d.file !== null && d.kind !== "param" ? t("tip_line", d.line) : "") }));
    tip.hidden = false;
    const box = tip.getBoundingClientRect();
    tip.style.left = Math.max(8, Math.min(e.clientX + 12, window.innerWidth - box.width - 8)) + "px";
    tip.style.top = (e.clientY + 18 + box.height > window.innerHeight
      ? Math.max(8, e.clientY - box.height - 12) : e.clientY + 18) + "px";
  }

  function sig_init() {
    document.addEventListener("selectionchange", () => {
      if (document.activeElement === ed.ta) {
        sig_soon();
      }
    });
    ed.ta.addEventListener("focus", sig_soon);
    ed.ta.addEventListener("blur", () => setTimeout(sig_update, 150));
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      ed.ta.addEventListener("mousemove", (e) => {
        tip_hide();
        if (e.buttons === 0) {
          const at = { offsetX: e.offsetX, offsetY: e.offsetY, clientX: e.clientX, clientY: e.clientY };
          sigs.timer = setTimeout(() => tip_at(at), 380);
        }
      });
      for (const ev of ["mouseleave", "mousedown", "keydown", "wheel"]) {
        ed.ta.addEventListener(ev, tip_hide, { passive: true });
      }
      ed.box.addEventListener("scroll", tip_hide, { passive: true });
    }
  }


  // Goal marks
  // ==========
  // A line that reads "#goal:" is filled with the goal at that point of the
  // proof: what the code from there on has to meet, once the statements
  // above it have run. The checker only speaks at holes, so each mark is
  // probed in its turn: the mark becomes a hole and the rest of its block
  // goes, and the goal the checker reports is written after the colon. The
  // marks are refreshed on Check and on Run, never as you type.

  const MARK = /^(\s*)#\s?goal:.*$/;

  function marks_of(text) {
    const out = [];
    text.split("\n").forEach((l, i) => {
      if (MARK.test(l)) {
        out.push(i);
      }
    });
    return out;
  }

  // The text with mark i as a hole and the rest of its block removed.
  function marks_probe(text, i) {
    const lines = text.split("\n");
    const ind = MARK.exec(lines[i])[1];
    const out = lines.slice(0, i);
    out.push(ind + "?__goal");
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === "" || /^\s*#/.test(lines[j])
      || /^(\s*)/.exec(lines[j])[1].length >= ind.length)) {
      j++;
    }
    return out.concat(lines.slice(j)).join("\n");
  }

  async function marks_refresh(f) {
    const text = f.text;
    const at = marks_of(text);
    if (at.length === 0) {
      return false;
    }
    const files = files_map();
    const fresh = text.split("\n");
    for (const i of at) {
      const probe = marks_probe(text, i);
      const r = await comp_ask(f.name, false, { ...files, [f.name]: probe });
      if (r.stopped) {
        break;
      }
      const g = (r.goals || []).find((x) => x.name === "__goal" && x.file === f.name);
      if (g) {
        fresh[i] = MARK.exec(fresh[i])[1] + "#goal: " + g.expected.replace(/\s*\n\s*/g, " ");
      }
    }
    const next = fresh.join("\n");
    if (next === f.text) {
      return false;
    }
    if (f === file_now()) {
      ed_rewrite(next);
    } else {
      f.text = next;
      store_save();
    }
    return true;
  }

  // Rewrites only the lines that changed, through the undo stack, and puts
  // the caret back where it was.
  function ed_rewrite(next) {
    if (agent_guard()) {
      return;
    }
    const was = ed.ta.value;
    const a = was.split("\n");
    const b = next.split("\n");
    const { line, col } = ed_caret();
    const focus = document.activeElement === ed.ta;
    for (let i = a.length - 1; i >= 0; i--) {
      if (i < b.length && a[i] !== b[i]) {
        const from = text_offset(was, i + 1, 1);
        ed.ta.setSelectionRange(from, from + a[i].length);
        ed_insert(b[i]);
      }
    }
    if (ed.ta.value !== next) {
      ed.ta.value = next;
      ed.ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const pos = text_offset(ed.ta.value, line, col + 1);
    ed.ta.setSelectionRange(pos, pos);
    if (!focus) {
      ed.ta.blur();
    }
  }

  // Puts a "#goal:" line at the caret, on a line of its own, then fills it.
  async function marks_insert() {
    const f = file_now();
    if (f.ro || !f.name.endsWith(".bend")) {
      return;
    }
    ed.ta.focus({ preventScroll: true });
    const text = ed.ta.value;
    const { line } = ed_caret();
    const cur = text.split("\n")[line - 1] || "";
    const ind = /^\s*/.exec(cur)[0];
    const from = text_offset(text, line, 1);
    if (cur.trim() === "") {
      ed.ta.setSelectionRange(from, from + cur.length);
      ed_insert(ind + "#goal:");
    } else {
      ed.ta.setSelectionRange(from, from);
      ed_insert(ind + "#goal:\n");
      ed.ta.setSelectionRange(from + ind.length, from + ind.length);
    }
    await marks_refresh(f);
  }


  // Assistant
  // =========
  // An assistant reads the guide, the workspace and one thing to help with:
  // a goal (the answer is code for its hole), an error (an explanation and a
  // fix), or a declaration (a free question). Each call is one request with
  // everything in it; nothing is remembered between calls. Through the
  // claude.ai viewer the call goes to the viewer's own Claude; anywhere
  // else it goes straight to the configured server from this browser,
  // with the key kept here.

  const ai = { sample: null, pending: null, ctl: null, last: null,
    on: () => {
      const p = ai_cfg();
      return p !== null && (p.provider !== "claude" || ai.sample !== null || ai.pending !== null);
    } };

  // The profile in use: a name, a provider, its address, model and key.
  function ai_cfg() {
    return state.ai.profiles.find((p) => p.id === state.ai.active) || null;
  }

  const CLAUDE_TIERS = ["quick", "default", "complex"];

  // The models the provider offers: its own list, asked of it directly
  // (/v1/models, or Ollama's /api/tags), or Claude's three tiers here.
  async function ai_models(p) {
    if (p.provider === "claude") {
      return CLAUDE_TIERS.slice();
    }
    const url = (p.url || AI_PROVIDERS[p.provider].url || "").replace(/\/+$/, "");
    if (url === "") {
      throw { message: t("ai_need_url") };
    }
    const get = async (path, headers) => {
      let res;
      try {
        res = await fetch(url + path, { headers });
      } catch (e) {
        throw { message: t("ai_no_network") };
      }
      if (!res.ok) {
        throw { message: "HTTP " + res.status };
      }
      return res.json();
    };
    let ids;
    if (p.provider === "anthropic") {
      const data = await get("/v1/models?limit=1000", { "x-api-key": p.key, "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true" });
      ids = (data.data || []).map((m) => m.id);
    } else {
      try {
        const data = await get("/v1/models", p.key ? { authorization: "Bearer " + p.key } : {});
        ids = (data.data || data.models || []).map((m) => m.id || m.name);
      } catch (e) {
        const data = await get("/api/tags", {});
        ids = (data.models || []).map((m) => m.name || m.model);
      }
    }
    return [...new Set(ids.filter((x) => typeof x === "string" && x !== ""))].sort();
  }

  function ai_init() {
    if (window.claude && typeof window.claude.use === "function") {
      ai.pending = window.claude.use("sample").then(async (got) => {
        ai.sample = got;
        try {
          const lim = got && typeof got.limits === "function" ? await got.limits() : null;
          ai.tools = !!(lim && lim.tools);
        } catch (e) {
          ai.tools = false;
        }
        ai.pending = null;
        goals_paint();
      }, () => {
        ai.pending = null;
      });
    }
  }

  const AI_BUDGET = 60000;

  function ai_prompt(target, request) {
    const files = state.files.filter((f) => f.name.endsWith(".bend") || f.name.endsWith(".js"));
    const work = files.map((f) => "<file name=\"" + f.name + "\">\n" + f.text + "\n</file>").join("\n");
    let ask = "";
    if (target.kind === "goal") {
      const c = target.card;
      ask = "The hole ?" + c.name + " in " + c.file + ", line " + c.line + (c.def ? ", inside " + c.def : "")
        + ", must be a term of this type.\nContext (the variables in scope, with their types):\n"
        + c.ctx.map(([k, ty]) => "  " + k + " : " + ty).join("\n") + "\nGoal:\n  ⊢ " + c.expected
        + "\n\nWrite the Bend code to put in place of ?" + c.name + ", in one ```python block and nothing else in it,"
        + " at any indentation. A proof step you cannot finish may stay a hole ?name. Then explain in a few lines.";
    } else if (target.kind === "error") {
      ask = "The checker reports:\n" + target.r.text
        + "\n\nExplain what is wrong, in a few lines, and propose a fix. Put the corrected lines in a ```python block.";
    } else {
      const d = target.decl;
      ask = "The declaration in question, from " + sig_source(d) + ":\n" + d.text;
    }
    const tail = "\n\n" + ask + "\n\nRequest: " + request + "\n\nAnswer in " + LANG_NAMES[lang] + ".";
    const head = "You are helping someone write Bend 2, a functional language with dependent types, affine variables and a"
      + " termination checker, whose syntax is Python-shaped and whose semantics is close to Lean. Rely on the guide"
      + " below for its syntax and its Base library; do not invent functions Base does not have.\n\n";
    const room = AI_BUDGET - head.length - tail.length - work.length - 40;
    const guide = $("#bend-guide-md").textContent;
    const cut = room > 2000 ? (guide.length > room ? guide.slice(0, room) + "\n[guide cut here]" : guide) : "";
    return head + (cut === "" ? "" : "<guide>\n" + cut + "\n</guide>\n\n") + "<workspace>\n" + work + "\n</workspace>" + tail;
  }

  function ai_code(text) {
    const m = /```[a-zA-Z]*\n([\s\S]*?)```/.exec(text);
    return m === null ? null : m[1].replace(/\s+$/, "");
  }

  // Puts the code where the hole is, at the hole's indentation.
  function ai_insert(c, code) {
    const i = state.files.findIndex((x) => x.name === c.file);
    if (i < 0) {
      return;
    }
    if (i !== state.active) {
      files_pick(i);
    }
    const text = ed.ta.value;
    const lines = text.split("\n");
    const cur = lines[c.line - 1] || "";
    const at = cur.indexOf("?" + c.name);
    if (at < 0) {
      toast(t("ai_hole_gone"));
      return;
    }
    const rows = code.split("\n").filter((l, k, all) => !(k === all.length - 1 && l.trim() === ""));
    const common = Math.min(...rows.filter((l) => l.trim() !== "").map((l) => /^\s*/.exec(l)[0].length));
    const flat = rows.map((l) => l.slice(Math.min(common, l.length)));
    const keep = work_snapshot();
    ed.ta.focus({ preventScroll: true });
    if (cur.trim() === "?" + c.name) {
      const ind = /^\s*/.exec(cur)[0];
      const from = text_offset(text, c.line, 1);
      ed.ta.setSelectionRange(from, from + cur.length);
      ed_insert(flat.map((l) => (l === "" ? "" : ind + l)).join("\n"));
    } else {
      const from = text_offset(text, c.line, at + 1);
      ed.ta.setSelectionRange(from, from + c.name.length + 1);
      ed_insert(flat.map((l, k) => (k === 0 ? l.trim() : " ".repeat(at) + l)).join("\n"));
    }
    ed_reveal();
    toast(t("ai_inserted"), t("undo"), () => work_restore(keep));
  }

  async function ai_call(prompt, onText, signal) {
    const cfg = ai_cfg();
    if (cfg === null) {
      throw { code: "unavailable", message: t("ai_hint_none") };
    }
    if (cfg.provider === "claude") {
      const sample = ai.sample || (await ai.pending, ai.sample);
      if (sample === null) {
        throw { code: "unavailable", message: t("ai_no_claude") };
      }
      const opts = { signal, cache: false, onText: ({ text }) => onText(text) };
      if (CLAUDE_TIERS.includes(cfg.model)) {
        opts.modelTier = cfg.model;
      }
      const got = await sample(prompt, opts);
      return got.text;
    }
    const url = (cfg.url || AI_PROVIDERS[cfg.provider].url || "").replace(/\/+$/, "");
    const model = cfg.model || AI_PROVIDERS[cfg.provider].model || "";
    let res;
    try {
      res = cfg.provider === "anthropic"
        ? await fetch(url + "/v1/messages", { method: "POST", signal,
          headers: { "content-type": "application/json", "x-api-key": cfg.key, "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true" },
          body: JSON.stringify({ model, max_tokens: 4000, messages: [{ role: "user", content: prompt }] }) })
        : await fetch(url + "/v1/chat/completions", { method: "POST", signal,
          headers: Object.assign({ "content-type": "application/json" }, cfg.key ? { authorization: "Bearer " + cfg.key } : {}),
          body: JSON.stringify({ model, max_tokens: 4000, messages: [{ role: "user", content: prompt }] }) });
    } catch (e) {
      if (e && e.name === "AbortError") {
        throw { code: "cancelled", message: "" };
      }
      throw { code: "network", message: t("ai_no_network") + (e && e.message ? " (" + e.message + ")" : "") };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw { code: "http", message: "HTTP " + res.status + (body ? ": " + body.slice(0, 300) : "") };
    }
    const data = await res.json();
    if (cfg.provider === "anthropic") {
      return (data.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n");
    }
    return ((data.choices || [])[0] || {}).message?.content || "";
  }

  function ai_error(e) {
    const code = e && e.code;
    return code === "cancelled" ? t("ai_stopped")
      : code === "not_granted" ? t("ai_not_granted")
      : code === "rate_limited" ? t("ai_rate_limited")
      : code === "prompt_too_large" ? t("ai_too_large")
      : (e && e.message) || String(e);
  }

  function ai_sheet(target) {
    const box = el("div", { class: "form aisheet" });
    const what = target.kind === "goal" ? "?" + target.card.name + "  ⊢ " + target.card.expected
      : target.kind === "error" ? target.r.text.split("\n").slice(0, 3).join("\n")
      : target.decl.text.split("\n")[0];
    const req = el("textarea", { class: "ai-req", rows: "3", autocapitalize: "sentences", spellcheck: "true" });
    req.value = target.kind === "goal" ? t("ai_req_goal") : target.kind === "error" ? t("ai_req_error") : t("ai_req_decl");
    const out = el("pre", { class: "ai-out", hidden: true });
    const note = el("small", { class: "ai-note", text: t("ai_where", (ai_cfg() || { name: "—" }).name) });
    const usable = state.ai.profiles.filter((p) => p.provider !== "claude" || ai.sample !== null || ai.pending !== null);
    const pick = usable.length > 1 ? el("select", { class: "ai-sel", "aria-label": t("ai_profile") }) : null;
    if (pick !== null) {
      for (const p of usable) {
        pick.append(el("option", { value: p.id, text: p.name }));
      }
      pick.value = state.ai.active;
      pick.addEventListener("change", () => {
        state.ai.active = pick.value;
        store_main();
        note.textContent = t("ai_where", ai_cfg().name);
      });
    }
    const go = el("button", { class: "btn primary", type: "button", text: t("ai_send") });
    const stop = el("button", { class: "btn", type: "button", text: t("stop"), hidden: true });
    const put = el("button", { class: "btn", type: "button", text: t("ai_insert"), hidden: true });
    let close = () => {};
    const show = (text) => {
      out.hidden = false;
      out.textContent = text;
      put.hidden = !(target.kind === "goal" && ai_code(text) !== null);
    };
    if (ai.last && ai.last.key === JSON.stringify([target.kind, what])) {
      show(ai.last.text);
    }
    go.addEventListener("click", async () => {
      if (ai.ctl !== null) {
        return;
      }
      ai.ctl = new AbortController();
      go.disabled = true;
      stop.hidden = false;
      put.hidden = true;
      out.hidden = false;
      out.textContent = t("ai_thinking");
      const prompt = ai_prompt(target, req.value.trim() || ".");
      try {
        const text = await ai_call(prompt, (partial) => { out.textContent = partial; }, ai.ctl.signal);
        ai.last = { key: JSON.stringify([target.kind, what]), text };
        show(text);
      } catch (e) {
        out.textContent = (e && e.text ? e.text + "\n\n" : "") + ai_error(e);
      } finally {
        ai.ctl = null;
        go.disabled = false;
        stop.hidden = true;
      }
    });
    stop.addEventListener("click", () => {
      if (ai.ctl !== null) {
        ai.ctl.abort();
      }
    });
    put.addEventListener("click", () => {
      const code = ai_code(out.textContent);
      if (code !== null) {
        close();
        ai_insert(target.card, code);
      }
    });
    box.append(el("pre", { class: "ai-what", text: what }),
      pick === null ? null : el("label", {}, t("ai_profile"), pick),
      el("label", {}, t("ai_request"), req),
      el("div", { class: "row" }, go, stop, put, agent_ok() && target.kind !== "decl"
        ? el("button", { class: "btn", type: "button", text: target.kind === "goal" ? t("agent_from_goal") : t("agent_from_error"),
          onclick: () => {
            close();
            if (target.kind === "goal") {
              agent_open({ mode: "holes", holes: [target.card.name], entry: agent_default_entry(),
                task: req.value.trim() === t("ai_req_goal") ? "" : req.value.trim() });
            } else {
              agent_open({ mode: "project", entry: agent_default_entry(),
                task: t("agent_task_error") + "\n\n" + target.r.text.split("\n").slice(0, 8).join("\n") });
            }
          } }) : null),
      out, note);
    close = sheet_open(t("ai_title"), box);
    setTimeout(() => req.focus(), 60);
  }

  // Run
  // ===

  const run = { busy: false, btn: $("#run"), js: null, last: "" };

  function run_button(busy) {
    run.btn.dataset.busy = String(busy);
    $("#run-lbl").textContent = busy ? t("stop") : t("run");
    $("#run-ico").innerHTML = busy
      ? "<rect x=\"3\" y=\"3\" width=\"10\" height=\"10\" rx=\"1.5\" fill=\"currentColor\"/>"
      : "<path d=\"M4 2.5v11l9-5.5z\" fill=\"currentColor\"/>";
    run.btn.setAttribute("aria-label", busy ? t("stop") : t("run"));
  }

  // What Run runs: the open file, or, from a .js file, the .bend file last opened.
  function run_entry() {
    const f = file_now();
    if (f.name.endsWith(".bend") && !f.ro) {
      return f;
    }
    return state.files.find((x) => x.name === run.last)
      || state.files.find((x) => x.name.endsWith(".bend")) || null;
  }

  async function run_start(exec) {
    if (run.busy) {
      run_stop();
      return;
    }
    const f = run_entry();
    if (f === null) {
      toast(t("no_bend"));
      return;
    }
    run.busy = true;
    run_button(true);
    if (toast_now !== null) {
      toast_now.remove();
    }
    clearTimeout(live.timer);
    if (document.activeElement === ed.ta && COARSE) {
      ed.ta.blur();
    }
    tab_set("out");
    if (panel.state === "closed") {
      panel_set("half");
    }
    await marks_refresh(f);
    out_clear();
    const argv = args_split(state.args);
    out.diag.textContent = "";
    out_add("cmd", "$ bend " + f.name + (exec && argv.length ? " " + state.args.trim() : "") + "\n");
    verdict_set("busy", t("checking"));
    const mode = await comp_boot();
    const r = await comp_ask(f.name, exec);
    if (r.stopped) {
      out_add("dim", t("stopped_dot"));
      verdict_set("idle", t("check_stopped"));
      run_done();
      return;
    }
    verdict_of(r, f.name);
    out_report(r);
    goals_feed(r.goals || [], r);
    if ((r.ok || r.open) && !state.scratch && file_now() === f) {
      snap_take(r.ok ? "snap_checks" : "snap_goals");
    }
    if (!r.ok) {
      run_done();
      return;
    }
    let tail = t("checked_in", ms(r.ms.check));
    if (!exec) {
      out_add("dim", tail + "\n");
    } else if (!r.main) {
      out_add("dim", t("no_main") + tail + "\n");
    } else if (r.value !== undefined) {
      out_add("", r.value + "\n");
      out_add("dim", "\n" + tail + t("normalized", ms(r.ms.emit)) + "\n");
    } else {
      run.js = { key: js_key(), js: r.js, entry: f.name };
      js_show();
      tail += t("compiled_in", ms(r.ms.emit));
      const cfg = { args: argv, env: { USER: "bend", HOME: "/home", LANG: "fr_FR.UTF-8" } };
      const got = await run_program(r.js, cfg, (fd, text) => out_add(fd === 2 ? "err" : "", text));
      if (got.stopped) {
        out_add("warn", t("stopped_after", ms(got.ms)));
      } else if (got.blocked) {
        out_add("warn", t("no_eval"));
      } else {
        out_add("dim", "\n" + (got.code === 0 ? "" : t("exit_code", got.code))
          + tail + t("ran_in", ms(got.ms)) + (got.page ? t("on_page") : "") + "\n");
      }
    }
    if (r.page && mode === "worker") {
      out_add("dim", t("worker_stack"));
    }
    if (mode === "page" && exec) {
      out_add("dim", t("checker_on_page"));
    }
    run_done();
  }

  function run_done() {
    run.busy = false;
    run_button(false);
    screen_end();
  }

  function run_stop() {
    if (runner.stop !== null) {
      runner.stop();
    } else {
      comp_cancel();
    }
  }

  // Panel
  // =====

  const panel = { state: "closed", tab: "out" };

  function panel_set(st) {
    panel.state = st;
    const app = $("#app");
    app.classList.remove("panel-closed", "panel-half", "panel-full");
    app.classList.add("panel-" + st);
    $("#chev").setAttribute("aria-expanded", String(st !== "closed"));
    if (st !== "full") {
      requestAnimationFrame(ed_reveal);
    }
  }

  function tab_set(name) {
    panel.tab = name;
    for (const t of $$(".tab")) {
      t.setAttribute("aria-selected", String(t.dataset.tab === name));
    }
    for (const p of $$(".pane")) {
      p.hidden = p.id !== "pane-" + name;
    }
    if (name === "agent") {
      agent_paint();
    } else if (name === "screen") {
      requestAnimationFrame(screen_fit);
    } else if (name === "js") {
      js_fresh();
    } else if (name === "guide") {
      guide_mount();
    } else if (name === "base") {
      base_mount();
    }
  }

  function panel_init() {
    for (const t of $$(".tab")) {
      t.addEventListener("click", () => {
        tab_set(t.dataset.tab);
        if (!WIDE.matches) {
          panel_set(t.dataset.tab === "out" ? "half" : "full");
        }
      });
    }
    $("#chev").addEventListener("click", () => {
      panel_set(panel.state === "closed" ? (panel.tab === "out" ? "half" : "full") : "closed");
    });
    verdict.btn.addEventListener("click", () => {
      if (WIDE.matches) {
        tab_set("out");
      } else if (panel.state !== "closed" && panel.tab === "out") {
        panel_set("closed");
      } else {
        tab_set("out");
        panel_set("half");
      }
    });
    verdict.laws.addEventListener("click", () => {
      const i = state.files.findIndex((x) => /(^|\/)PROOF\.bend$/.test(x.name));
      if (i >= 0) {
        files_pick(i);
      }
    });
    run.btn.addEventListener("click", () => run_start(true));
    $("#check").addEventListener("click", () => run_start(false));
  }

  // Compiler outputs
  // ================
  // What bend f.bend -o f.<ext> would write, for the open file: JavaScript,
  // an ES module, C, or BendTT. Built only when this tab is shown, only for
  // the target picked, once typing stops, and kept while the files are the
  // same. The C sources of the effects travel compressed in the page and
  // are unpacked and handed to the checker the first time C is asked for.

  const OUT_TARGETS = [["js", "JS", ".js"], ["mjs", "out_mjs", ".mjs"], ["c", "C", ".c"], ["bendtt", "BendTT", ".bendtt"]];
  const outv = { target: "js", all: false, cache: new Map(), busy: "", timer: 0, shown: null, cfx: null };
  const OUT_KEEP = 6;
  const OUT_LIGHT = 250000;   // characters past which an output is shown plain

  function out_entry() {
    const f = file_now();
    if (!f.ro && f.name.endsWith(".bend")) {
      return f.name;
    }
    const e = run_entry();
    return e ? e.name : "";
  }

  function out_key(target, entry) {
    const text = JSON.stringify(state.files.map((f) => [f.name, f.text]));
    let h = 5381;
    for (let i = 0; i < text.length; i++) {
      h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    }
    return target + "\n" + entry + "\n" + text.length + ":" + h;
  }

  function out_remember(key, r) {
    outv.cache.delete(key);
    outv.cache.set(key, r);
    while (outv.cache.size > OUT_KEEP) {
      outv.cache.delete(outv.cache.keys().next().value);
    }
  }

  async function c_effects() {
    if (outv.cfx === null) {
      outv.cfx = (async () => {
        const b64 = $("#bend-ceffs").textContent.trim();
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return JSON.parse(await new Response(stream).text());
      })();
    }
    return outv.cfx;
  }

  // The output for the target picked: from the cache, or built now.
  async function out_fresh(now) {
    clearTimeout(outv.timer);
    if (panel.tab !== "js") {
      return;
    }
    const entry = out_entry();
    const target = outv.target;
    if (entry === "") {
      out_show({ ok: false, text: t("out_no_entry") }, target, entry, false);
      return;
    }
    const key = out_key(target, entry);
    if (outv.cache.has(key)) {
      out_show(outv.cache.get(key), target, entry, true);
      return;
    }
    // a run already built this program's JS
    if (target === "js" && run.js !== null && run.js.key === js_key() && run.js.entry === entry) {
      const r = { ok: true, out: run.js.js, ms: { check: 0, emit: 0 } };
      out_remember(key, r);
      out_show(r, target, entry, true);
      return;
    }
    if (!now) {
      out_show(null, target, entry, false, true);
      outv.timer = setTimeout(() => out_fresh(true), 800);
      return;
    }
    if (outv.busy === key) {
      return;
    }
    outv.busy = key;
    out_show(null, target, entry, false);
    let r;
    try {
      const extra = target === "c" ? await c_effects() : undefined;
      r = await comp_ask(entry, false, files_map(), "emit", { target, extra });
    } catch (e) {
      r = { ok: false, text: "Error: " + ((e && e.message) || String(e)) };
    }
    if (outv.busy === key) {
      outv.busy = "";
    }
    if (out_key(target, entry) === key) {
      out_remember(key, r);
      if (outv.target === target && out_entry() === entry) {
        out_show(r, target, entry, false);
      }
    }
  }

  // Typing in the editor: the output, if shown, follows once typing stops.
  function out_soon() {
    if (panel.tab === "js") {
      clearTimeout(outv.timer);
      outv.timer = setTimeout(() => out_fresh(true), 1200);
      // what is shown is the file as it was: say so until it is rebuilt
      if (outv.shown !== null && !$("#js-code").classList.contains("stale")) {
        $("#js-code").classList.add("stale");
        $("#js-info").textContent = t("out_stale", out_label(outv.target));
      }
    }
  }

  function out_label(target) {
    const tg = OUT_TARGETS.find((x) => x[0] === target);
    return tg[1].startsWith("out_") ? t(tg[1]) : tg[1];
  }

  // The part of a JS output that is the program, the runtime around it left out.
  function out_part(target, text) {
    if (outv.all || (target !== "js" && target !== "mjs")) {
      return text;
    }
    const a = text.indexOf("// Program\n");
    const b = text.indexOf("\n// Cli\n");
    return a < 0 ? text : text.slice(a, b < 0 ? text.length : b).trimEnd() + "\n";
  }

  function out_show(r, target, entry, cached, waiting) {
    outv.shown = r && r.ok ? { target, entry, text: r.out || "" } : null;
    const code = $("#js-code");
    code.classList.remove("stale");
    const info = $("#js-info");
    for (const b of $$("#out-targets .chip")) {
      b.setAttribute("aria-pressed", String(b.dataset.target === target));
    }
    $("#js-all").hidden = !(target === "js" || target === "mjs");
    $("#js-copy").disabled = !(r && r.ok);
    $("#js-save").disabled = !(r && r.ok);
    if (r === null) {
      code.textContent = "";
      info.textContent = waiting ? t("out_waiting", out_label(target)) : t("out_building", out_label(target), entry);
      return;
    }
    if (!r.ok) {
      code.textContent = r.text;
      info.textContent = r.hole ? t("out_holes") : r.nomain ? t("out_nomain") : t("js_bad");
      return;
    }
    let text = out_part(target, r.out || "");
    if (target === "bendtt") {
      const head = [];
      if ((r.promises || []).length > 0) {
        head.push(t("tt_promises") + "\n" + r.promises.map((k) => "- " + k).join("\n"));
      }
      if ((r.oos || []).length > 0) {
        head.push(t("tt_oos") + "\n" + r.oos.map(([k, why]) => "- " + k + (why ? ": " + why : "")).join("\n"));
      }
      if (head.length === 0) {
        head.push(t("tt_inscope", (r.out || "").split("\n").length));
      }
      head.push(t("tt_note", entry));
      text = head.join("\n\n") + "\n\n" + "─".repeat(24) + "\n\n" + text;
    }
    if (text.length <= OUT_LIGHT && target !== "bendtt") {
      code.innerHTML = highlight_js(text);
    } else {
      code.textContent = text;
    }
    const full = r.out || "";
    const kb = (full.length / 1024).toFixed(1).replace(".", t("decimal"));
    const lines = full.split("\n").length;
    info.textContent = t("out_info", out_label(target), entry, kb, lines)
      + (cached ? t("out_cached") : r.ms ? "  " + ms(r.ms.check + r.ms.emit) : "");
  }

  function js_key() {
    return JSON.stringify([state.active, state.files]);
  }

  // kept for the callers of before: the tab's content follows the target
  function js_show() {
    if (panel.tab === "js") {
      out_fresh(false);
    }
  }

  function js_fresh() {
    out_fresh(true);
  }

  function js_init() {
    const bar = $("#out-targets");
    for (const [k] of OUT_TARGETS) {
      bar.append(el("button", { class: "chip", type: "button", "data-target": k, "aria-pressed": String(k === outv.target),
        text: out_label(k), onclick: () => {
          outv.target = k;
          out_fresh(true);
        } }));
    }
    $("#js-all").addEventListener("click", (e) => {
      outv.all = !outv.all;
      e.currentTarget.setAttribute("aria-pressed", String(outv.all));
      out_fresh(true);
    });
    $("#js-copy").addEventListener("click", () => {
      if (outv.shown) {
        copy_text(outv.target === "bendtt" ? outv.shown.text : out_part(outv.shown.target, outv.shown.text));
      }
    });
    $("#js-save").addEventListener("click", async () => {
      if (!outv.shown) {
        return;
      }
      const ext = OUT_TARGETS.find((x) => x[0] === outv.shown.target)[2];
      try {
        await save_file(outv.shown.entry.replace(/\.bend$/, "").split("/").pop() + ext, outv.shown.text);
      } catch (e) {
        toast(save_error(e));
      }
    });
  }

  async function copy_text(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast(t("copied"));
    } catch (e) {
      const ta = el("textarea", { style: "position:fixed;opacity:0" });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (e2) {}
      ta.remove();
      toast(ok ? t("copied") : t("copy_fail"));
    }
  }

  // Guide
  // =====

  let guide_done = false;

  function guide_mount() {
    if (guide_done) {
      return;
    }
    guide_done = true;
    const host = $("#guide");
    host.append($("#guide-html").content.cloneNode(true));
    for (const code of $$("pre code.bend", host)) {
      code.innerHTML = highlight(code.textContent);
    }
    for (const b of $$(".try", host)) {
      b.textContent = t("try");
      b.addEventListener("click", () => {
        const text = $("code", b.parentNode).textContent;
        proj_new(t("guide_snippet"), [{ name: "main.bend", text }], true, t("guide_opened"));
        if (!WIDE.matches) {
          panel_set("closed");
        }
      });
    }
  }

  // Base
  // ====

  const base = { decls: null };

  // A declaration is a type, law or def line, the indented lines under it,
  // and the comment lines right above it.
  function base_parse() {
    const decls = [];
    let cur = null;
    let doc = [];
    for (const l of Core.base_text().split("\n")) {
      const m = /^(?:@unsafe\s+)?(type|law|def) ([^\s(<:]+)/.exec(l);
      if (m !== null) {
        cur = { name: m[2], kind: m[1], text: doc.concat(l).join("\n") };
        decls.push(cur);
        doc = [];
      } else if (/^#/.test(l)) {
        doc = /^# ?[=-]{3,}/.test(l) ? [] : doc.concat(l);
        cur = null;
      } else if (l.trim() === "") {
        doc = [];
        cur = null;
      } else if (cur !== null) {
        cur.text += "\n" + l;
      }
    }
    return decls;
  }

  function base_mount() {
    if (base.decls !== null) {
      return;
    }
    base.decls = base_parse();
    const counts = new Map();
    for (const d of base.decls) {
      const ns = d.name.split(".")[0];
      if (/^[A-Z]/.test(ns)) {
        counts.set(ns, (counts.get(ns) || 0) + 1);
      }
    }
    const ns = $("#base-ns");
    for (const [k, n] of [...counts].filter(([, c]) => c > 1).sort((a, b) => a[0].localeCompare(b[0]))) {
      ns.append(el("button", { class: "chip", type: "button", text: k + " " + n,
        onclick: () => { $("#base-q").value = k; base_find(); } }));
    }
    $("#base-q").addEventListener("input", base_find);
    base_find();
  }

  function base_find() {
    const q = $("#base-q").value.trim();
    const list = $("#base-list");
    list.textContent = "";
    $("#base-ns").hidden = q !== "";
    if (q === "") {
      list.append(el("p", { class: "more", text: t("base_intro", base.decls.length) }));
      return;
    }
    const lo = q.toLowerCase();
    const rank = (d) => d.name === q ? 0 : d.name.startsWith(q + ".") ? 1
      : d.name.toLowerCase().startsWith(lo) ? 2 : d.name.toLowerCase().includes(lo) ? 3 : 9;
    const hits = base.decls.map((d, i) => [rank(d), i, d]).filter((x) => x[0] < 9)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [, , d] of hits.slice(0, 60)) {
      list.append(el("pre", { class: "decl", html: highlight(d.text) }));
    }
    list.append(el("p", { class: "more", text: hits.length === 0 ? t("base_none")
      : hits.length > 60 ? t("base_more", hits.length - 60) : "" }));
  }

  // Files
  // =====

  function files_paint() {
    const bar = $("#files");
    bar.textContent = "";
    state.files.forEach((f, i) => {
      const on = i === state.active && view.hub === null;
      bar.append(el("button", { class: "file", type: "button", role: "tab", "data-name": f.name,
        "aria-selected": String(on), onclick: () => (on ? file_sheet() : files_pick(i)) },
        el("span", { class: "dot" }), f.name));
    });
    bar.append(el("button", { class: "file-more", type: "button", "aria-label": t("file_more_aria"),
      text: "⋯", onclick: file_sheet }));
    bar.append(el("button", { class: "file-add", type: "button", "aria-label": t("file_add_aria"),
      text: "+", onclick: () => name_sheet(null) }));
    for (const m of hub_imports()) {
      const on = view.hub === m.rel;
      bar.append(el("button", { class: "file hub", type: "button", role: "tab", "aria-selected": String(on),
        title: m.rel, "aria-label": t("hub_tab", m.alias, m.rel),
        onclick: () => (on ? null : hub_pick(m.rel, m.alias)) },
        el("span", { class: "lock", text: "⧉" }), m.alias + " · " + m.rel.split("/").pop()));
    }
  }

  function files_status(name, cls) {
    for (const b of $$(".file")) {
      if (b.dataset.name === name) {
        b.classList.remove("good", "bad", "open");
        if (cls) {
          b.classList.add(cls);
        }
      }
    }
  }

  function files_pick(i) {
    hub_leave();
    state.active = i;
    files_paint();
    ed_set(file_now().text);
    ed.box.scrollTop = 0;
    ed.box.scrollLeft = 0;
    verdict_set("idle", "…");
    diag_show(null);
    store_save();
    live_soon();
    $("#files").children[i].scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // A module's path is plain names, as the loader wants: math.bend, not
  // math.extra.bend. An effect's .js takes any plain file name.
  function name_ok(name, skip) {
    if (!/^([A-Za-z_][\w-]*\/)*[A-Za-z_][\w-]*\.bend$/.test(name) && !/^([A-Za-z_][\w-]*\/)*[A-Za-z0-9_][\w.-]*\.js$/.test(name)) {
      return t("name_rule");
    }
    if (skip !== -2 && state.files.some((f, i) => f.name === name && i !== skip)) {
      return t("name_taken");
    }
    return "";
  }

  // name_sheet(null) creates a file; name_sheet(i) renames file i.
  function name_sheet(i) {
    if (agent_guard()) {
      return;
    }
    const fresh = i === null;
    const input = el("input", { type: "text", autocapitalize: "off", autocomplete: "off",
      autocorrect: "off", spellcheck: "false", value: fresh ? "" : state.files[i].name,
      placeholder: "lib.bend" });
    const note = el("small", { text: fresh ? t("import_hint") : "" });
    const go = el("button", { class: "btn primary", type: "button", text: fresh ? t("create_file") : t("rename") });
    const body = el("div", { class: "form" }, el("label", {}, t("file_name"), input, note),
      el("div", { class: "row" }, go));
    const close = sheet_open(fresh ? t("new_file") : t("rename"), body);
    const submit = () => {
      const name = input.value.trim();
      const bad = name_ok(name, fresh ? -1 : i);
      if (bad) {
        note.textContent = bad;
        note.style.color = "var(--fail)";
        return;
      }
      proj_touch();
      if (fresh) {
        const text = name.endsWith(".bend") ? "import Base\n\n" : "// " + name + "\n";
        state.files.push({ name, text });
        close();
        files_pick(state.files.length - 1);
      } else {
        state.files[i].name = name;
        close();
        files_pick(i);
      }
    };
    go.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        submit();
      }
    });
    setTimeout(() => input.focus(), 60);
  }

  function file_sheet() {
    if (agent_guard()) {
      return;
    }
    const i = state.active;
    const f = state.files[i];
    const del = el("button", { class: "btn danger", type: "button", text: t("delete_x", f.name),
      disabled: state.files.length < 2 });
    const body = el("div", { class: "form" },
      el("div", { class: "row" },
        el("button", { class: "btn", type: "button", text: t("rename"), onclick: () => { close(); name_sheet(i); } }),
        el("button", { class: "btn", type: "button", text: t("copy_content"), onclick: () => { close(); copy_text(f.text); } }),
        del),
      el("small", { text: state.files.length < 2 ? t("last_file") : t("undo_soon") }));
    const close = sheet_open(f.name, body);
    del.addEventListener("click", () => {
      close();
      const keep = work_snapshot();
      snap_take(["snap_before_delete", f.name], true);
      proj_touch();
      state.files.splice(i, 1);
      files_pick(Math.max(0, i - 1));
      toast(t("deleted", f.name), t("undo"), () => work_restore(keep));
    });
  }

  // Workspace
  // =========

  function work_snapshot() {
    return JSON.stringify({ files: state.files, active: state.active });
  }

  function work_restore(snap) {
    const got = JSON.parse(snap);
    goals_clear();
    state.files = got.files;
    files_pick(got.active);
  }

  // The editor, the panels and the header follow the project on state.
  function work_show() {
    run.js = null;
    laws_set(null);
    goals_clear();
    out_clear();
    out.hint.hidden = false;
    proj_label();
    files_pick(state.active);
  }

  // Projects
  // ========
  // Opening anything never overwrites work: an example, a guide snippet or an
  // import becomes a project of its own. One opened only to look at (scratch)
  // leaves no trace: it goes when the next one opens, unless it was edited.

  function proj_label() {
    $("#proj-name").textContent = state.name;
  }

  function proj_touch() {
    state.scratch = false;
  }

  // Parks the open project among the others, or drops it if it was scratch.
  function proj_park() {
    clearTimeout(save_timer);
    if (state.scratch) {
      ls_del(LS_PROJ + state.id);
      ls_del(LS_SNAP + state.id);
      return null;
    }
    const p = proj_pack();
    ls_set(LS_PROJ + p.id, p);
    store.others.unshift(p);
    return p;
  }

  function proj_switch(id) {
    const i = store.others.findIndex((p) => p.id === id);
    if (i < 0) {
      return;
    }
    const next = store.others.splice(i, 1)[0];
    proj_park();
    proj_unpack(next);
    store_flush();
    work_show();
  }

  function proj_new(want, files, scratch, label) {
    const before = proj_pack();
    const parked = proj_park();
    const name = proj_name_free(want);
    proj_unpack({ id: proj_id(), name, scratch, active: 0, args: "",
      files: files.map((f) => ({ name: f.name, text: f.text })) });
    store_flush();
    work_show();
    toast(label || t("opened_new", name), t("undo"), () => {
      const made = state.id;
      ls_del(LS_PROJ + made);
      ls_del(LS_SNAP + made);
      if (parked) {
        store.others = store.others.filter((p) => p.id !== parked.id);
      }
      proj_unpack(before);
      store_flush();
      work_show();
    });
  }

  function proj_delete(id) {
    const i = store.others.findIndex((p) => p.id === id);
    if (i < 0) {
      return;
    }
    const gone = store.others.splice(i, 1)[0];
    const snaps = ls_get(LS_SNAP + id);
    ls_del(LS_PROJ + id);
    ls_del(LS_SNAP + id);
    store_main();
    toast(t("proj_deleted", gone.name), t("undo"), () => {
      store.others.splice(i, 0, gone);
      ls_set(LS_PROJ + id, gone);
      if (snaps) {
        ls_set(LS_SNAP + id, snaps);
      }
      store_main();
    });
  }

  function snap_restore(snap) {
    const keep = work_snapshot();
    snap_take("snap_before_restore", true);
    state.files = snap.files.map(([name, text]) => ({ name, text }));
    state.active = 0;
    proj_touch();
    store_save();
    work_show();
    toast(t("snap_restored"), t("undo"), () => {
      work_restore(keep);
      store_save();
    });
  }

  // Zip
  // ===
  // A project travels as a zip of its plain files: unzip it and
  // `bend main.bend` runs. Written stored, read stored or deflated.

  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      }
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(b) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < b.length; i++) {
      c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function zip_make(files, folder) {
    const enc = new TextEncoder();
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const parts = [];
    const dir = [];
    let at = 0;
    for (const f of files) {
      const name = enc.encode(folder + "/" + f.name);
      const data = enc.encode(f.text);
      const crc = crc32(data);
      const head = new DataView(new ArrayBuffer(30));
      head.setUint32(0, 0x04034b50, true);
      head.setUint16(4, 20, true);
      head.setUint16(6, 0x0800, true);
      head.setUint16(10, time, true);
      head.setUint16(12, date, true);
      head.setUint32(14, crc, true);
      head.setUint32(18, data.length, true);
      head.setUint32(22, data.length, true);
      head.setUint16(26, name.length, true);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint16(12, time, true);
      cen.setUint16(14, date, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, data.length, true);
      cen.setUint32(24, data.length, true);
      cen.setUint16(28, name.length, true);
      cen.setUint32(42, at, true);
      parts.push(new Uint8Array(head.buffer), name, data);
      dir.push(new Uint8Array(cen.buffer), name);
      at += 30 + name.length + data.length;
    }
    const size = dir.reduce((n, x) => n + x.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, size, true);
    end.setUint32(16, at, true);
    return new Blob(parts.concat(dir, [new Uint8Array(end.buffer)]), { type: "application/zip" });
  }

  // all: every text entry, names as they are (for a zip of ~/.bend/lib).
  async function zip_read(buf, all) {
    const v = new DataView(buf);
    let end = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
      if (v.getUint32(i, true) === 0x06054b50) {
        end = i;
        break;
      }
    }
    if (end < 0) {
      throw new Error(t("zip_unreadable"));
    }
    const count = v.getUint16(end + 10, true);
    const dec = new TextDecoder("utf-8");
    const out = [];
    let at = v.getUint32(end + 16, true);
    for (let n = 0; n < count && n < 400; n++) {
      if (v.getUint32(at, true) !== 0x02014b50) {
        break;
      }
      const method = v.getUint16(at + 10, true);
      const csize = v.getUint32(at + 20, true);
      const nlen = v.getUint16(at + 28, true);
      const xlen = v.getUint16(at + 30, true);
      const clen = v.getUint16(at + 32, true);
      const local = v.getUint32(at + 42, true);
      const name = dec.decode(new Uint8Array(buf, at + 46, nlen));
      at += 46 + nlen + xlen + clen;
      if (name.endsWith("/") || name.startsWith("__MACOSX/") || csize > 4e6
        || (all ? /\.(png|jpe?g|gif|zip|gz|wasm|bin|o|a|so|dylib|exe)$/i.test(name) : !/\.(bend|js)$/.test(name))) {
        continue;
      }
      const from = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const raw = new Uint8Array(buf, from, csize);
      let bytes = raw;
      if (method === 8) {
        if (typeof DecompressionStream !== "function") {
          throw new Error(t("zip_deflate"));
        }
        const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      } else if (method !== 0) {
        continue;
      }
      out.push({ name, text: dec.decode(bytes) });
    }
    if (all) {
      return { folder: "", files: out };
    }
    // a single top folder is the project's own: its files are the project
    const top = out.length > 0 && out.every((f) => f.name.includes("/")) ? out[0].name.split("/")[0] + "/" : "";
    const flat = top !== "" && out.every((f) => f.name.startsWith(top));
    return { folder: flat ? top.slice(0, -1) : "",
      files: out.map((f) => ({ name: flat ? f.name.slice(top.length) : f.name, text: f.text })) };
  }

  // Export and import
  // =================
  // Inside claude.ai a page may not start a download: the viewer's downloads
  // capability asks the person instead. Anywhere else a link does it.

  const saver = window.claude && typeof window.claude.use === "function"
    ? window.claude.use("downloads").catch(() => null) : Promise.resolve(null);

  function file_stem(name) {
    return name.trim().replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "") || "projet";
  }

  async function save_file(filename, data) {
    const cap = await saver;
    if (cap) {
      await cap.save({ filename, data });
      return;
    }
    const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
    const a = el("a", { href: url, download: filename, style: "display:none" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // The project as a zip, or as one .json file, which Import reads too. The
  // viewer may turn zips off: then it says so, and the .json is one tap.
  async function proj_export(fmt) {
    const stem = file_stem(state.name);
    try {
      if (fmt === "json") {
        await save_file(stem + ".json", JSON.stringify({ bend_project: 1, name: state.name, files: state.files }, null, 1));
      } else {
        await save_file(stem + ".zip", zip_make(state.files, stem));
      }
    } catch (e) {
      toast(save_error(e));
    }
  }

  function save_error(e) {
    const code = e && e.code;
    return code === "declined" ? t("export_cancel")
      : code === "rejected_extension" || code === "extension_not_enabled" ? t("export_format_off")
      : code === "rate_limited" ? t("export_busy") : t("export_fail");
  }

  function name_clean(name) {
    return name.replace(/\\/g, "/").replace(/^\.?\/+/, "");
  }

  async function proj_import(list) {
    let took = 0;
    let hub_added = 0;
    let files = [];
    let want = "";
    try {
      for (const file of list) {
        if (/\.zip$/i.test(file.name)) {
          const raw = await zip_read(await file.arrayBuffer(), true);
          if (raw.files.some((f) => /(^|\/)(0x[0-9a-f]{32}|names)\//.test(f.name))) {
            took += 1;
            hub_added += await hub_take(raw.files);
            continue;
          }
          const got = await zip_read(await file.arrayBuffer());
          files = files.concat(got.files);
          want = want || got.folder || file.name.replace(/\.zip$/i, "");
        } else if (/\.json$/i.test(file.name)) {
          const got = JSON.parse(await file.text());
          if (!got || !files_ok(got.files)) {
            throw new Error(t("not_a_project", file.name));
          }
          files = files.concat(got.files);
          want = want || got.name || "";
        } else if (/\.(bend|js)$/i.test(file.name)) {
          files.push({ name: file.name, text: await file.text() });
          want = want || (list.length === 1 ? file.name.replace(/\.\w+$/, "") : "");
        }
      }
    } catch (e) {
      toast(t("import_fail", e.message || e));
      return;
    }
    const seen = new Set();
    files = files.map((f) => ({ name: name_clean(f.name), text: f.text }))
      .filter((f) => name_ok(f.name, -2) === "" && !seen.has(f.name) && seen.add(f.name));
    if (files.length === 0) {
      toast(took > 0 ? (hub_added > 0 ? t("hub_added", hub_added) : t("hub_nothing")) : t("import_none"));
      if (hub_added > 0) {
        files_paint();
        live_soon();
      }
      return;
    }
    files.sort((x, y) => Number(y.name === "main.bend") - Number(x.name === "main.bend"));
    proj_new(want || t("import_name"), files, false);
  }

  function when(ms) {
    const d = new Date(ms);
    const day = new Date().toDateString() === d.toDateString() ? ""
      : d.toLocaleDateString(t("locale"), { day: "numeric", month: "short" }) + " ";
    return day + d.toLocaleTimeString(t("locale"), { hour: "2-digit", minute: "2-digit" });
  }

  function count_files(n) {
    return t("n_files", n);
  }

  // A snapshot's label is a key, or a key with its argument, so it reads
  // in whatever language the history is shown in.
  function snap_label(label) {
    return Array.isArray(label) ? t(label[0], label[1]) : t(label);
  }

  // How far a snapshot is from the code as it stands, in lines.
  function snap_delta(snap) {
    const bag = new Map();
    for (const f of state.files) {
      for (const l of f.text.split("\n")) {
        bag.set(f.name + "\n" + l, (bag.get(f.name + "\n" + l) || 0) + 1);
      }
    }
    let less = 0;
    for (const [name, text] of snap.files) {
      for (const l of text.split("\n")) {
        const k = name + "\n" + l;
        const n = bag.get(k) || 0;
        if (n > 0) {
          bag.set(k, n - 1);
        } else {
          less += 1;
        }
      }
    }
    let more = 0;
    for (const n of bag.values()) {
      more += n;
    }
    return more + less === 0 ? t("current_state") : t("lines_delta", less, more);
  }

  function projects_sheet() {
    if (agent_guard()) {
      return;
    }
    let close = () => {};
    const again = () => {
      close();
      projects_sheet();
    };
    const name = el("input", { type: "text", value: state.name, autocomplete: "off", spellcheck: "false",
      "aria-label": t("proj_name_aria") });
    name.addEventListener("change", () => {
      const want = name.value.trim();
      if (want !== "" && want !== state.name) {
        state.name = "";
        state.name = proj_name_free(want);
        proj_touch();
        store_flush();
        proj_label();
      }
      name.value = state.name;
    });
    const pick = el("input", { type: "file", accept: ".bend,.js,.zip,.json", multiple: true, style: "display:none" });
    pick.addEventListener("change", () => {
      const list = [...pick.files];
      close();
      proj_import(list);
    });
    const hist = el("div", { class: "snaps" });
    for (const snap of store.snaps.slice().reverse()) {
      hist.append(el("div", { class: "snap" },
        el("span", { class: "snap-at", text: when(snap.at) }),
        el("span", { class: "snap-what", text: snap_label(snap.label) + ", " + snap_delta(snap) }),
        el("button", { class: "chip", type: "button", text: t("restore"), onclick: () => { close(); snap_restore(snap); } })));
    }
    const body = el("div", { class: "form" },
      el("label", {}, t("proj_open"), name,
        el("small", { text: count_files(state.files.length) + t("modified", when(state.updated))
          + (state.scratch ? t("scratch_note") : "") })),
      el("div", { class: "row" },
        el("button", { class: "btn", type: "button", text: t("export_zip"), onclick: () => { close(); proj_export("zip"); } }),
        el("button", { class: "btn", type: "button", text: t("export_json"), onclick: () => { close(); proj_export("json"); } }),
        el("button", { class: "btn", type: "button", text: t("duplicate"), onclick: () => {
          close();
          proj_new(state.name + t("copy_suffix"), state.files, false, t("copy_opened"));
        } }),
        el("button", { class: "btn", type: "button", text: t("snapshot"), onclick: () => {
          toast(snap_take("snap_manual", true) ? t("snap_taken") : t("snap_same"));
          again();
        } })),
      el("details", { class: "hist" },
        el("summary", { text: t("history", store.snaps.length) }),
        store.snaps.length === 0 ? el("small", { text: t("history_hint") }) : hist));
    if (store.others.length > 0) {
      const list = el("div", { class: "projs" });
      for (const p of store.others) {
        list.append(el("div", { class: "proj-row" },
          el("button", { class: "proj-open", type: "button", onclick: () => { close(); proj_switch(p.id); } },
            el("b", { text: p.name }),
            el("span", { text: count_files(p.files.length) + ", " + when(p.updated || 0) })),
          el("button", { class: "chip", type: "button", "aria-label": t("delete_x", p.name), text: t("delete"),
            onclick: () => { proj_delete(p.id); again(); } })));
      }
      body.append(el("div", { class: "field" }, el("span", { text: t("other_projects") }), list));
    }
    body.append(pick, el("div", { class: "row" },
      el("button", { class: "btn primary", type: "button", text: t("new_project"), onclick: () => {
        close();
        proj_new(t("untitled"), [{ name: "main.bend", text: "import Base\n\ndef main() -> IO(Unit):\n  do IO<Unit>:\n    IO.print(\"\")\n" }], false);
      } }),
      el("button", { class: "btn", type: "button", text: t("import_btn"), onclick: () => pick.click() })));
    close = sheet_open(t("projects"), body);
  }

  // Sheets and toast
  // ================

  function sheet_open(title, body) {
    const x = el("button", { class: "top-btn", type: "button", text: t("close") });
    const sheet = el("div", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title },
      el("div", { class: "sheet-head" }, el("h2", { text: title }), x),
      el("div", { class: "sheet-body" }, body));
    const scrim = el("div", { class: "scrim" }, sheet);
    const close = () => {
      scrim.remove();
      document.removeEventListener("keydown", on_key);
    };
    const on_key = (e) => {
      if (e.key === "Escape") {
        close();
      }
    };
    scrim.addEventListener("click", (e) => {
      if (e.target === scrim) {
        close();
      }
    });
    x.addEventListener("click", close);
    document.addEventListener("keydown", on_key);
    document.body.append(scrim);
    return close;
  }

  let toast_now = null;

  function toast(text, action, fn) {
    if (toast_now !== null) {
      toast_now.remove();
    }
    const t = el("div", { class: "toast", role: "status" }, el("span", { text }));
    if (action) {
      t.append(el("button", { type: "button", text: action, onclick: () => { t.remove(); fn(); } }));
    }
    document.body.append(t);
    toast_now = t;
    setTimeout(() => t.remove(), action ? 7000 : 2200);
  }

  function examples_sheet() {
    if (agent_guard()) {
      return;
    }
    const body = el("div");
    let group = "";
    let close = () => {};
    for (const ex of EXAMPLES) {
      if (ex_text(ex.group) !== group) {
        group = ex_text(ex.group);
        body.append(el("div", { class: "group", text: group }));
      }
      const many = ex.files.length > 1 ? el("em", { text: "  " + count_files(ex.files.length) }) : null;
      body.append(el("button", { class: "ex", type: "button", onclick: () => {
        close();
        proj_new(ex_text(ex.title), ex.files, true, t("opened", ex_text(ex.title)));
      } }, el("b", {}, ex_text(ex.title), many), el("span", { text: ex_text(ex.note) })));
    }
    close = sheet_open(t("examples"), body);
  }

  function settings_sheet() {
    const args = el("input", { type: "text", value: state.args, autocapitalize: "off",
      autocomplete: "off", autocorrect: "off", spellcheck: "false", placeholder: "alice 42" });
    args.addEventListener("input", () => {
      state.args = args.value;
      store_save();
    });
    const livebox = el("input", { type: "checkbox" });
    livebox.checked = state.live;
    livebox.addEventListener("change", () => {
      state.live = livebox.checked;
      store_save();
      if (state.live) {
        live_soon();
      } else {
        verdict_set("idle", t("check_on_demand"));
      }
    });
    const size = el("span", { class: "grow", text: state.size + " px" });
    const langs = el("div", { class: "row" });
    for (const [code, label] of [["en", "English"], ["fr", "Français"], ["pt", "Português"]]) {
      langs.append(el("button", { class: "btn", type: "button", text: label, "aria-pressed": String(lang === code),
        onclick: () => {
          if (lang !== code) {
            lang_set(code);
            close();
            settings_sheet();
          }
        } }));
    }
    const bump = (d) => () => {
      state.size = Math.min(22, Math.max(11, state.size + d));
      size.textContent = state.size + " px";
      size_apply();
      store_save();
    };
    let close = () => {};
    const body = el("div", { class: "form" },
      el("div", { class: "field" }, el("span", { text: t("language") }), langs),
      fonts_setting(),
      ai_settings(),
      el("label", {}, t("args_label"), args, el("small", { text: t("args_hint") })),
      el("label", { class: "check" }, livebox,
        el("span", {}, t("live_label"), el("br"), el("small", { text: t("live_hint") }))),
      el("div", { class: "field" }, el("span", { text: t("code_size") }),
        el("div", { class: "row" },
          el("button", { class: "btn", type: "button", text: "A−", "aria-label": t("smaller"), onclick: bump(-1) }),
          el("button", { class: "btn", type: "button", text: "A+", "aria-label": t("larger"), onclick: bump(1) }), size)));
    close = sheet_open(t("settings"), body);
  }

  // The fonts: the one request the page makes of its own, to Google Fonts.
  // Off, the page asks for nothing and the system's fonts are used.
  function fonts_setting() {
    const box = el("input", { type: "checkbox" });
    box.checked = state.fonts;
    box.addEventListener("change", () => {
      state.fonts = box.checked;
      store_main();
      if (typeof window.bendFonts === "function") {
        window.bendFonts(state.fonts);
      }
      // the character width changes with the font: measure again
      const refit = () => {
        ed_measure();
        ed_paint();
        goals.chw = 0;
        goals_paint();
      };
      refit();
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(refit);
      }
    });
    return el("div", { class: "field" }, el("span", { text: t("privacy") }),
      el("label", { class: "check" }, box,
        el("span", {}, t("fonts_label"), el("br"), el("small", { text: t("fonts_hint") }))));
  }

  // The assistant's profiles: each a name, a provider, its address, model
  // and key, kept in this browser. One is in use; any can be edited here.
  function ai_settings() {
    const viewer = !!(window.claude && typeof window.claude.use === "function");
    const box = el("div", { class: "field ai-box" });
    const paint = () => {
      box.textContent = "";
      const profiles = state.ai.profiles;
      const sel = el("select", { class: "ai-sel", "aria-label": t("ai_profile") });
      sel.append(el("option", { value: "", text: t("ai_none_profile") }));
      for (const p of profiles) {
        sel.append(el("option", { value: p.id, text: p.name }));
      }
      sel.value = state.ai.active;
      sel.addEventListener("change", () => {
        state.ai.active = sel.value;
        store_main();
        goals_paint();
        paint();
      });
      const add = el("button", { class: "btn", type: "button", text: t("ai_new_profile"), onclick: () => {
        const p = { id: proj_id(), name: t("ai_profile_n", profiles.length + 1),
          provider: viewer ? "claude" : "custom", url: "", model: "", key: "", models: [] };
        profiles.push(p);
        state.ai.active = p.id;
        store_main();
        goals_paint();
        paint();
      } });
      box.append(el("span", { text: t("ai_title") }), el("div", { class: "row" }, el("span", { class: "grow" }, sel), add));
      const cfg = ai_cfg();
      if (cfg === null) {
        box.append(el("small", { text: t("ai_hint_none") }));
        return;
      }
      const save = () => {
        store_main();
        goals_paint();
      };
      const field = (k, type) => {
        const i = el("input", { type: type || "text", value: cfg[k] || "", autocapitalize: "off",
          autocomplete: "off", autocorrect: "off", spellcheck: "false" });
        i.addEventListener("input", () => {
          cfg[k] = k === "name" ? i.value : i.value.trim();
          save();
        });
        return i;
      };
      const name = field("name");
      name.addEventListener("change", () => {
        cfg.name = cfg.name.trim() || t("ai_profile_n", profiles.indexOf(cfg) + 1);
        save();
        paint();
      });
      const prov = el("select", { class: "ai-sel", "aria-label": t("ai_provider") });
      for (const [k, p] of Object.entries(AI_PROVIDERS)) {
        if (k !== "none" && (k !== "claude" || viewer || cfg.provider === "claude")) {
          prov.append(el("option", { value: k, text: t("prov_" + k) }));
        }
      }
      prov.value = cfg.provider;
      prov.addEventListener("change", () => {
        cfg.provider = prov.value;
        cfg.models = [];
        if (cfg.provider === "claude" && !CLAUDE_TIERS.includes(cfg.model)) {
          cfg.model = "";
        }
        save();
        paint();
      });
      const claude = cfg.provider === "claude";
      const url = field("url");
      url.placeholder = AI_PROVIDERS[cfg.provider].url || "";
      const key = field("key", "password");
      // the model: a list asked of the provider, and free text beside it
      const model = field("model");
      model.placeholder = AI_PROVIDERS[cfg.provider].model || t("ai_model_ph");
      const list = el("select", { class: "ai-sel", "aria-label": t("ai_model_list") });
      const status = el("small", { class: "ai-status", text: "" });
      const fill = () => {
        list.textContent = "";
        list.append(el("option", { value: "", text: claude ? t("ai_tier_default") : t("ai_model_free") }));
        for (const m of cfg.models || []) {
          if (!(claude && m === "default")) {
            list.append(el("option", { value: m, text: claude ? t("ai_tier_" + m) : m }));
          }
        }
        list.value = (cfg.models || []).includes(cfg.model) ? cfg.model : "";
      };
      list.addEventListener("change", () => {
        if (list.value !== "" || claude) {
          cfg.model = list.value;
          model.value = cfg.model;
          save();
        }
      });
      model.addEventListener("input", () => {
        list.value = (cfg.models || []).includes(cfg.model) ? cfg.model : "";
      });
      let asking = 0;
      const refresh = async () => {
        const me = ++asking;
        status.textContent = t("ai_models_asking");
        try {
          const got = await ai_models(cfg);
          if (me !== asking) {
            return;
          }
          cfg.models = got;
          store_main();
          fill();
          status.textContent = claude ? "" : t("ai_models_n", got.length);
        } catch (e) {
          if (me === asking) {
            status.textContent = t("ai_models_fail", (e && e.message) || String(e));
          }
        }
      };
      let timer = 0;
      const soon = () => {
        clearTimeout(timer);
        timer = setTimeout(refresh, 700);
      };
      url.addEventListener("input", soon);
      key.addEventListener("input", soon);
      const again = el("button", { class: "btn icon-btn", type: "button", text: "↻", "aria-label": t("ai_models_refresh"),
        onclick: refresh });
      fill();
      if ((cfg.models || []).length === 0) {
        refresh();
      }
      const dup = el("button", { class: "btn", type: "button", text: t("duplicate"), onclick: () => {
        const p = { ...cfg, id: proj_id(), name: cfg.name + t("copy_suffix"), models: (cfg.models || []).slice() };
        profiles.splice(profiles.indexOf(cfg) + 1, 0, p);
        state.ai.active = p.id;
        save();
        paint();
      } });
      const del = el("button", { class: "btn danger", type: "button", text: t("delete"), onclick: () => {
        const i = profiles.indexOf(cfg);
        profiles.splice(i, 1);
        state.ai.active = "";
        save();
        paint();
        toast(t("ai_profile_deleted", cfg.name), t("undo"), () => {
          profiles.splice(i, 0, cfg);
          state.ai.active = cfg.id;
          save();
        });
      } });
      box.append(el("div", { class: "ai-rows" },
        el("label", {}, t("ai_profile_name"), name),
        el("label", {}, t("ai_provider"), prov),
        claude ? null : el("label", {}, t("ai_url"), url),
        el("label", {}, t("ai_model"), el("div", { class: "row" }, el("span", { class: "grow" }, list), claude ? null : again),
          claude ? null : model, status),
        claude ? null : el("label", {}, t("ai_key"), key),
        el("div", { class: "row" }, dup, del)),
        el("small", { text: claude ? t("ai_hint_claude") : (viewer ? t("ai_hint_viewer") + " " : "") + t("ai_hint_key") }));
    };
    paint();
    return box;
  }

  // Which workshop and which Bend this page is, each linked to its commit,
  // then the source and the issue tracker: what a bug report needs first.
  const WORKSHOP = { repo: "__WS_REPO__", commit: "__WS_COMMIT__", date: "__WS_DATE__" };
  const GITHUB_ICON = "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" fill=\"currentColor\" aria-hidden=\"true\"><path d=\"M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z\"/></svg>";

  function versions_text() {
    return "Bend 2 pocket workshop " + WORKSHOP.commit + (WORKSHOP.date ? " (" + WORKSHOP.date + ")" : "")
      + "\nBend " + Core.VERSION + " (" + Core.COMMIT + ")";
  }

  function versions_card() {
    const link = (href, ...kids) => el("a", { href, target: "_blank", rel: "noopener" }, ...kids);
    const ws_sha = WORKSHOP.commit.replace(/\+$/, "");
    const ws = /^[0-9a-f]{7}$/.test(ws_sha)
      ? link(WORKSHOP.repo + "/commit/" + ws_sha, el("code", { text: WORKSHOP.commit }))
      : el("code", { text: WORKSHOP.commit });
    const bend = Core.COMMIT
      ? link("https://github.com/bendlang/bend/commit/" + Core.COMMIT, el("code", { text: Core.COMMIT }))
      : null;
    const issue = WORKSHOP.repo + "/issues/new?body=" + encodeURIComponent("\n\n---\n" + versions_text());
    return el("div", { class: "versions" },
      el("div", { class: "ver-row" }, el("span", { class: "ver-k", text: t("ver_workshop") }),
        el("span", {}, WORKSHOP.date ? WORKSHOP.date + " · " : "", ws)),
      el("div", { class: "ver-row" }, el("span", { class: "ver-k", text: "Bend" }),
        el("span", {}, Core.VERSION, bend ? " · " : "", bend)),
      el("div", { class: "row ver-links" },
        el("a", { class: "btn", href: WORKSHOP.repo, target: "_blank", rel: "noopener", html: GITHUB_ICON + " " + esc(t("ver_source")) }),
        el("a", { class: "btn", href: issue, target: "_blank", rel: "noopener", text: t("ver_issue") }),
        el("button", { class: "btn", type: "button", text: t("ver_copy"), onclick: () => copy_text(versions_text()) })));
  }

  function about_sheet() {
    const body = el("div", {}, versions_card());
    body.append($("#about-" + lang).content.cloneNode(true));
    sheet_open(t("about"), body);
  }

  // A change of language redraws what is on screen; what a check or a run
  // wrote stays as it was, and the next one speaks the new language.
  function lang_set(code) {
    lang = code;
    store_main();
    lang_static();
    keys_init();
    screen_pad();
    screen_info();
    files_paint();
    proj_label();
    run_button(run.busy);
    goals_paint();
    sig_update();
    for (const b of $$("#out-targets .chip")) {
      b.textContent = out_label(b.dataset.target);
    }
    js_show();
    for (const b of $$(".try", $("#guide"))) {
      b.textContent = t("try");
    }
    if (base.decls !== null) {
      base_find();
    }
    if (!run.busy) {
      verdict_set("idle", "…");
      diag_show(null);
      live_soon();
    }
  }

  function size_vars() {
    const root = document.documentElement.style;
    root.setProperty("--code-size", state.size + "px");
    root.setProperty("--code-lh", Math.round(state.size * 1.55) + "px");
  }

  function size_apply() {
    size_vars();
    ed_measure();
    ed_paint();
  }

  // Viewport
  // ========
  // On iOS the keyboard covers the page instead of resizing it: follow the
  // visual viewport so the key bar and the verdict stay above the keyboard.

  function viewport_init() {
    const vv = window.visualViewport;
    if (!vv) {
      return;
    }
    const app = $("#app");
    const fit = () => {
      const covered = window.innerHeight - vv.height > 80;
      app.classList.toggle("kbd", covered);
      app.style.height = covered ? vv.height + "px" : "";
      app.style.transform = covered && vv.offsetTop ? "translateY(" + vv.offsetTop + "px)" : "";
      if (covered) {
        requestAnimationFrame(ed_reveal);
      }
    };
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
  }

/*__OPCALL__*/
/*__AGENT__*/
  // Init
  // ====

  store_load();
  hub_load();
  lang_static();
  proj_label();
  ed_init();
  keys_init();
  goals_init();
  sig_init();
  screen_init();
  ai_init();
  panel_init();
  js_init();
  viewport_init();
  $("#btn-proj").addEventListener("click", projects_sheet);
  $("#btn-examples").addEventListener("click", examples_sheet);
  $("#btn-guide").addEventListener("click", () => {
    tab_set("guide");
    if (!WIDE.matches) {
      panel_set("full");
    }
  });
  $("#btn-settings").addEventListener("click", settings_sheet);
  $("#btn-about").addEventListener("click", about_sheet);
  size_vars();
  ed_measure();
  files_paint();
  ed_set(file_now().text);
  panel_set("closed");
  tab_set("out");
  run_button(false);
  verdict_set("busy", t("loading_base"));
  comp_boot().then(() => {
    if (state.live) {
      live_run();
    } else {
      verdict_set("idle", t("check_on_demand"));
    }
  });
  window.addEventListener("resize", () => requestAnimationFrame(ed_reveal));
  const leave = () => {
    store_flush();
    if (!state.scratch) {
      snap_take("snap_leaving");
    }
  };
  window.addEventListener("pagehide", leave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      leave();
    }
  });
  WIDE.addEventListener("change", () => panel_set(panel.state));
})();
