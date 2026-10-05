import fs from "node:fs";
import vm from "node:vm";
const core = fs.readFileSync("dist/bend-core.js", "utf8");
const prelude = fs.readFileSync("src/runner-prelude.js", "utf8");
const ctx = vm.createContext({ TextEncoder, TextDecoder, performance, URL, console, crypto: globalThis.crypto });
vm.runInContext(core + "\n;globalThis.BendCore = BendCore;", ctx);
const B = ctx.BendCore;
await B.boot();

export async function exec(files, entry, args = []) {
  const r = await B.run(files, entry, true);
  let out = "";
  let code = null;
  if (r.ok && r.js) {
    const host = { args, env: { USER: "bend" }, write: (fd, t) => { out += (fd === 2 ? "[err]" : "") + t; },
      flush() {}, exit: (c) => { code = c; }, wait(ms) { const t = performance.now() + ms; while (performance.now() < t) {} } };
    const src = prelude.replace("/*__PROGRAM__*/", () => r.js);
    const c2 = vm.createContext({ TextEncoder, TextDecoder, performance, console, crypto: globalThis.crypto });
    vm.runInContext(src, c2)(host);
  } else if (r.ok && r.value !== undefined) {
    out = r.value + "\n"; code = 0;
  }
  return { r, out, code };
}

if (process.argv[1].endsWith("test_run.mjs")) {
  const dir = process.argv[2];
  const files = {};
  for (const f of fs.readdirSync(dir)) {
    if (/\.(bend|js)$/.test(f)) files[f] = fs.readFileSync(dir + "/" + f, "utf8");
  }
  for (const entry of process.argv.slice(3)) {
    const t0 = performance.now();
    const { r, out, code } = await exec(files, entry, []);
    console.log("==", entry, "ok=" + r.ok, "exit=" + code, JSON.stringify(r.ms), "run+all ms", (performance.now() - t0).toFixed(0));
    console.log(r.text);
    if (r.where) console.log(r.where);
    console.log(out.slice(0, 600));
  }
}
