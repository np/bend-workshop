// The page's file system for git (gitfs_new in src/git.js) under
// isomorphic-git: init, a tree written from the project, status, commit,
// log, a branch, checkout, the files of a commit, dump and restore.
import fs from "node:fs";
import * as git from "isomorphic-git";
const src = fs.readFileSync("src/git.js", "utf8");
const grab = (name) => { const a = src.indexOf("  function " + name + "("); if (a < 0) throw new Error(name); return src.slice(a, src.indexOf("\n  }\n", a) + 4); };
const api = new Function(grab("gitfs_new") + "\nconst GIT_OWN = /\\.(bend|js)$/;\n" + grab("git_tree_write") + grab("git_tree_read")
  + "\nreturn { gitfs_new, git_tree_write, git_tree_read };")();
let bad = 0;
const check = (label, ok, ...more) => { console.log((ok ? "ok   " : "FAIL ") + label, ...more); if (!ok) bad += 1; };
const author = { name: "T", email: "t@x" };
const dir = "/";
let mem = api.gitfs_new(null);
await git.init({ fs: mem, dir, defaultBranch: "main" });
api.git_tree_write(mem, [{ name: "main.bend", text: "import Base\n" }, { name: "lib/a.bend", text: "# a\n" }]);
let rows = await git.statusMatrix({ fs: mem, dir });
check("status sees new files", rows.length === 2 && rows.every(([, h, w]) => h === 0 && w === 2), JSON.stringify(rows));
for (const [f] of rows) await git.add({ fs: mem, dir, filepath: f });
const c1 = await git.commit({ fs: mem, dir, message: "first", author });
api.git_tree_write(mem, [{ name: "main.bend", text: "import Base\n# two\n" }]);
rows = await git.statusMatrix({ fs: mem, dir });
check("status: changed and gone", JSON.stringify(rows) === JSON.stringify([["lib/a.bend", 1, 0, 1], ["main.bend", 1, 2, 1]]), JSON.stringify(rows));
for (const [f, , w] of rows) { if (w === 0) await git.remove({ fs: mem, dir, filepath: f }); else await git.add({ fs: mem, dir, filepath: f }); }
const c2 = await git.commit({ fs: mem, dir, message: "second", author });
const log = await git.log({ fs: mem, dir });
check("log", log.map((c) => c.commit.message.trim()).join(",") === "second,first");
await git.branch({ fs: mem, dir, ref: "side", checkout: true });
check("branch", (await git.currentBranch({ fs: mem, dir })) === "side");
await git.checkout({ fs: mem, dir, ref: c1, force: true });
const back = api.git_tree_read(mem);
check("checkout restores the tree", back.map((f) => f.name).join(",") === "main.bend,lib/a.bend" && back[0].text === "import Base\n", JSON.stringify(back));
const files = await git.listFiles({ fs: mem, dir, ref: c2 });
const { blob } = await git.readBlob({ fs: mem, dir, oid: c2, filepath: "main.bend" });
check("files of a commit", files.join(",") === "main.bend" && new TextDecoder().decode(blob).includes("# two"));
// dump, restore, go on
const again = api.gitfs_new(structuredClone(mem.dump()));
check("restored log", (await git.log({ fs: again, dir })).length === 1 && (await git.resolveRef({ fs: again, dir, ref: "HEAD" })) === c1);
await git.checkout({ fs: again, dir, ref: "main", force: true });
check("restored branch", (await git.log({ fs: again, dir })).length === 2);
if (bad) { console.log(bad + " failed"); process.exit(1); }
console.log("git ok");
