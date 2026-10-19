// The agent's memory (src/memory.js), as UniiChat's: the tree, the view and
// its merges, zoom, search, with a stand-in compactor.
import fs from "node:fs";
const src = fs.readFileSync("src/memory.js", "utf8");
const core = src.slice(0, src.indexOf("  // Storage"));
const M = new Function(core + "\nreturn { mem_new, mem_push, mem_lines, mem_size, mem_pairs, mem_shrink, mem_zoom, mem_search, mem_text, mem_bytes, mem_name, MEM_NODE };")();
let bad = 0;
const expect = (label, cond, more) => { console.log((cond ? "ok  " : "BAD ") + label + (more !== undefined ? "  " + more : "")); if (!cond) bad++; };
let calls = 0;
const asked = new Set();
const ask = async (system, user) => {
  calls++;
  const m = /Merge lines (\d+\+\d+) and (\d+\+\d+)/.exec(user);
  asked.add(m[1] + "&" + m[2]);
  return "summary of " + m[1] + " and " + m[2] + ": " + "x".repeat(300);
};

// names, a short message as its own line, a long one as its beginning
{
  const m = M.mem_new();
  M.mem_push(m, "user", "Prove add_zero.");
  M.mem_push(m, "tool", "read_file {\"path\":\"main.bend\"}\n→ " + "y".repeat(3000));
  const lines = M.mem_lines(m);
  expect("names and short line", lines[0] === "0+1|user: Prove add_zero.", lines[0]);
  expect("long message: its beginning, then zoom", lines[1].startsWith("1+1|tool: read_file") && lines[1].endsWith("(zoom for all)") && M.mem_bytes(lines[1].slice(4)) <= M.MEM_NODE);
  expect("zoom(1, 1) gives it whole", M.mem_zoom(m, 1, 1).text.length > 3000);
  expect("search finds it", M.mem_search(m, "add_zero").messages[0].id === 0);
  let threw = false;
  try { M.mem_zoom(m, 1, 2); } catch (e) { threw = true; }
  expect("zoom refuses a line that is not one", threw);
}

// the sawtooth: the view stays under its budget, merging down to half
{
  const m = M.mem_new();
  const high = 20000;
  let max = 0;
  let min = Infinity;
  let grows_only = true;
  for (let i = 0; i < 1500; i++) {
    const before = M.mem_lines(m);
    M.mem_push(m, i % 3 === 0 ? "user" : "tool", "message " + i + " " + "z".repeat(200 + (i * 37) % 900));
    const r = await M.mem_shrink(m, high, ask, 4, 4000);
    const after = M.mem_lines(m);
    if (r.merged === 0) {
      // between merges, the view only grows at its end
      grows_only = grows_only && before.every((l, k) => after[k] === l) && after.length === before.length + 1;
    } else {
      min = Math.min(min, M.mem_size(m));
    }
    max = Math.max(max, M.mem_size(m));
  }
  expect("never past the budget once shrunk", max <= high, max);
  expect("a merge goes down to about half", min <= high / 2 + 600, min);
  expect("between merges the view only grows at its end", grows_only);
  // coverage: the view covers every message once, in order
  let next = 0;
  let ok = true;
  for (const line of M.mem_lines(m)) {
    const [id, n] = line.split("|")[0].split("+").map(Number);
    ok = ok && id === next;
    next = id + n;
  }
  expect("the view covers the chat, in order", ok && next === m.msgs.length, next + " of " + m.msgs.length);
  // older lines cover more
  const spans = M.mem_lines(m).map((l) => Number(l.split("|")[0].split("+")[1]));
  expect("older lines cover more messages", spans[0] >= spans[spans.length - 1] && spans[spans.length - 1] === 1, spans.slice(0, 4) + " … " + spans.slice(-3));
  expect("each node asked for once", asked.size === calls, asked.size + " / " + calls);
  // zoom down a merged line
  const top = M.mem_lines(m)[0].split("|")[0].split("+").map(Number);
  const z = M.mem_zoom(m, top[0], top[1]);
  expect("zoom opens a merged line into its two halves", z.lines.length === 2 && z.lines[0].startsWith(top[0] + "+" + top[1] / 2 + "|"));
}

// the most due pair merges first: the oldest, at the lowest level
{
  const m = M.mem_new();
  for (let i = 0; i < 8; i++) M.mem_push(m, "user", "m" + i);
  const p = M.mem_pairs(m);
  expect("most due: the oldest pair", p[0].i === 0 && p[0].l === 0);
}

// small halves join without a call; a compactor too long is asked again, then cut
{
  const m = M.mem_new();
  for (let i = 0; i < 4; i++) M.mem_push(m, "user", "short " + i);
  let n = 0;
  await M.mem_shrink(m, 10, async () => { n++; return "never"; }, 2, 1000);
  expect("short halves join, no call", n === 0 && M.mem_lines(m)[0].includes("⁞"), M.mem_lines(m)[0]);
  const m2 = M.mem_new();
  for (let i = 0; i < 2; i++) M.mem_push(m2, "tool", "w".repeat(600));
  let tries = 0;
  await M.mem_shrink(m2, 10, async () => { tries++; return "q".repeat(700); }, 1, 1000);
  expect("too long: asked again, then cut to fit", tries === 3 && M.mem_bytes(M.mem_text(m2, 1, 0)) <= M.MEM_NODE, tries);
  const m3 = M.mem_new();
  for (let i = 0; i < 2; i++) M.mem_push(m3, "tool", "v".repeat(600));
  await M.mem_shrink(m3, 10, async () => { throw { code: "http" }; }, 1, 1000);
  expect("no compactor: the halves cut to fit", M.mem_bytes(M.mem_text(m3, 1, 0)) <= M.MEM_NODE && M.mem_lines(m3).length === 1);
}
if (bad) { console.log(bad + " failed"); process.exit(1); }
console.log("memory ok");
