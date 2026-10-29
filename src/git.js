  // Git
  // ===
  // Each project can be a git repository, kept in this browser: its working
  // tree is the project's files (the .bend and .js ones; other files of a
  // clone stay in the tree untouched), its .git lives beside them in a file
  // system of the page's own (gitfs), saved in IndexedDB (store "git", by
  // project id). isomorphic-git does the git (dist/bend-git.js, carried in
  // the page compressed and unpacked the first time git is used). Remotes
  // (clone, pull, push) go straight to the host when it allows a page to
  // (Gitea, Gogs, Azure DevOps), else through the CORS proxy set in
  // Settings, the user's own: GitHub, GitLab and Bitbucket allow no page.

  // A file system in memory, as isomorphic-git asks for it (fs.promises),
  // its whole content dumped and restored for IndexedDB.
  function gitfs_new(dump) {
    const files = new Map();
    const dirs = new Set(["/"]);
    let ino = 1;
    if (dump && Array.isArray(dump.files)) {
      for (const d of dump.dirs || []) {
        dirs.add(d);
      }
      for (const [p, data, mtimeMs, mode, link] of dump.files) {
        files.set(p, { data: data instanceof Uint8Array ? data : new Uint8Array(data || []), mtimeMs: mtimeMs || Date.now(),
          mode: mode || 0o100644, link: link || null, ino: ino++ });
      }
    }
    const norm = (p) => {
      const out = [];
      for (const x of String(p).split("/")) {
        if (x === "..") {
          out.pop();
        } else if (x !== "" && x !== ".") {
          out.push(x);
        }
      }
      return "/" + out.join("/");
    };
    const parent = (p) => p.slice(0, p.lastIndexOf("/")) || "/";
    const fail = (code, p) => Object.assign(new Error(code + ": " + p), { code });
    const stat_of = (p) => {
      const f = files.get(p);
      const now = Date.now();
      if (f) {
        const type = f.link !== null ? "symlink" : "file";
        return { type, mode: f.mode, size: f.data.length, ino: f.ino, mtimeMs: f.mtimeMs, ctimeMs: f.mtimeMs, uid: 1, gid: 1, dev: 1,
          isFile: () => type === "file", isDirectory: () => false, isSymbolicLink: () => type === "symlink" };
      }
      if (dirs.has(p)) {
        return { type: "dir", mode: 0o40000, size: 0, ino: 0, mtimeMs: now, ctimeMs: now, uid: 1, gid: 1, dev: 1,
          isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false };
      }
      throw fail("ENOENT", p);
    };
    const promises = {
      async readFile(p, opts) {
        const f = files.get(norm(p));
        if (!f) {
          throw fail(dirs.has(norm(p)) ? "EISDIR" : "ENOENT", p);
        }
        const enc = typeof opts === "string" ? opts : opts && opts.encoding;
        return enc === "utf8" || enc === "utf-8" ? new TextDecoder().decode(f.data) : f.data.slice();
      },
      async writeFile(p, data, opts) {
        const q = norm(p);
        if (!dirs.has(parent(q))) {
          throw fail("ENOENT", p);
        }
        if (dirs.has(q)) {
          throw fail("EISDIR", p);
        }
        const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
        const old = files.get(q);
        files.set(q, { data: bytes, mtimeMs: Date.now(), mode: (opts && opts.mode) || (old ? old.mode : 0o100644), link: null,
          ino: old ? old.ino : ino++ });
      },
      async unlink(p) {
        if (!files.delete(norm(p))) {
          throw fail("ENOENT", p);
        }
      },
      async readdir(p) {
        const q = norm(p);
        if (!dirs.has(q)) {
          throw fail(files.has(q) ? "ENOTDIR" : "ENOENT", p);
        }
        const pre = q === "/" ? "/" : q + "/";
        const out = new Set();
        for (const k of [...files.keys(), ...dirs]) {
          if (k !== q && k.startsWith(pre)) {
            out.add(k.slice(pre.length).split("/")[0]);
          }
        }
        return [...out];
      },
      async mkdir(p) {
        const q = norm(p);
        if (dirs.has(q) || files.has(q)) {
          throw fail("EEXIST", p);
        }
        if (!dirs.has(parent(q))) {
          throw fail("ENOENT", p);
        }
        dirs.add(q);
      },
      async rmdir(p) {
        const q = norm(p);
        if (!dirs.has(q)) {
          throw fail("ENOENT", p);
        }
        if ((await promises.readdir(q)).length > 0) {
          throw fail("ENOTEMPTY", p);
        }
        dirs.delete(q);
      },
      async stat(p) {
        return stat_of(norm(p));
      },
      async lstat(p) {
        return stat_of(norm(p));
      },
      async readlink(p) {
        const f = files.get(norm(p));
        if (!f || f.link === null) {
          throw fail("ENOENT", p);
        }
        return f.link;
      },
      async symlink(target, p) {
        const q = norm(p);
        if (!dirs.has(parent(q))) {
          throw fail("ENOENT", p);
        }
        files.set(q, { data: new TextEncoder().encode(target), mtimeMs: Date.now(), mode: 0o120000, link: target, ino: ino++ });
      },
      async chmod(p, mode) {
        const f = files.get(norm(p));
        if (f) {
          f.mode = mode;
        }
      },
    };
    // mkdir -p, for the working tree
    const mkdirs = (p) => {
      const q = norm(p);
      if (!dirs.has(q)) {
        mkdirs(parent(q));
        dirs.add(q);
      }
    };
    const dump_now = () => ({ dirs: [...dirs], files: [...files].map(([p, f]) => [p, f.data, f.mtimeMs, f.mode, f.link]) });
    // the files under a folder, by path relative to it (the .git ones for an export)
    const under = (dir) => {
      const pre = norm(dir) + "/";
      return [...files].filter(([p]) => p.startsWith(pre)).map(([p, f]) => [p.slice(pre.length), f.data]);
    };
    return { promises, mkdirs, dump: dump_now, under, files, dirs, norm };
  }

  const gitst = { lib: null, fs: new Map(), timers: new Map() };

  // The library, unpacked and run the first time it is needed.
  async function git_lib() {
    if (gitst.lib !== null) {
      return gitst.lib;
    }
    if (typeof window.BendGit === "undefined") {
      const raw = Uint8Array.from(atob($("#bend-git-z").textContent.trim()), (c) => c.charCodeAt(0));
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      const src = await new Response(stream).text();
      const s = document.createElement("script");
      s.textContent = src;
      document.head.append(s);
      s.remove();
    }
    if (typeof window.BendGit === "undefined") {
      throw new Error(t("git_no_lib"));
    }
    gitst.lib = window.BendGit;
    return gitst.lib;
  }

  // A project's repository: its file system, from IndexedDB the first time,
  // or null when the project has none.
  async function git_fs(pid) {
    if (gitst.fs.has(pid)) {
      return gitst.fs.get(pid);
    }
    const rec = await ses_req("readonly", (st) => st.get(pid), "git");
    const fs = rec && rec.fs ? gitfs_new(rec.fs) : null;
    gitst.fs.set(pid, fs);
    return fs;
  }

  function git_save(pid) {
    clearTimeout(gitst.timers.get(pid));
    gitst.timers.set(pid, setTimeout(() => git_flush(pid), 200));
  }

  async function git_flush(pid) {
    clearTimeout(gitst.timers.get(pid));
    gitst.timers.delete(pid);
    const fs = gitst.fs.get(pid);
    if (fs) {
      await ses_req("readwrite", (st) => st.put({ id: pid, fs: fs.dump() }), "git");
    } else if (fs === null) {
      await ses_req("readwrite", (st) => st.delete(pid), "git");
    }
  }

  addEventListener("pagehide", () => {
    for (const pid of [...gitst.timers.keys()]) {
      git_flush(pid);
    }
  });

  // The project's own files in the tree: written in (the .bend and .js
  // files, the ones gone removed), or read back out.
  const GIT_OWN = /\.(bend|js)$/;

  function git_tree_write(fs, list) {
    const want = new Map(list.map((f) => [fs.norm(f.name), f.text]));
    for (const p of [...fs.files.keys()]) {
      if (!p.startsWith("/.git/") && GIT_OWN.test(p) && !want.has(p)) {
        fs.files.delete(p);
      }
    }
    for (const [p, text] of want) {
      fs.mkdirs(p.slice(0, p.lastIndexOf("/")) || "/");
      const old = fs.files.get(p);
      const data = new TextEncoder().encode(text);
      if (!old || old.data.length !== data.length || old.data.some((b, i) => b !== data[i])) {
        fs.files.set(p, { data, mtimeMs: Date.now(), mode: old ? old.mode : 0o100644, link: null, ino: old ? old.ino : fs.files.size + 1 });
      }
    }
  }

  function git_tree_read(fs) {
    const out = [];
    for (const [p, f] of fs.files) {
      if (!p.startsWith("/.git/") && GIT_OWN.test(p) && f.link === null) {
        out.push({ name: p.slice(1), text: new TextDecoder().decode(f.data) });
      }
    }
    out.sort((x, y) => Number(y.name === "main.bend") - Number(x.name === "main.bend") || x.name.localeCompare(y.name));
    return out;
  }

  // Settings: who commits, the CORS proxy, credentials by host.
  function git_conf() {
    state.git = state.git || {};
    return state.git;
  }

  function git_author() {
    const c = git_conf();
    return { name: (c.name || "").trim() || "Bend workshop", email: (c.email || "").trim() || "workshop@localhost" };
  }

  function git_host(url) {
    try {
      return new URL(url).host;
    } catch (e) {
      return "";
    }
  }

  // What a remote operation needs: the proxy, unless empty, and the
  // credentials kept for the remote's host.
  function git_net(url) {
    const c = git_conf();
    const auth = (c.auth || {})[git_host(url)];
    const out = { corsProxy: (c.proxy || "").trim() || undefined };
    if (auth && (auth.user || auth.token)) {
      out.onAuth = () => ({ username: auth.user || "git", password: auth.token || "" });
    }
    out.onAuthFailure = () => ({ cancel: true });
    return out;
  }

  // The state of the repository: branch, remote, changes against HEAD.
  async function git_status(pid) {
    const fs = await git_fs(pid);
    if (fs === null) {
      return null;
    }
    const { git } = await git_lib();
    git_tree_write(fs, state.files);
    const dir = "/";
    const branch = await git.currentBranch({ fs, dir }).catch(() => null);
    const head = await git.resolveRef({ fs, dir, ref: "HEAD" }).catch(() => null);
    const rows = await git.statusMatrix({ fs, dir, filter: (f) => GIT_OWN.test(f) });
    const changed = rows.filter(([, h, w, s]) => !(h === 1 && w === 1 && s === 1)).map(([f, h, w]) => ({
      file: f, kind: h === 0 ? "new" : w === 0 ? "gone" : "changed" }));
    const url = await git.getConfig({ fs, dir, path: "remote.origin.url" }).catch(() => null);
    const branches = await git.listBranches({ fs, dir }).catch(() => []);
    return { branch, head, changed, url, branches };
  }

  async function git_init(pid) {
    const { git } = await git_lib();
    const fs = gitfs_new(null);
    await git.init({ fs, dir: "/", defaultBranch: "main" });
    gitst.fs.set(pid, fs);
    git_save(pid);
    return fs;
  }

  async function git_commit(pid, message) {
    const fs = await git_fs(pid);
    const { git } = await git_lib();
    const dir = "/";
    git_tree_write(fs, state.files);
    for (const [file, , w] of await git.statusMatrix({ fs, dir })) {
      if (w === 0) {
        await git.remove({ fs, dir, filepath: file });
      } else {
        await git.add({ fs, dir, filepath: file });
      }
    }
    const oid = await git.commit({ fs, dir, message, author: git_author() });
    git_save(pid);
    return oid;
  }

  async function git_log(pid, depth) {
    const fs = await git_fs(pid);
    const { git } = await git_lib();
    return git.log({ fs, dir: "/", depth: depth || 50 }).catch(() => []);
  }

  // The project's files as a commit has them.
  async function git_files_at(pid, oid) {
    const fs = await git_fs(pid);
    const { git } = await git_lib();
    const out = [];
    if (!oid) {
      return out;
    }
    const files = await git.listFiles({ fs, dir: "/", ref: oid });
    for (const f of files.filter((x) => GIT_OWN.test(x))) {
      const { blob } = await git.readBlob({ fs, dir: "/", oid, filepath: f });
      out.push([f, new TextDecoder().decode(blob)]);
    }
    return out;
  }

  // The working tree after a checkout, a pull or a clone, into the project:
  // a snapshot before, and Undo.
  function git_take(files, label) {
    const keep = work_snapshot();
    snap_take("snap_before_git", true);
    const open = state.files[state.active] ? state.files[state.active].name : "";
    state.files = files.length ? files : [{ name: "main.bend", text: "import Base\n" }];
    state.active = Math.max(0, state.files.findIndex((f) => f.name === open));
    proj_touch();
    store_flush();
    work_show();
    toast(label, t("undo"), () => {
      work_restore(keep);
      store_flush();
    });
  }

  async function git_checkout(pid, ref) {
    const fs = await git_fs(pid);
    const { git } = await git_lib();
    git_tree_write(fs, state.files);
    await git.checkout({ fs, dir: "/", ref, force: true });
    git_save(pid);
    git_take(git_tree_read(fs), t("git_switched", ref));
  }

  async function git_branch(pid, name) {
    const fs = await git_fs(pid);
    const { git } = await git_lib();
    await git.branch({ fs, dir: "/", ref: name, checkout: true });
    git_save(pid);
  }

  async function git_remote_set(pid, url) {
    const fs = await git_fs(pid);
    const { git } = await git_lib();
    await git.setConfig({ fs, dir: "/", path: "remote.origin.url", value: url || undefined });
    if (url) {
      await git.setConfig({ fs, dir: "/", path: "remote.origin.fetch", value: "+refs/heads/*:refs/remotes/origin/*" });
    }
    git_save(pid);
  }

  async function git_pull(pid) {
    const fs = await git_fs(pid);
    const { git, http } = await git_lib();
    const st = await git_status(pid);
    if (st.changed.length > 0) {
      throw new Error(t("git_dirty"));
    }
    await git.pull({ fs, http, dir: "/", url: st.url, ref: st.branch, singleBranch: true, fastForward: true,
      author: git_author(), ...git_net(st.url) });
    git_save(pid);
    git_take(git_tree_read(fs), t("git_pulled"));
  }

  async function git_push(pid) {
    const fs = await git_fs(pid);
    const { git, http } = await git_lib();
    const st = await git_status(pid);
    const r = await git.push({ fs, http, dir: "/", url: st.url, ref: st.branch, remoteRef: st.branch, ...git_net(st.url) });
    git_save(pid);
    if (r && r.ok === false) {
      throw new Error(r.error || "push refused");
    }
    return r;
  }

  // A clone becomes a project of its own.
  async function git_clone(url, ref) {
    const { git, http } = await git_lib();
    const fs = gitfs_new(null);
    await git.clone({ fs, http, dir: "/", url, ref: ref || undefined, singleBranch: true, depth: 50, ...git_net(url) });
    const files = git_tree_read(fs);
    const name = decodeURIComponent(url.replace(/\/+$/, "").split("/").pop() || "repo").replace(/\.git$/, "");
    proj_new(name, files.length ? files : [{ name: "main.bend", text: "import Base\n" }], false, t("git_cloned", name));
    gitst.fs.set(state.id, fs);
    await git_flush(state.id);
  }

  // The .git folder, as files for a zip, and back from one.
  async function git_zip_files(pid) {
    const fs = await git_fs(pid);
    return fs === null ? [] : fs.under("/.git").map(([p, data]) => ({ name: ".git/" + p, data }));
  }

  function git_from_zip(pid, entries, files) {
    const fs = gitfs_new(null);
    for (const e of entries) {
      const p = fs.norm("/.git/" + e.name.replace(/^(.*\/)?\.git\//, ""));
      fs.mkdirs(p.slice(0, p.lastIndexOf("/")));
      fs.files.set(p, { data: e.data, mtimeMs: Date.now(), mode: 0o100644, link: null, ino: fs.files.size + 1 });
    }
    git_tree_write(fs, files);
    gitst.fs.set(pid, fs);
    git_save(pid);
  }

  // The sheet
  // ---------

  async function git_sheet() {
    if (agent_guard()) {
      return;
    }
    const pid = state.id;
    const body = el("div", { class: "form git" });
    const close = sheet_open(t("git_title"), body);
    const busy = (b, label) => {
      for (const x of body.querySelectorAll("button")) {
        x.disabled = b;
      }
      if (label) {
        note.textContent = label;
      }
    };
    const note = el("p", { class: "git-note", role: "status" });
    const run = async (fn, label) => {
      busy(true, label);
      try {
        await fn();
        note.textContent = "";
        await paint();
      } catch (e) {
        busy(false);
        note.textContent = t("git_failed", (e && (e.data && e.data.statusCode ? "HTTP " + e.data.statusCode + " " : "") + e.message) || String(e));
      }
    };
    const paint = async () => {
      body.textContent = "";
      let st;
      try {
        st = await git_status(pid);
      } catch (e) {
        body.append(el("p", { class: "empty", text: t("git_failed", e.message || String(e)) }));
        return;
      }
      if (st === null) {
        body.append(el("p", { text: t("git_none") }),
          el("div", { class: "row" }, el("button", { class: "btn primary", type: "button", text: t("git_init"),
            onclick: () => run(async () => { await git_init(pid); }, t("git_working")) })),
          git_clone_form(close), note);
        return;
      }
      // where it stands
      body.append(el("p", { class: "git-head" }, el("b", { text: st.branch || t("git_detached") }),
        " · " + (st.head ? st.head.slice(0, 7) : t("git_no_commit")) + (st.url ? " · " + st.url : "")));
      // changes and a commit
      const msg = el("input", { type: "text", placeholder: t("git_msg_ph"), "aria-label": t("git_msg_ph") });
      body.append(el("div", { class: "field" }, el("span", { text: t("git_changes", st.changed.length) }),
        st.changed.length ? el("div", { class: "git-changes" }, ...st.changed.map((c) => el("span", { class: "chip git-" + c.kind,
          text: (c.kind === "new" ? "+ " : c.kind === "gone" ? "− " : "~ ") + c.file }))) : null,
        el("div", { class: "row" }, msg, el("button", { class: "btn primary", type: "button", text: t("git_commit"),
          disabled: st.changed.length === 0 && st.head !== null, onclick: () => {
            const m = msg.value.trim();
            if (m === "") {
              msg.focus();
              note.textContent = t("git_msg_needed");
              return;
            }
            run(async () => {
              await git_commit(pid, m);
              toast(t("git_committed"));
            }, t("git_working"));
          } }))));
      // branches
      const name = el("input", { type: "text", placeholder: t("git_branch_ph"), "aria-label": t("git_branch_ph"), autocapitalize: "off" });
      body.append(el("div", { class: "field" }, el("span", { text: t("git_branches") }),
        el("div", { class: "row git-branches" }, ...st.branches.map((b) => el("button", { class: "chip" + (b === st.branch ? " on" : ""),
          type: "button", text: b, "aria-pressed": String(b === st.branch), onclick: () => {
            if (b !== st.branch) {
              run(async () => { await git_checkout(pid, b); }, t("git_working"));
            }
          } }))),
        el("div", { class: "row" }, name, el("button", { class: "btn", type: "button", text: t("git_branch_new"), onclick: () => {
          const n = name.value.trim();
          if (n) {
            run(async () => { await git_branch(pid, n); }, t("git_working"));
          }
        } }))));
      // the remote
      const url = el("input", { type: "url", value: st.url || "", placeholder: "https://…/repo.git", "aria-label": t("git_remote"),
        autocapitalize: "off", spellcheck: "false" });
      url.addEventListener("change", () => run(async () => { await git_remote_set(pid, url.value.trim()); }));
      body.append(el("div", { class: "field" }, el("span", { text: t("git_remote") }), url,
        el("div", { class: "row" },
          el("button", { class: "btn", type: "button", text: t("git_pull"), disabled: !st.url,
            onclick: () => run(async () => { await git_pull(pid); }, t("git_talking")) }),
          el("button", { class: "btn", type: "button", text: t("git_push"), disabled: !st.url || !st.head,
            onclick: () => run(async () => {
              await git_push(pid);
              toast(t("git_pushed"));
            }, t("git_talking")) })),
        el("small", { text: (git_conf().proxy ? t("git_via_proxy", git_conf().proxy) : t("git_no_proxy")) })));
      body.append(note);
      // the log
      const log = await git_log(pid, 50);
      const list = el("div", { class: "git-log" });
      for (const c of log) {
        const parent = c.commit.parent[0] || null;
        list.append(el("div", { class: "git-commit" },
          el("span", { class: "git-oid", text: c.oid.slice(0, 7) }),
          el("span", { class: "git-what" }, el("b", { text: c.commit.message.split("\n")[0] }),
            el("small", { text: " " + c.commit.author.name + ", " + when(c.commit.author.timestamp * 1000) })),
          el("span", { class: "snap-acts" },
            el("button", { class: "chip", type: "button", text: t("snap_diff"), onclick: async () => {
              const a = await git_files_at(pid, parent);
              const b = await git_files_at(pid, c.oid);
              close();
              diff_sheet(t("git_diff_title", c.oid.slice(0, 7)), a, b);
            } }),
            el("button", { class: "chip", type: "button", text: t("git_checkout"),
              onclick: () => run(async () => { await git_checkout(pid, c.oid); }, t("git_working")) }))));
      }
      body.append(el("details", { class: "hist", open: true }, el("summary", { text: t("git_log", log.length) }),
        log.length ? list : el("small", { text: t("git_log_empty") })));
    };
    await paint();
  }

  function git_clone_form(close) {
    const url = el("input", { type: "url", placeholder: "https://…/repo.git", "aria-label": t("git_clone_url"), autocapitalize: "off",
      spellcheck: "false" });
    const ref = el("input", { type: "text", placeholder: t("git_clone_ref"), "aria-label": t("git_clone_ref"), autocapitalize: "off" });
    const note = el("small", { text: git_conf().proxy ? t("git_via_proxy", git_conf().proxy) : t("git_no_proxy") });
    const go = el("button", { class: "btn", type: "button", text: t("git_clone"), onclick: async () => {
      const u = url.value.trim();
      if (!u) {
        url.focus();
        return;
      }
      go.disabled = true;
      note.textContent = t("git_talking");
      try {
        await git_clone(u, ref.value.trim());
        close();
      } catch (e) {
        go.disabled = false;
        note.textContent = t("git_failed", (e && e.message) || String(e));
      }
    } });
    return el("div", { class: "field" }, el("span", { text: t("git_clone_title") }), url, ref, el("div", { class: "row" }, go), note);
  }

  // Settings: identity, proxy, credentials for the host of a URL.
  function git_settings() {
    const c = git_conf();
    const field = (key, label, type, ph) => {
      const i = el("input", { type: type || "text", value: c[key] || "", placeholder: ph || "", autocapitalize: "off",
        autocomplete: "off", spellcheck: "false", "aria-label": label });
      i.addEventListener("input", () => {
        c[key] = i.value.trim() || undefined;
        store_main();
      });
      return el("label", {}, label, i);
    };
    const host = el("input", { type: "text", placeholder: "github.com", "aria-label": t("git_host"), autocapitalize: "off", spellcheck: "false" });
    const user = el("input", { type: "text", "aria-label": t("git_user"), autocapitalize: "off", autocomplete: "off", spellcheck: "false" });
    const token = el("input", { type: "password", "aria-label": t("git_token"), autocomplete: "off" });
    const known = el("small", {});
    const show = () => {
      const a = (c.auth || {})[host.value.trim()] || {};
      user.value = a.user || "";
      token.value = a.token || "";
      const hosts = Object.keys(c.auth || {});
      known.textContent = hosts.length ? t("git_hosts", hosts.join(", ")) : "";
    };
    const keep = () => {
      const h = host.value.trim();
      if (!h) {
        return;
      }
      c.auth = Object.assign({}, c.auth);
      if (user.value.trim() || token.value) {
        c.auth[h] = { user: user.value.trim(), token: token.value };
      } else {
        delete c.auth[h];
      }
      store_main();
      show();
    };
    host.addEventListener("input", show);
    user.addEventListener("change", keep);
    token.addEventListener("change", keep);
    show();
    return el("details", { class: "ai-instr git-settings" }, el("summary", { text: t("git_settings") }),
      el("div", { class: "git-rows" },
        field("name", t("git_name")), field("email", t("git_email"), "email"),
        field("proxy", t("git_proxy"), "url", "https://cors.example.org"),
        el("small", { text: t("git_proxy_hint") }),
        el("label", {}, t("git_host"), host), el("label", {}, t("git_user"), user), el("label", {}, t("git_token"), token),
        el("small", { text: t("git_token_hint") }), known));
  }
