// Every example, each file as the entry: it must check and, if it has a
// main, run. Some cannot, and that is expected: a LAWS.bend alone holds the
// laws' holes, a .js file is an effect, a window has no display under Node,
// and the bounty is a ?TODO. Anything else failing fails the test.
import fs from "node:fs";
import { exec } from "./run.mjs";

const exs = JSON.parse(fs.readFileSync("gen/examples.json", "utf8"));

function expected(name, r, out) {
  if (name.endsWith(".js")) {
    return "an effect, not an entry";
  }
  if (!r.ok && /TODO/.test(r.text) && (name.endsWith("LAWS.bend") || name === "bounty.bend")) {
    return "holes by design";
  }
  if (/Window\.open: no display/.test(out)) {
    return "a window: no display under Node";
  }
  return null;
}

let bad = 0;
let known = 0;
for (const e of exs) {
  const files = Object.fromEntries(e.files.map((f) => [f.name, f.text]));
  for (const f of e.files) {
    const { r, out, code } = await exec(files, f.name, []);
    const fine = r.ok && (code === 0 || code === null);
    const why = fine ? null : expected(f.name, r, out);
    if (!fine && why === null) {
      bad += 1;
    }
    if (!fine && why !== null) {
      known += 1;
    }
    console.log(fine ? "ok   " : why !== null ? "skip " : "FAIL ", e.title.en, "/", f.name,
      fine ? "" : "(" + (why || r.text.split("\n").slice(0, 3).join(" ")) + ")");
  }
}
console.log(bad === 0 ? "all examples fine (" + known + " expected exceptions)" : bad + " unexpected failures");
process.exit(bad === 0 ? 0 : 1);
