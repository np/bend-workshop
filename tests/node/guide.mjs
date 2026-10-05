import fs from "node:fs";
import { exec } from "./run.mjs";
const md = fs.readFileSync("../bend/guide/GUIDE.md", "utf8");
const blocks = [...md.matchAll(/```python\n([\s\S]*?)```/g)].map((m) => m[1]);
let i = 0;
for (const b of blocks) {
  i++;
  if (!/^def main\(/m.test(b)) { continue; }
  const t0 = performance.now();
  const { r, out, code } = await exec({ "main.bend": b }, "main.bend", []);
  console.log("#" + i, b.split("\n").find((l) => l.startsWith("def ") || l.startsWith("type ")), "| ok=" + r.ok, "exit=" + code,
    (performance.now() - t0).toFixed(0) + "ms", "|", JSON.stringify(out.slice(0, 120)), r.ok ? "" : "\n" + r.text);
}
