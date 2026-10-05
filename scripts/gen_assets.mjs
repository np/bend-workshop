// Collects what the browser build ships: base.bend and the JS side of each effect.
import fs from "node:fs";
import path from "node:path";
const root = "../bend/bend2";
const out = {};
out["/bend/bend2/base.bend"] = fs.readFileSync(path.join(root, "base.bend"), "utf8");
for (const f of fs.readdirSync(path.join(root, "effs")).sort()) {
  if (f.endsWith(".js")) {
    out["/bend/bend2/effs/" + f] = fs.readFileSync(path.join(root, "effs", f), "utf8");
  }
}
const ver = /const VERSION = "([^"]+)"/.exec(fs.readFileSync(path.join(root, "main.ts"), "utf8"))[1];
const commit = process.argv[2] ?? "";
// The infix table, read from bend.ts itself: operator -> the def it calls
// ("." + verb for one picked by the type annotation around it).
const bsrc = fs.readFileSync(path.join(root, "bend.ts"), "utf8");
const tab = /const INFIX[^=]*=\s*\{([\s\S]*?)\n\};/.exec(bsrc);
const infix = {};
for (const m of (tab ? tab[1] : "").matchAll(/"([^"]+)":\s*\[\s*(-?\d+),\s*(true|false),\s*"([^"]*)"\s*\]/g)) {
  infix[m[1]] = [Number(m[2]), m[3] === "true", m[4]];
}
if (Object.keys(infix).length < 10) {
  throw new Error("the infix table of bend.ts was not found");
}
// The C side of the effects, which only the C output reads: kept out of the
// bundle, the page carries it compressed and hands it over when asked.
const cfx = {};
for (const f of fs.readdirSync(path.join(root, "effs")).sort()) {
  if (/\.(c|h)$/.test(f)) {
    cfx["/bend/bend2/effs/" + f] = fs.readFileSync(path.join(root, "effs", f), "utf8");
  }
}
fs.mkdirSync("gen", { recursive: true });
fs.writeFileSync("gen/c_effects.json", JSON.stringify(cfx));
fs.writeFileSync("gen/assets.ts", "export const INFIX: Record<string, [number, boolean, string]> = " + JSON.stringify(infix) + ";\n"
  + "export const VERSION = " + JSON.stringify(ver)
  + ";\nexport const COMMIT = " + JSON.stringify(commit)
  + ";\nexport const ASSETS: Record<string, string> = " + JSON.stringify(out) + ";\n");
console.log(ver, Object.keys(out).length, "files");
