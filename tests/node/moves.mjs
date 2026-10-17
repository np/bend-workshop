// Rename and move, on projects that check: each plan applied must still
// check (with Bend's own checker), and the moves that cannot be made must
// say why.
import fs from "node:fs";
import { exec } from "./run.mjs";
const app = fs.readFileSync("src/app.js", "utf8") + "\n" + fs.readFileSync("src/moves.js", "utf8");
const grab = (name) => { const a = app.indexOf("  function " + name + "("); if (a < 0) throw new Error(name); return app.slice(a, app.indexOf("\n  }\n", a) + 4); };
const names = ["split_top", "close_of", "path_join", "decl_scan", "mv_tokens", "mv_rewrite", "mv_imports", "mv_relpath", "mv_alias",
  "mv_stem_alias", "mv_add_import", "mv_roots", "mv_cycle", "rename_plan", "mv_blocks", "mv_lines_out", "move_plan"];
const src = "const t = (k, ...a) => k + a.join(',');\nconst hub_rel = (p) => null;\n" + names.map(grab).join("\n")
  + "\nreturn { decl_scan, rename_plan, move_plan, mv_roots };";
const M = new Function(src)();

const shapes = `import Base

# A shape.
type Shape is Data:
  Circle{r: Nat}
  Square{s: Nat}

def Shape.size(x: Shape) -> Nat:
  match x:
    case Circle{+r}:
      r
    case Square{+s}:
      s

def double(+n: Nat) -> Nat:
  Nat.add(n, n)

# Twice the size.
def big(x: Shape) -> Nat:
  double(Shape.size(x))
`;
const util = `import Base

def triple(+n: Nat) -> Nat:
  Nat.add(n, Nat.add(n, n))
`;
const main = `import Base
import ./shapes.bend as S

def area(x: S.Shape) -> Nat:
  S.big(x)

def main() -> Nat:
  area(S.Circle{3n})
`;
const project = () => [{ name: "shapes.bend", text: shapes }, { name: "util.bend", text: util }, { name: "main.bend", text: main }];
const decl = (files, file, name, kind) => M.decl_scan(files.find((f) => f.name === file).text, file).find((d) => d.name === name && (!kind || d.kind === kind));
const apply = (files, plan) => {
  const out = files.map((f) => ({ name: f.name, text: plan.texts[f.name] ?? f.text }));
  for (const [k, v] of Object.entries(plan.texts)) if (!out.some((f) => f.name === k)) out.push({ name: k, text: v });
  return out;
};
const checks = async (files) => {
  const map = Object.fromEntries(files.map((f) => [f.name, f.text]));
  const res = [];
  for (const root of M.mv_roots(files)) {
    const { r } = await exec(map, root);
    res.push(root + ":" + (r.ok ? "ok" : (r.text || "").split("\n").slice(0, 4).join(" ")));
  }
  return res;
};
let bad = 0;
const expect = (label, cond, more) => { console.log((cond ? "ok  " : "BAD ") + label + (more ? "  " + more : "")); if (!cond) bad++; };

console.log("before:", (await checks(project())).join(" | "));
const cases = [
  ["rename def big → huge", (fs) => M.rename_plan(fs, decl(fs, "shapes.bend", "big"), "huge")],
  ["rename type Shape → Form (namespace too)", (fs) => M.rename_plan(fs, decl(fs, "shapes.bend", "Shape", "type"), "Form")],
  ["rename ctor Circle → Disc", (fs) => M.rename_plan(fs, decl(fs, "shapes.bend", "Circle", "ctor"), "Disc")],
  ["move double → util.bend", (fs) => M.move_plan(fs, decl(fs, "shapes.bend", "double"), "util.bend")],
  ["move big → main.bend (main used it as S.big)", (fs) => M.move_plan(fs, decl(fs, "shapes.bend", "big"), "main.bend")],
  ["move triple → shapes.bend", (fs) => M.move_plan(fs, decl(fs, "util.bend", "triple"), "shapes.bend")],
  ["move area → shapes.bend (main then calls S.area)", (fs) => M.move_plan(fs, decl(fs, "main.bend", "area"), "shapes.bend")],
  ["move big → new file extra.bend", (fs) => M.move_plan(fs, decl(fs, "shapes.bend", "big"), "extra.bend", true)],
];
for (const [label, mk] of cases) {
  const fs0 = project();
  const plan = mk(fs0);
  if (plan.error) { expect(label, false, "error " + plan.error + " " + (plan.arg || "")); continue; }
  const after = apply(fs0, plan);
  const res = await checks(after);
  expect(label, res.every((x) => x.endsWith(":ok")), res.join(" | ") + (plan.notes ? "  notes " + JSON.stringify(plan.notes) : ""));
  if (process.env.SHOW) for (const [k, v] of Object.entries(plan.texts)) console.log("---- " + k + "\n" + v);
}
// refused, with the reason
{
  const fs0 = project();
  const r = M.move_plan(fs0, decl(fs0, "shapes.bend", "Shape.size"), "util.bend");
  expect("move Shape.size → util.bend is a cycle (it uses Shape, big still uses it)", r.error === "mv_cycle", JSON.stringify(r.error ? r : Object.keys(r.texts)));
}
{
  const fs0 = project();
  const r = M.rename_plan(fs0, decl(fs0, "shapes.bend", "big"), "double");
  expect("rename big → double is taken", r.error === "rn_taken");
}
{
  const fs0 = project();
  expect("rename to a bad name", M.rename_plan(fs0, decl(fs0, "shapes.bend", "big"), "2x").error === "rn_bad");
  expect("move to its own file", M.move_plan(fs0, decl(fs0, "shapes.bend", "big"), "shapes.bend").error === "mv_same");
}
// comments, strings and locals that only look like the name stay as they are
{
  const fs0 = [{ name: "a.bend", text: "import Base\n\n# big is mentioned here\ndef big(n: Nat) -> Nat:\n  n\n\ndef main() -> String:\n  \"big\"\n" }];
  const r = M.rename_plan(fs0, decl(fs0, "a.bend", "big"), "large");
  expect("comments and strings untouched", r.texts && r.texts["a.bend"].includes("# big is") && r.texts["a.bend"].includes("\"big\"") && r.texts["a.bend"].includes("def large("));
}
if (bad) { console.log(bad + " failed"); process.exit(1); }
console.log("moves ok");
