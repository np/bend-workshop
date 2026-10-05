import fs from "node:fs";
import vm from "node:vm";
const src = fs.readFileSync("dist/bend-core.js", "utf8");
const ctx = vm.createContext({ TextEncoder, TextDecoder, performance, URL, console, crypto: globalThis.crypto });
vm.runInContext(src + "\n;globalThis.BendCore = BendCore;", ctx);
const B = ctx.BendCore;
console.log("version", B.VERSION, B.COMMIT, "boot ms", await B.boot());
const progs = {
  hello: `import Base\n\ndef main() -> IO(Unit):\n  do IO<Unit>:\n    IO.print("Hello, world")\n`,
  pow: "import Base\n\ndef pow2(+d: Nat) -> U32:\n  match d:\n    case 0n:\n      1\n    case 1n+p:\n      a b = pow2(p) pow2(p)\n      (a + b : U32)\n\ndef main() -> U32:\n  pow2(20n)\n",
  bad: `import Base\n\ndef main() -> U32:\n  "oops"\n`,
  parse: `import Base\n\ndef main( -> U32:\n  1\n`,
  eq: `import Base\n\nlaw add_zero:\n  for x: Nat\n  {Nat.add(x, 0n) == x : Nat}\n\ndef add_zero(x):\n  match x:\n    case 0n:\n      {==}\n    case 1n+p:\n      %add_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}\n      {==}\n\ndef main() -> {Nat.add(2n, 0n) == 2n : Nat}:\n  add_zero(2n)\n`,
  nomain: `import Base\n\ndef f(x: U32) -> U32:\n  x\n`,
  goal: `import Base\n\ndef f(x: U32) -> U32:\n  ?g\n`,
};
for (const [k, v] of Object.entries(progs)) {
  const r = await B.run({ "main.bend": v }, "main.bend", true);
  console.log("==", k, r.ok, JSON.stringify(r.ms), r.where ?? "", r.js ? "js:" + r.js.length : "", r.value ?? "");
  console.log(r.text);
}
