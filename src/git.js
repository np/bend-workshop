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

  // skip: per project, the changed files left out of the next commit
  const gitst = { lib: null, fs: new Map(), timers: new Map(), skip: new Map() };

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
  // files, the ones gone removed), or read back out. With them, the
  // project's settings (.workshop/project.json: its argument sets) and its
  // data files (test/data/…), so that a commit carries them too.
  const GIT_OWN = /\.(bend|js)$/;
  const GIT_META = "/.workshop/project.json";

  function git_tracked(f) {
    return GIT_OWN.test(f) || f.startsWith("test/data/") || f === GIT_META.slice(1);
  }

  function git_put(fs, p, data) {
    fs.mkdirs(p.slice(0, p.lastIndexOf("/")) || "/");
    const old = fs.files.get(p);
    if (!old || old.data.length !== data.length || old.data.some((b, i) => b !== data[i])) {
      fs.files.set(p, { data, mtimeMs: Date.now(), mode: old ? old.mode : 0o100644, link: null, ino: old ? old.ino : fs.files.size + 1 });
    }
  }

  function git_tree_write(fs, list, own = list === state.files) {
    const want = new Map(list.map((f) => [fs.norm(f.name), f.text]));
    const data = new Map(own ? state.data.map((d) => [fs.norm("/" + DATA_DIR + d.name), bytes_of(d.b64)]) : []);
    for (const p of [...fs.files.keys()]) {
      if (!p.startsWith("/.git/") && ((GIT_OWN.test(p) && !want.has(p)) || (own && p.startsWith("/" + DATA_DIR) && !data.has(p)))) {
        fs.files.delete(p);
      }
    }
    for (const [p, text] of want) {
      git_put(fs, p, new TextEncoder().encode(text));
    }
    if (own) {
      for (const [p, bytes] of data) {
        git_put(fs, p, bytes);
      }
      git_put(fs, GIT_META, new TextEncoder().encode(JSON.stringify(proj_settings(), null, 1) + "\n"));
    }
  }

  // What the tree says of the project besides its code: its data files and
  // argument sets (absent: left as they are).
  function git_tree_extra(fs) {
    const data = [];
    for (const [p, f] of fs.files) {
      if (p.startsWith("/" + DATA_DIR) && f.link === null) {
        data.push({ name: p.slice(DATA_DIR.length + 1), b64: b64_of(f.data) });
      }
    }
    let args = null;
    const meta = fs.files.get(GIT_META);
    if (meta) {
      try {
        args = JSON.parse(new TextDecoder().decode(meta.data)).args || null;
      } catch (e) {
        args = null;
      }
    }
    return { data, args };
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
  // A merge with conflicts in progress: the commit merged in, kept in .git
  // (so it is saved, and goes in a zip, with the rest); the commit that
  // ends it takes both parents.
  const MERGE_FILE = "/.git/WORKSHOP_MERGE";

  function git_merging(fs) {
    const f = fs.files.get(MERGE_FILE);
    if (!f) {
      return null;
    }
    const [theirs, label] = new TextDecoder().decode(f.data).split("\n");
    return { theirs, label: label || theirs.slice(0, 7) };
  }

  function git_merging_set(fs, m) {
    if (m) {
      fs.files.set(MERGE_FILE, { data: new TextEncoder().encode(m.theirs + "\n" + m.label + "\n"), mtimeMs: Date.now(),
        mode: 0o100644, link: null, ino: fs.files.size + 1 });
    } else {
      fs.files.delete(MERGE_FILE);
    }
  }

  // The conflicts left in a text: <<<<<<< ours ======= theirs >>>>>>>.
  const CONFLICT = /^<<<<<<< [^\n]*\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>> [^\n]*\n?/gm;

  function git_conflicted(text) {
    return /^<<<<<<< /m.test(text) && /^>>>>>>> /m.test(text);
  }

  function git_resolve(text, side) {
    return text.replace(CONFLICT, (all, ours, theirs) => (side === "ours" ? ours : theirs));
  }

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
    const rows = await git.statusMatrix({ fs, dir, filter: git_tracked });
    const changed = rows.filter(([, h, w, s]) => !(h === 1 && w === 1 && s === 1)).map(([f, h, w]) => ({
      file: f, kind: h === 0 ? "new" : w === 0 ? "gone" : "changed" }));
    const url = await git.getConfig({ fs, dir, path: "remote.origin.url" }).catch(() => null);
    const branches = await git.listBranches({ fs, dir }).catch(() => []);
    const merging = git_merging(fs);
    if (merging) {
      merging.conflicts = state.files.filter((f) => git_conflicted(f.text)).map((f) => f.name);
    }
    return { branch, head, changed, url, branches, merging };
  }

  async function git_init(pid) {
    const { git } = await git_lib();
    const fs = gitfs_new(null);
    await git.init({ fs, dir: "/", defaultBranch: "main" });
    gitst.fs.set(pid, fs);
    git_save(pid);
    return fs;
  }

  // A commit of the changes, but those in skip (file names): these stay
  // as the last commit has them in the index, and changed in the project.
  async function git_commit(pid, message, skip = new Set()) {
    const fs = await git_fs(pid);
    const { git } = await git_lib();
    const dir = "/";
    git_tree_write(fs, state.files);
    const merging = git_merging(fs);
    if (merging) {
      // a merge commits everything
      skip = new Set();
    }
    let taken = 0;
    for (const [file, h, w, i] of await git.statusMatrix({ fs, dir })) {
      if (skip.has(file)) {
        if (h !== i || w !== i) {
          await git.resetIndex({ fs, dir, filepath: file });
        }
      } else if (w === 0) {
        await git.remove({ fs, dir, filepath: file });
        taken += h === 1 ? 1 : 0;
      } else {
        await git.add({ fs, dir, filepath: file });
        taken += h === 1 && w === 1 ? 0 : 1;
      }
    }
    const head0 = await git.resolveRef({ fs, dir, ref: "HEAD" }).catch(() => null);
    if (taken === 0 && head0 !== null && !merging) {
      throw new Error(t("git_nothing_picked"));
    }
    // ending a merge: both parents, once no conflict is left
    if (merging && state.files.some((f) => git_conflicted(f.text))) {
      throw new Error(t("git_still_conflicts"));
    }
    const head = merging ? await git.resolveRef({ fs, dir, ref: "HEAD" }) : null;
    const oid = await git.commit({ fs, dir, message, author: git_author(), ...(merging ? { parent: [head, merging.theirs] } : {}) });
    git_merging_set(fs, null);
    git_save(pid);
    return oid;
  }

  // Every commit of the repository, not only HEAD's past: the logs of HEAD,
  // of each branch and of each of origin's, merged, newest first, each
  // with its marks (where the workspace is, the branches, origin's).
  async function git_history(pid, depth) {
    const fs = await git_fs(pid);
    const { git } = await git_lib();
    const dir = "/";
    const head = await git.resolveRef({ fs, dir, ref: "HEAD" }).catch(() => null);
    const branch = await git.currentBranch({ fs, dir }).catch(() => null);
    const refs = [{ ref: "HEAD", mark: null }];
    for (const b of await git.listBranches({ fs, dir }).catch(() => [])) {
      refs.push({ ref: "refs/heads/" + b, mark: { kind: "branch", name: b } });
    }
    for (const b of await git.listBranches({ fs, dir, remote: "origin" }).catch(() => [])) {
      if (b !== "HEAD") {
        refs.push({ ref: "refs/remotes/origin/" + b, mark: { kind: "remote", name: "origin/" + b } });
      }
    }
    const seen = new Map();
    const marks = new Map();
    const mark = (oid, m) => marks.set(oid, (marks.get(oid) || []).concat([m]));
    for (const r of refs) {
      const oid = await git.resolveRef({ fs, dir, ref: r.ref }).catch(() => null);
      if (oid === null) {
        continue;
      }
      if (r.mark) {
        mark(oid, r.mark);
      }
      for (const c of await git.log({ fs, dir, ref: oid, depth: depth || 100 }).catch(() => [])) {
        seen.set(c.oid, c);
      }
    }
    if (head) {
      mark(head, { kind: "head", name: branch || "" });
    }
    const list = [...seen.values()].sort((a, b) => b.commit.committer.timestamp - a.commit.committer.timestamp
      || b.commit.author.timestamp - a.commit.author.timestamp);
    // what the workspace reaches: older commits of HEAD's line are shown as such
    const mine = new Set((head ? await git.log({ fs, dir, ref: head, depth: depth || 100 }).catch(() => []) : []).map((c) => c.oid));
    return { list: list.slice(0, depth || 100), marks, head, branch, mine };
  }

  // The current branch fetched by its name: an empty remote, or one whose
  // HEAD names a branch not there (a bare repository made on master, then
  // pushed main), has no HEAD to follow. Answers false when origin has no
  // such branch yet.
  async function git_fetch(pid, st) {
    const fs = await git_fs(pid);
    const { git, http } = await git_lib();
    st = st || await git_status(pid);
    try {
      await git.fetch({ fs, http, dir: "/", url: st.url, remote: "origin", ref: st.branch || undefined, singleBranch: !!st.branch,
        tags: false, ...git_net(st.url) });
    } catch (e) {
      const missing = e && (e.code === "NotFoundError" || /Could not find/.test(e.message || ""));
      if (missing) {
        return false;
      }
      throw e;
    }
    git_save(pid);
    return true;
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
  function git_take(files, label, extra) {
    const keep = work_snapshot();
    snap_take("snap_before_git", true);
    const open = state.files[state.active] ? state.files[state.active].name : "";
    state.files = files.length ? files : [{ name: "main.bend", text: "import Base\n" }];
    if (extra) {
      proj_settings_take(extra.args, extra.data);
    }
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
    git_take(git_tree_read(fs), t("git_switched", ref), git_tree_extra(fs));
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
    if (st.merging) {
      throw new Error(t("git_merge_first"));
    }
    if (st.changed.length > 0) {
      throw new Error(t("git_dirty"));
    }
    if (!st.branch) {
      throw new Error(t("git_pull_detached"));
    }
    void http;
    if (!(await git_fetch(pid, st))) {
      toast(t("git_remote_empty", st.branch));
      return;
    }
    const dir = "/";
    const theirs = await git.resolveRef({ fs, dir, ref: "refs/remotes/origin/" + st.branch }).catch(() => null);
    if (theirs === null || theirs === st.head
      || (st.head && await git.isDescendent({ fs, dir, oid: st.head, ancestor: theirs, depth: -1 }).catch(() => false))) {
      toast(t("git_up_to_date"));
      return;
    }
    // ahead of us only: a fast-forward; else a merge, its conflicts
    // written in the files, to be resolved and committed
    const label = "origin/" + st.branch;
    try {
      await git.merge({ fs, dir, ours: st.branch, theirs: "refs/remotes/origin/" + st.branch, abortOnConflict: false, author: git_author(),
        message: "Merge " + label + " into " + st.branch });
    } catch (e) {
      if (e && e.code === "MergeConflictError") {
        git_merging_set(fs, { theirs, label });
        git_save(pid);
        git_take(git_tree_read(fs), t("git_conflicts", e.data.filepaths.join(", ")), git_tree_extra(fs));
        return;
      }
      throw e;
    }
    await git.checkout({ fs, dir, ref: st.branch, force: true });
    git_save(pid);
    git_take(git_tree_read(fs), t("git_pulled"), git_tree_extra(fs));
  }

  // A merge given up: the files as HEAD has them again.
  async function git_merge_abort(pid) {
    const fs = await git_fs(pid);
    const { git } = await git_lib();
    const branch = await git.currentBranch({ fs, dir: "/" }).catch(() => null);
    await git.checkout({ fs, dir: "/", ref: branch || "HEAD", force: true });
    git_merging_set(fs, null);
    git_save(pid);
    git_take(git_tree_read(fs), t("git_merge_aborted"), git_tree_extra(fs));
  }

  // One side of every conflict of a file, kept: in the editor (one Undo
  // step) when the file is open, else straight.
  function git_keep(name, side) {
    const f = state.files.find((x) => x.name === name);
    if (!f) {
      return;
    }
    const next = git_resolve(f.text, side);
    if (f === file_now()) {
      ed_rewrite(next);
    } else {
      f.text = next;
      store_save();
    }
  }

  async function git_push(pid) {
    const fs = await git_fs(pid);
    const { git, http } = await git_lib();
    const st = await git_status(pid);
    if (!st.branch) {
      throw new Error(t("git_pull_detached"));
    }
    let r;
    try {
      r = await git.push({ fs, http, dir: "/", url: st.url, ref: st.branch, remoteRef: st.branch, ...git_net(st.url) });
    } catch (e) {
      // origin moved on: pull (and merge) first
      if (e && (e.code === "PushRejectedError" || /fast-forward|not a simple/i.test(e.message || ""))) {
        throw new Error(t("git_push_behind"));
      }
      throw e;
    }
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
    const extra = git_tree_extra(fs);
    proj_settings_take(extra.args, extra.data);
    store_flush();
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
    const box = el("div", { class: "form git" });
    const close = sheet_open(t("git_title"), box);
    let gen = 0;
    const busy = (b, label) => {
      for (const x of box.querySelectorAll("button")) {
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
    // built aside, then put in place: of two paints at once (a change of
    // the URL while another runs) only the latest shows
    const paint = async () => {
      const my = ++gen;
      const body = document.createDocumentFragment();
      try {
        await paint_into(body);
      } finally {
        if (my === gen) {
          box.replaceChildren(body);
        }
      }
    };
    const paint_into = async (body) => {
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
      // a merge under way: its conflicts, a side kept per file, Abort
      if (st.merging) {
        body.append(el("div", { class: "git-merging" },
          el("b", { text: t("git_merging", st.merging.label) }), " ",
          el("small", { text: st.merging.conflicts.length ? t("git_merging_hint", st.merging.conflicts.length) : t("git_merging_done") }),
          ...st.merging.conflicts.map((name) => el("div", { class: "row git-conflict" },
            el("span", { class: "grow", text: name }),
            el("button", { class: "chip", type: "button", text: t("git_keep_mine"), onclick: () => { git_keep(name, "ours"); paint(); } }),
            el("button", { class: "chip", type: "button", text: t("git_keep_theirs"), onclick: () => { git_keep(name, "theirs"); paint(); } }),
            el("button", { class: "chip", type: "button", text: t("git_open"), onclick: () => {
              const i = state.files.findIndex((f) => f.name === name);
              close();
              files_pick(i);
              const at = state.files[i].text.indexOf("<<<<<<< ");
              if (at >= 0) {
                const head = state.files[i].text.slice(0, at);
                ed_goto(head.split("\n").length, 1);
              }
            } }))),
          el("div", { class: "row" }, el("button", { class: "btn danger", type: "button", text: t("git_merge_abort"),
            onclick: () => run(async () => { await git_merge_abort(pid); }, t("git_working")) }))));
      }
      // where it stands
      body.append(el("p", { class: "git-head" }, el("b", { text: st.branch || t("git_detached") }),
        " · " + (st.head ? st.head.slice(0, 7) : t("git_no_commit")) + (st.url ? " · " + st.url : "")));
      // changes and a commit
      // the message: a summary line, then as many lines as it takes
      const msg = el("textarea", { class: "git-msg", rows: "3", placeholder: t("git_msg_ph"), "aria-label": t("git_msg_ph"),
        spellcheck: "true" });
      msg.value = gitst.draft && gitst.draft.pid === pid ? gitst.draft.text
        : st.merging ? "Merge " + st.merging.label + " into " + (st.branch || "HEAD") : "";
      msg.addEventListener("input", () => {
        gitst.draft = { pid, text: msg.value };
      });
      // which changes go in: all, unless unticked (kept across repaints)
      const skip = gitst.skip.get(pid) || new Set();
      gitst.skip.set(pid, skip);
      for (const f of [...skip]) {
        if (!st.changed.some((c) => c.file === f)) {
          skip.delete(f);
        }
      }
      const picked = () => st.changed.filter((c) => !skip.has(c.file)).length;
      // each change opens its diff against the last commit, before committing
      const review = async (only) => {
        const head = st.head ? await git_files_at(pid, st.head) : [];
        const want = (n) => st.changed.some((c) => c.file === n) && (!only || n === only);
        diff_sheet(only ? t("git_diff_file", only) : t("git_diff_all"), head.filter(([n]) => want(n)),
          state.files.filter((f) => want(f.name)).map((f) => [f.name, f.text]));
      };
      const count = el("span", {});
      const commit = el("button", { class: "btn primary", type: "button", text: t("git_commit") });
      const sync = () => {
        const n = picked();
        count.textContent = st.changed.length > 0 && n < st.changed.length && !st.merging
          ? t("git_changes_picked", n, st.changed.length) : t("git_changes", st.changed.length);
        commit.disabled = (st.changed.length === 0 || n === 0) && st.head !== null && !st.merging;
      };
      const go = () => {
        // trailing spaces off each line, blank lines off both ends
        const m = msg.value.split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").replace(/^\n+|\n+$/g, "");
        if (m === "") {
          msg.focus();
          note.textContent = t("git_msg_needed");
          return;
        }
        run(async () => {
          await git_commit(pid, m + "\n", st.merging ? new Set() : new Set(skip));
          gitst.draft = null;
          toast(t("git_committed"));
        }, t("git_working"));
      };
      commit.addEventListener("click", () => {
        if (!commit.disabled) {
          go();
        }
      });
      msg.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          commit.click();
        }
      });
      const rows = st.changed.map((c) => {
        const box = el("input", { type: "checkbox", "aria-label": t("git_pick_file", c.file), disabled: !!st.merging });
        box.checked = !skip.has(c.file);
        box.addEventListener("change", () => {
          if (box.checked) {
            skip.delete(c.file);
          } else {
            skip.add(c.file);
          }
          sync();
        });
        return el("div", { class: "git-change" }, box, el("button", { class: "chip git-" + c.kind,
          type: "button", title: t("git_diff_file", c.file), text: (c.kind === "new" ? "+ " : c.kind === "gone" ? "− " : "~ ") + c.file,
          onclick: () => review(c.file) }));
      });
      const all = st.changed.length > 1 && !st.merging ? el("button", { class: "chip", type: "button", text: t("git_pick_all"), onclick: () => {
        const none = picked() > 0;
        for (const c of st.changed) {
          if (none) {
            skip.add(c.file);
          } else {
            skip.delete(c.file);
          }
        }
        rows.forEach((r) => {
          r.firstChild.checked = !none;
        });
        all.textContent = none ? t("git_pick_all") : t("git_pick_none");
        sync();
      } }) : null;
      if (all) {
        all.textContent = picked() > 0 ? t("git_pick_none") : t("git_pick_all");
      }
      sync();
      body.append(el("div", { class: "field" }, count,
        st.changed.length ? el("div", { class: "git-changes" }, ...rows,
          el("div", { class: "row" }, all, st.changed.length > 1 ? el("button", { class: "chip", type: "button", text: t("git_review"),
            onclick: () => review(null) }) : null)) : null,
        msg, el("small", { class: "dim", text: t("git_msg_hint") }),
        el("div", { class: "row" }, commit)));
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
          el("button", { class: "btn", type: "button", text: t("git_fetch"), disabled: !st.url,
            onclick: () => run(async () => {
              await git_fetch(pid);
              toast(t("git_fetched"));
            }, t("git_talking")) }),
          el("button", { class: "btn", type: "button", text: t("git_pull"), disabled: !st.url,
            onclick: () => run(async () => { await git_pull(pid); }, t("git_talking")) }),
          el("button", { class: "btn", type: "button", text: t("git_push"), disabled: !st.url || !st.head,
            onclick: () => run(async () => {
              await git_push(pid);
              toast(t("git_pushed"));
            }, t("git_talking")) })),
        el("small", { text: (git_conf().proxy ? t("git_via_proxy", git_conf().proxy) : t("git_no_proxy")) })));
      body.append(note);
      // the history: every commit of every branch, newest first, marked
      // where the workspace is (HEAD), where each branch and origin's are
      const hist = await git_history(pid, 100);
      const log = hist.list;
      const list = el("div", { class: "git-log" });
      for (const c of log) {
        const parent = c.commit.parent[0] || null;
        const marks = hist.marks.get(c.oid) || [];
        const here = marks.some((m) => m.kind === "head");
        const own = marks.find((m) => m.kind === "branch");
        const badges = marks.filter((m) => m.kind !== "head" || !m.name).map((m) => el("span", {
          class: "git-mark " + m.kind + (m.kind === "branch" && here && m.name === hist.branch ? " head" : ""),
          title: t("git_mark_" + m.kind), text: m.kind === "head" ? t("git_detached_here")
            : (m.kind === "branch" && here && m.name === hist.branch ? "● " : "") + m.name }));
        list.append(el("div", { class: "git-commit" + (here ? " here" : "") + (hist.mine.has(c.oid) ? "" : " other") },
          el("span", { class: "git-oid", text: c.oid.slice(0, 7) }),
          el("span", { class: "git-what" }, ...badges, el("b", { text: c.commit.message.split("\n")[0] }),
            el("small", { text: " " + c.commit.author.name + ", " + when(c.commit.author.timestamp * 1000) }),
            // the message's body, folded
            c.commit.message.trim().includes("\n") ? el("details", { class: "git-body" }, el("summary", { text: t("git_msg_more") }),
              el("pre", { text: c.commit.message.trim().split("\n").slice(1).join("\n").replace(/^\n+/, "") })) : ""),
          el("span", { class: "snap-acts" },
            el("button", { class: "chip", type: "button", text: t("snap_diff"), onclick: async () => {
              const a = await git_files_at(pid, parent);
              const b = await git_files_at(pid, c.oid);
              close();
              diff_sheet(t("git_diff_title", c.oid.slice(0, 7)), a, b);
            } }),
            here ? "" : el("button", { class: "chip", type: "button", text: own ? t("git_checkout_branch", own.name) : t("git_checkout"),
              // a branch's tip checks the branch out (HEAD stays attached)
              onclick: () => run(async () => { await git_checkout(pid, own ? own.name : c.oid); }, t("git_working")) }))));
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
