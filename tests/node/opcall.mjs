import fs from "node:fs";
const app = fs.readFileSync("src/app.js", "utf8") + "\n" + fs.readFileSync("src/opcall.js", "utf8");
const grab = (name) => { const a = app.indexOf("  function " + name + "("); if (a < 0) throw new Error(name); return app.slice(a, app.indexOf("\n  }\n", a) + 4); };
const INFIX = JSON.parse(/INFIX[^=]*= (\{.*?\});/.exec(fs.readFileSync("gen/assets.ts", "utf8"))[1]);
const names = ["split_top", "close_of", "top_split", "angle_args", "call_at", "op_back", "op_tokens", "op_tree", "op_atom", "op_calls",
  "call_tree", "op_with_ns", "op_spaces", "op_infix", "op_group", "op_scope", "op_slot", "call_span", "call_outer", "opcall_plan"];
const src = "const Core = { INFIX: " + JSON.stringify(INFIX) + " };\nconst OP_WALKED = new Set(['Bool.and', 'Bool.or', 'String.append']);\n"
  + names.map(grab).join("\n") + "\nreturn { opcall_plan };";
const { opcall_plan } = new Function(src)();
const apply = (text, plan) => text.slice(0, plan.from) + plan.text + text.slice(plan.to);
const at_op = (text, needle, k = 0) => { let i = -1; for (let n = 0; n <= k; n++) i = text.indexOf(needle, i + 1); return { op: needle.trim(), a: i + (needle.length - needle.trimStart().length) }; };
const at_call = (text, needle) => ({ start: text.indexOf(needle) });
const cases = [
  ["  c = (x + y * 3n : Nat)", " + "],
  ["  c = ((x + y) * 3n : Nat)", " * "],
  ["  c = (a - b - c : U32)", " - "],
  ["  c = (a - (b - c) : U32)", " - ", 1],
  ["  c = (a < b && b <= c : Nat)", " && "],
  ["  c = (s + x : Set)", " + "],
  ["  c = (a .&. b .|. c << 2 : U32)", " << "],
  ["  c = (v + w : Vec<n>)", " + "],
  ["  c = (x * 2.0 + 1.0 : F32)", " + "],
  ["  c = f(p && q || r)", " || "],
  ["  c = s ++ t ++ \"!\"", " ++ "],
  ["  l = 1 <> 2 <> []", " <> "],
  ["  c = (a + (b * c : U32) : Nat)", " + "],
  ["  c = a + b", " + "],
];
let bad = 0;
for (const [text, needle, k] of cases) {
  const plan = opcall_plan(text, at_op(text, needle, k || 0));
  const out = plan === null ? "(none)" : plan.error ? "ERROR " + plan.error : apply(text, plan);
  // and back, from the outermost call
  let back = "";
  if (plan && !plan.error) {
    const m = /[A-Za-z_][\w.]*[({]/.exec(plan.text);
    const t2 = apply(text, plan);
    const p2 = m ? opcall_plan(t2, { start: plan.from + m.index }) : null;
    back = p2 && !p2.error ? apply(t2, p2) : "(no way back)";
  }
  console.log(text.trim().padEnd(34), "→", out.trim().padEnd(58), "→", back.trim());
  // the way back gives the text again, but for the annotation, cut to its head
  if (back !== "" && back !== text && back !== text.replace(": Vec<n>)", ": Vec)")) {
    bad += 1;
    console.log("   ^ the round trip changed the text");
  }
}
// from calls, the caret inside a nested call
const t = "  c = Nat.add(x, Nat.mul(y, 3n))";
const p = opcall_plan(t, at_call(t, "Nat.mul"));
console.log(t.trim(), "→ (from inner)", apply(t, p).trim());
const t3 = "  b = Bool.and(Nat.is_lt(a, b), U32.is_lt(c, d))";
console.log(t3.trim(), "→", apply(t3, opcall_plan(t3, at_call(t3, "Bool.and"))).trim());
const t4 = "  b = Bool.not(Bool.and(p, q))";
console.log(t4.trim(), "→", apply(t4, opcall_plan(t4, at_call(t4, "Bool.and"))).trim());
const t5 = "  n = Nat.mul(Nat.add(a, b), Nat.sub(c, Nat.sub(d, e)))";
console.log(t5.trim(), "→", apply(t5, opcall_plan(t5, at_call(t5, "Nat.mul"))).trim());
if (bad > 0) {
  console.log(bad + " round trips failed");
  process.exit(1);
}
console.log("round trips ok");
