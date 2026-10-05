// Bend in the browser: the checker (bend.ts) and the JS emitter (comp.ts),
// over an in-memory file system. One call, run(), checks a set of files and,
// if the entry has a main, answers the JavaScript it compiles to.

import * as Bend from "../../bend/bend2/bend.ts";
import * as Comp from "../../bend/bend2/comp.ts";
import * as Safe from "../../bend/bend2/safe.ts";
import { FILES } from "./shim/fs.ts";
import { VERSION, COMMIT, INFIX } from "../gen/assets.ts";

const WORK = "/work/";

let base: Bend.Book | null = null;

async function base_book(): Promise<Bend.Book> {
  if (base === null) {
    const book = Bend.book_nil();
    await Bend.book_load(book, Bend.BASE_BEND, "", new Map());
    Bend.book_valid(book, 0);
    base = book;
  }
  return base;
}

// book_seed in main.ts: a fresh book over Base's checked declarations.
function book_seed(from: Bend.Book): Bend.Book {
  const book = Bend.book_nil();
  for (const k of Object.keys(from.tlds)) {
    book.tlds[k] = { ...from.tlds[k] };
  }
  Object.assign(book.ctrs, from.ctrs);
  for (const k of Object.keys(from.tmps)) {
    book.tmps[k] = { ...from.tmps[k] };
  }
  book.order.push(...from.order);
  return book;
}

type Where = { file: string | null; line: number; col: number; end_line: number; end_col: number };

// An open ?name: where it sits, what it must be, and what is in scope there.
type Goal = {
  name: string;
  def: string | null;
  file: string;
  line: number;
  col: number;
  expected: string;
  normal: string | null;   // the expected type normalized, when that differs
  ctx: Array<[string, string]>;
  quant: Record<string, string>;   // each variable's quantity: "-" erased, "" affine, "+" reusable
};

type Out = {
  ok: boolean;
  text: string;          // the checker's verdict, or the error
  where?: Where;         // where the error points, when it points into a user file
  goals: Goal[];         // every ?name the checker reached, in the order it met them
  open?: boolean;        // nothing is wrong but goals or ?TODOs left open
  partial?: boolean;     // a slow file: the goals past the ones listed were not collected
  overflow?: boolean;    // the JS stack ran out: a worker's is smaller than a page's
  js?: string;           // the compiled program, when there is a main to run
  value?: string;        // a pure main the compiled printer refuses, normalized here
  io?: boolean;
  main?: boolean;
  ms: { check: number; emit: number };
};

// A ?name already turned into ?TODO on some line, in the user's own columns.
type Swap = { line: number; col: number; len: number };

const TODO = "?TODO";

// The loader blanks import lines before parsing, so compare with them blanked.
function blank(s: string): string {
  return s.split("\n").map((l) =>
    /^\s*import(\s|$)/.test(l) && !/^\s*import\s+"/.test(l) ? "" : l).join("\n");
}

function span_file(spn: Bend.Span, files: Record<string, string>): string | null {
  const src  = spn.file.str;
  const want = blank(src);
  for (const [k, v] of Object.entries(files)) {
    if (v === src || blank(v) === want) {
      return k;
    }
  }
  return null;
}

function span_at(src: string, pos: number): { line: number; col: number } {
  const head = src.slice(0, pos);
  return { line: head.split("\n").length, col: pos - head.lastIndexOf("\n") };
}

// A column in the patched text, back in the user's text.
function col_back(swaps: Swap[], line: number, col: number): number {
  let shift = 0;
  for (const w of swaps.filter((x) => x.line === line).sort((x, y) => x.col - y.col)) {
    if (w.col + shift < col) {
      shift += TODO.length - w.len;
    }
  }
  return col - shift;
}

function err_where(e: unknown, files: Record<string, string>,
  swaps: Record<string, Swap[]>): Where | undefined {
  const spn = (e as Bend.Err)?.spn;
  if ((e as Bend.Err)?.$ !== "Err" || spn === undefined) {
    return undefined;
  }
  const file = span_file(spn, files);
  const beg  = span_at(spn.file.str, spn.beg);
  const end  = span_at(spn.file.str, Math.max(spn.beg, spn.end));
  const back = file === null ? [] : swaps[file] ?? [];
  return { file, line: beg.line, col: col_back(back, beg.line, beg.col),
    end_line: end.line, end_col: col_back(back, end.line, end.col) };
}

function err_text(e: unknown, where: Where | undefined, files: Record<string, string>): string {
  if (e instanceof RangeError) {
    return "Error: the machine stack overflowed (a deep recursion, or a literal too large to expand)";
  }
  const err = e as Bend.Err;
  if (err?.$ === "Err") {
    const text = Bend.err_show(err);
    const cut  = text.indexOf("\nLocation:");
    if (cut < 0 || where === undefined || where.file === null) {
      return text;
    }
    // the excerpt is cut from the user's text, not from the patched one,
    // drawn as err_show draws it: the line, then a caret under the span
    const lns = files[where.file].split("\n");
    const beg = Math.max(1, where.line - 1);
    const end = Math.min(lns.length, where.line + 1);
    const num = String(end).length;
    const at  = where.line;
    const lft = (lns[at - 1] ?? "").slice(0, where.col - 1);
    const len = where.end_line === at ? where.end_col - where.col : (lns[at - 1] ?? "").length - lft.length;
    const car = " ".repeat(num) + " | " + lft.replace(/[^\t]/g, " ")
      + "^".repeat(Math.max(1, Math.min(len, (lns[at - 1] ?? "").length - lft.length)));
    const exc = lns.slice(beg - 1, end).map((l, j) =>
      String(beg + j).padStart(num) + (beg + j === at ? ">| " + l + "\n" + car : " | " + l));
    const nte = err.nte === undefined ? "" : "\n" + err.nte;
    return text.slice(0, cut) + "\nLocation:" + (err.def === undefined ? "" : " " + Bend.name_show(err.spn?.file, err.def))
      + "\n" + exc.join("\n") + nte;
  }
  if (e instanceof Error && /fetch/i.test(e.message)) {
    return "Error: an import from the hub (0x<hash>/ or <name>@<version>/) needs hub.bend-lang.com, which this page cannot reach."
      + "\nRun the file once with the bend CLI, then import a zip of ~/.bend/lib here (Projects, Import): the page keeps"
      + "\nthe hub's files it is given, and needs the hub no more.";
  }
  return typeof e === "string" ? e : e instanceof Error ? "Error: " + e.message : String(e);
}

// The checker stops at the first ?name. When it does, this reads the goal
// off the error; the caller swaps the hole for ?TODO and checks again.
// The book being checked when the last error was thrown: a goal's type is
// normalized against it.
let cur_book: Bend.Book | null = null;

// A type, normalized, as text: a computed family reduces to what it is made
// of, so its constructors can be offered. Null when nothing changes or the
// normalization fails.
function normal_of(book: Bend.Book | null, exp: unknown, shown: string, file?: Bend.File): string | null {
  if (book === null || typeof exp !== "object" || exp === null) {
    return null;
  }
  try {
    const nf = Bend.term_show(Bend.term_lower(Bend.term_snf(book, exp as Bend.HTerm)), -1, [], file).replace(/\^\d+/g, "");
    return nf.length > 2000 || nf === shown.replace(/\^\d+/g, "") ? null : nf;
  } catch (e) {
    return null;
  }
}

function goal_of(e: unknown, cur: Record<string, string>): (Goal & { at: number }) | null {
  const err = e as Bend.Err;
  if (err?.$ !== "Err" || err.spn === undefined || typeof err.exp === "string"
    || typeof err.obs !== "object" || err.obs === null || (err.obs as { $?: string }).$ !== "Hol") {
    return null;
  }
  const name = (err.obs as { k: string }).k;
  const file = span_file(err.spn, cur);
  if (file === null) {
    return null;
  }
  const { line, col } = span_at(err.spn.file.str, err.spn.beg);
  const lns = cur[file].split("\n");
  if (lns[line - 1] === undefined || lns[line - 1].slice(col - 1, col + name.length) !== "?" + name) {
    return null;
  }
  const text = Bend.err_show(err);
  const exp  = /\n- expected : ([\s\S]*?)\n- observed : /.exec(text);
  const from = text.indexOf("\nContext:");
  const upto = text.indexOf("\nLocation:") >= 0 ? text.indexOf("\nLocation:")
    : err.nte === undefined ? -1 : text.lastIndexOf("\n" + err.nte);
  const ctx: Array<[string, string]> = [];
  if (from >= 0) {
    for (const l of text.slice(from + 9, upto < 0 ? undefined : upto).split("\n")) {
      const m = /^- (\S+)\s+: (.*)$/.exec(l);
      if (m !== null) {
        ctx.push([m[1], m[2]]);
      } else if (ctx.length > 0 && l !== "") {
        ctx[ctx.length - 1][1] += "\n" + l;
      }
    }
  }
  const expected = exp === null ? "?" : exp[1];
  // the quantities the printed context leaves out, for whoever rebinds it
  const quant: Record<string, string> = {};
  for (const [, a] of Bend.pmap_to_array(err.ctx)) {
    quant[a.k] = Bend.quant_show(a.q);
  }
  return { name, def: err.def === undefined ? null : Bend.name_show(err.spn.file, err.def), file, line, col, expected,
    normal: normal_of(cur_book, err.exp, expected, err.spn.file), ctx, quant, at: col };
}

// The names a term (a span skipped) refers to.
function term_refs(tm: unknown, out: Set<string>): void {
  if (typeof tm === "object" && tm !== null) {
    const { $, k } = tm as { $?: string; k?: string };
    if (($ === "Ref" || $ === "ADT") && k !== undefined) {
      out.add(k);
    }
    for (const [f, v] of Object.entries(tm)) {
      if (f !== "s") {
        term_refs(v, out);
      }
    }
  }
}

// The CLI's verdict (cli_verdict and book_promises in main.ts): PASS when
// no def outside Base relies on unsafe or foreign code, else FAIL and why.
// A foreign def is a promise like @unsafe: the checker reads its type,
// never its code. A def relies on one when its type, body or constructor
// fields name it, however far.
export const PASS = "ALL PROOFS CHECK";
export const FAIL = "SOME PROOFS FAIL";

function book_promises(book: Bend.Book): string[] {
  const own  = [...new Set(book.order)].filter((k) => (book.tlds[k] as { b?: boolean }).b !== true);
  const bad  = new Set(Object.keys(book.tlds).filter((k) => {
    const t = book.tlds[k] as Bend.Def & { b?: boolean };
    return t.u === true || (t.i !== undefined && t.b !== true);
  }));
  const uses: Record<string, string[]> = Object.create(null);
  const seen = new Set<string>();
  for (const q = bad.size === 0 ? [] : own.slice(); q.length > 0;) {
    const k = q.pop() as string;
    const t = book.tlds[k] as any;
    if (t !== undefined && !seen.has(k)) {
      seen.add(k);
      const rs = new Set<string>();
      for (const c of t.$ === "ADT" ? t.c : [t]) {
        term_refs(Bend.term_lower(c.T), rs);
      }
      term_refs(t.$ === "Def" ? t.e : undefined, rs);
      for (const r of rs) {
        (uses[r] ??= []).push(k);
        q.push(r);
      }
    }
  }
  for (const k of bad) {
    uses[k]?.forEach((j) => bad.add(j));
  }
  return own.filter((k) => bad.has(k));
}

function verdict(book: Bend.Book, _n0: number): string {
  const bad = book_promises(book);
  return bad.length === 0 ? PASS
    : FAIL + "\nError: " + String(bad.length) + " def" + (bad.length === 1 ? " relies" : "s rely")
      + " on unsafe or foreign code:\n" + bad.map((k) => "- " + k).join("\n");
}

// The elaboration to BendTT, the proven kernel's language: what the kernel
// would read, and the defs it cannot express, with why. The kernel itself
// is a Lean program, out of a page's reach: bend <file> --verdict runs it.
// The hub's files live under LIB, as ~/.bend/lib does for the CLI: what
// the page already holds goes in before a check, so nothing is fetched
// twice, and what a check fetched comes back out, for the page to keep.
const LIB = "/home/.bend/lib/";

function lib_put(lib: Record<string, string> | undefined): Set<string> {
  for (const [rel, text] of Object.entries(lib ?? {})) {
    if (!rel.includes("..")) {
      FILES.set(LIB + rel, text);
    }
  }
  return new Set([...FILES.keys()].filter((k) => k.startsWith(LIB)));
}

function lib_new(before: Set<string>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of FILES) {
    if (k.startsWith(LIB) && !before.has(k)) {
      out[k.slice(LIB.length)] = v;
      n++;
    }
  }
  return n === 0 ? undefined : out;
}

// The compiler's text outputs, as bend f.bend -o f.<ext> writes them:
// js (js_book), mjs (js_lib as an ES module), c (compile_book) and bendtt
// (safe_emit, the kernel's input). One target per call: nothing else is
// built. extra: files the target reads that the page sends only when it
// is first asked for (the C sources of the effects, for c).
export async function emit(files: Record<string, string>, entry: string, target: string,
  lib?: Record<string, string>, extra?: Record<string, string>) {
  const before = lib_put(lib);
  for (const [k, v] of Object.entries(extra ?? {})) {
    FILES.set(k, v);
  }
  const out = await emit_go(files, entry, target);
  return { ...out, lib_new: lib_new(before) };
}

async function emit_go(files: Record<string, string>, entry: string, target: string):
  Promise<{ ok: boolean; text: string; out?: string; oos?: Array<[string, string]>; promises?: string[];
    hole?: boolean; nomain?: boolean; overflow?: boolean; ms: { check: number; emit: number } }> {
  const ms = { check: 0, emit: 0 };
  const t0 = performance.now();
  if (target === "bendtt") {
    const r = await bendtt_go(files, entry);
    return { ok: r.ok, text: r.text, out: r.tt, oos: r.oos, promises: r.promises,
      hole: !r.ok && /TODO|goal/.test(r.text), ms: { check: r.ms, emit: 0 } };
  }
  try {
    const { book } = await check(files, entry);
    ms.check = performance.now() - t0;
    if (book.hols > 0) {
      return { ok: false, hole: true, ms, text: "Error: " + String(book.hols) + " hole" + (book.hols === 1 ? "" : "s")
        + " (?name or ?TODO) left: the compiler needs the code complete." };
    }
    const main = book.tlds["main"];
    const has = main !== undefined && main.$ === "Def" && !(main.v === null && main.i === undefined);
    if (!has && target !== "mjs") {
      return { ok: false, nomain: true, ms, text: "No main in " + entry + ": a program needs one; a library compiles as a module." };
    }
    const t1 = performance.now();
    const out = target === "mjs" ? Comp.js_lib(book, true) : target === "c" ? Comp.compile_book(book) : Comp.js_book(book);
    ms.emit = performance.now() - t1;
    return { ok: true, text: "", out, ms };
  } catch (e) {
    const where = err_where(e, files, {});
    // the checker stops at the first ?name as at an error: a hole is no error here
    const hole = goal_of(e, files) !== null;
    return { ok: false, hole, text: hole ? "Error: a hole ?name is left: the compiler needs the code complete."
      : err_text(e, where, files), overflow: e instanceof RangeError,
      ms: { check: ms.check || performance.now() - t0, emit: 0 } };
  }
}

export async function bendtt(files: Record<string, string>, entry: string, lib?: Record<string, string>) {
  const before = lib_put(lib);
  const out = await bendtt_go(files, entry);
  return { ...out, lib_new: lib_new(before) };
}

async function bendtt_go(files: Record<string, string>, entry: string):
  Promise<{ ok: boolean; text: string; tt?: string; oos?: Array<[string, string]>; promises?: string[]; ms: number }> {
  const t0 = performance.now();
  try {
    const { book } = await check(files, entry);
    if (book.hols > 0) {
      return { ok: false, text: "Error: " + String(book.hols) + " TODO" + (book.hols === 1 ? "" : "s")
        + " found.\nThe code is incomplete, and not a valid proof yet.", ms: performance.now() - t0 };
    }
    const promises = book_promises(book);
    const out = "/work/.out.bendtt";
    const lines = Safe.safe_emit(book, out);
    const tt = FILES.get(out) ?? "";
    FILES.delete(out);
    const oos = lines.map((l): [string, string] => {
      const m = /^- ([^:]+): ([\s\S]*?)\n?$/.exec(l);
      return m === null ? [l.trim(), ""] : [m[1], m[2]];
    });
    return { ok: true, text: promises.length === 0 && oos.length === 0 ? PASS : FAIL, tt, oos, promises,
      ms: performance.now() - t0 };
  } catch (e) {
    const where = err_where(e, files, {});
    return { ok: false, text: err_text(e, where, files), ms: performance.now() - t0 };
  }
}

async function check(files: Record<string, string>, entry: string): Promise<{ book: Bend.Book; from: number }> {
  for (const k of [...FILES.keys()]) {
    if (k.startsWith(WORK)) {
      FILES.delete(k);
    }
  }
  for (const [k, v] of Object.entries(files)) {
    FILES.set(WORK + k, v);
  }
  const own  = /^import Base\s*(#.*)?$/m.test(files[entry] ?? "");
  const seed = own ? await base_book() : undefined;
  const book = seed === undefined ? Bend.book_nil() : book_seed(seed);
  const seen = new Map<string, string | null>();
  if (seed !== undefined) {
    seen.set(Bend.BASE_BEND, "");
  }
  await Bend.book_load(book, WORK + entry, "", seen);
  if (entry.split("/").pop() === "PROOF.bend") {
    const laws = WORK + entry.slice(0, entry.lastIndexOf("/") + 1) + "LAWS.bend";
    if (FILES.has(laws) && !seen.has(laws)) {
      throw "Error: PROOF.bend must import ./LAWS.bend";
    }
  }
  cur_book = book;
  Bend.book_valid(book, seed?.order.length ?? 0);
  return { book, from: seed?.order.length ?? 0 };
}

export async function boot(): Promise<number> {
  const t0 = performance.now();
  await base_book();
  return performance.now() - t0;
}

export async function run(files: Record<string, string>, entry: string, emit: boolean,
  lib?: Record<string, string>): Promise<Out & { lib_new?: Record<string, string> }> {
  const before = lib_put(lib);
  const out = await run_go(files, entry, emit);
  return { ...out, lib_new: lib_new(before) };
}

async function run_go(files: Record<string, string>, entry: string,
  emit: boolean): Promise<Out> {
  const ms = { check: 0, emit: 0 };
  const t0 = performance.now();
  const cur: Record<string, string> = { ...files };
  const swaps: Record<string, Swap[]> = {};
  const goals: Goal[] = [];
  let book: Bend.Book | null = null;
  let from = 0;
  // Every ?name is a goal worth showing, so check again past each one.
  for (;;) {
    try {
      const got = await check(cur, entry);
      book = got.book;
      from = got.from;
      break;
    } catch (e) {
      const g = goal_of(e, cur);
      if (g === null) {
        ms.check = performance.now() - t0;
        const where = err_where(e, cur, swaps);
        return { ok: false, text: err_text(e, where, files), where, goals, ms,
          overflow: e instanceof RangeError };
      }
      // a slow file: past a few seconds of checking, the goals found so far
      // are reported, and the ones after them wait for the next check
      if (goals.length >= 48 || performance.now() - t0 > 4000) {
        goals.push({ name: g.name, def: g.def, file: g.file, line: g.line,
          col: col_back(swaps[g.file] ?? [], g.line, g.at), expected: g.expected, normal: g.normal, ctx: g.ctx, quant: g.quant });
        ms.check = performance.now() - t0;
        return { ok: false, open: true, partial: true, goals, ms, text: "Error: " + String(goals.length)
          + " goal" + (goals.length === 1 ? "" : "s") + " open so far; the file is slow to check, so the goals past"
          + " these wait.\nThe code is incomplete, and not a valid proof yet." };
      }
      const back = swaps[g.file] ?? (swaps[g.file] = []);
      const col  = col_back(back, g.line, g.at);
      const lns  = cur[g.file].split("\n");
      const l    = lns[g.line - 1];
      lns[g.line - 1] = l.slice(0, g.at - 1) + TODO + l.slice(g.at + g.name.length);
      cur[g.file] = lns.join("\n");
      back.push({ line: g.line, col, len: g.name.length + 1 });
      goals.push({ name: g.name, def: g.def, file: g.file, line: g.line, col,
        expected: g.expected, normal: g.normal, ctx: g.ctx, quant: g.quant });
    }
  }
  ms.check = performance.now() - t0;
  const todos = book.hols - goals.length;
  if (goals.length > 0 || todos > 0) {
    const parts = [];
    if (goals.length > 0) {
      parts.push(String(goals.length) + " goal" + (goals.length === 1 ? "" : "s") + " open");
    }
    if (todos > 0) {
      parts.push(String(todos) + " TODO" + (todos === 1 ? "" : "s") + " found");
    }
    return { ok: false, open: true, goals, ms, text: "Error: " + parts.join(", ")
      + ".\nThe code is incomplete, and not a valid proof yet." };
  }
  try {
    const text = verdict(book, from);
    const main = book.tlds["main"];
    const has  = main !== undefined && main.$ === "Def"
      && !(main.v === null && main.i === undefined);
    if (!has || !emit) {
      return { ok: true, text, main: has, goals, ms };
    }
    const t1 = performance.now();
    const io = Comp.io_type(book) !== null;
    try {
      const js = Comp.js_book(book);
      ms.emit = performance.now() - t1;
      return { ok: true, text, main: true, io, js, goals, ms };
    } catch (e) {
      if (io) {
        throw e;
      }
      const snf = Bend.term_snf(book, (main as Bend.Def).v as Bend.HTerm);
      ms.emit = performance.now() - t1;
      return { ok: true, text, main: true, io: false, goals,
        value: Bend.term_show(Bend.term_lower(snf)), ms };
    }
  } catch (e) {
    return { ok: false, text: err_text(e, undefined, files), goals, ms,
      overflow: e instanceof RangeError };
  }
}

export function base_text(): string {
  return FILES.get(Bend.BASE_BEND) ?? "";
}

export { VERSION, COMMIT, INFIX };
