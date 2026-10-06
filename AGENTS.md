# AGENTS.md — Bend 2 pocket workshop

A web page for writing, checking, proving and running Bend 2 programs, phone
first. Bend's own checker and JavaScript compiler run inside the page; there
is no server. This file records the design choices made so far, so that whoever
works on the page next keeps them, or changes them on purpose.

- Shipped as one standalone file, `bend-workshop.html` (= `dist/index.html`)
- Tracks the latest Bend: currently 2.0.35, commit a950fd6 of bendlang/bend
- Owner's priorities: proof work on a phone, staying current with Bend, no
  surprises (privacy, lost work, silent failures)

## Ground rules

These shape every feature. Break one only with a reason written down here.

1. **Bend's code is used as it is.** `bend.ts`, `comp.ts` and `safe.ts` are
   bundled unmodified. What they need from Node is shimmed (`shim/`); what the
   page needs from them is read from their exports, or from their source at
   build time (the operator table). No fork, no patch. A Bend upgrade is a
   rebuild plus the tests.
2. **One self-contained HTML file.** Everything inlined: bundle, styles,
   guide, examples. It must work from `file://`, from any host, and in the
   claude.ai viewer, whose CSP forbids outside requests, may forbid blob
   workers, and forbids `eval`. Each feature degrades rather than breaks:
   worker → page, `new Function` → `<script>`, storage → none.
3. **Phone first.** It must work at 360 px with touch only. Nothing depends on
   hover alone (hover only adds a tooltip). Buttons wrap instead of running off
   a card. The key bar has the symbols phone keyboards hide, and a game pad
   appears for windows.
4. **The checker is the judge.** Every edit the page makes on its own is
   checked before it is written or offered: Split, Lemma, Constructors/Solve,
   law⇄def, operators⇄calls, `#goal:` marks. A candidate that does not type is shown greyed with
   the checker's reason, never hidden without a word. Every write of the agent
   is checked right after it lands, and the verdict goes back to the agent;
   only the checker's verdict says a proof is done.
5. **Limits defer, they never remove.** A budget decides what runs by itself
   and what waits for a tap, and the waiting state is visible: a dashed
   `Constructors…` button, a "goals past these wait" verdict. No feature
   disappears because a file is large.
6. **Mirror the CLI.** The verdict (`ALL PROOFS CHECK` / `SOME PROOFS FAIL`),
   the error excerpt with its caret, and the reading of imports and quantities
   follow `main.ts` and `bend.ts`. When the CLI changes, the page follows.
7. **Nothing is lost.** Every page-made edit goes through the browser's undo
   stack and ends in a toast with *Undo*. Destructive steps take a snapshot
   first. Opening an example never overwrites work.
8. **No telemetry.** The only request the page makes by itself is Google Fonts,
   and Settings turns it off. Anything else is user-triggered: a hub import,
   the assistant, the user's own programs.
9. **English by default, French too.** Every interface string lives in
   `src/i18n.js`. Compiler messages, the guide and example code stay in English.

## Files

```
build.sh, package.json, BEND_COMMIT, AGENTS.md, README.md, .gitignore
.github/      workflows/pages.yml (build, test, publish), dependabot.yml
scripts/      gen_assets.mjs, gen_examples.mjs, build_html.mjs
core/         entry.ts, shim/        (the bundle around Bend)
src/          the page
ex/           example programs written for the page
tests/node/   unit tests (npm test)
tests/e2e/    Playwright scripts, run_all.py, serve.py, fixtures/
gen/, dist/   what the build writes          (ignored by git)
tests/e2e/shots/, tests/e2e/fixtures/fakehub/  what the tests write (ignored)
```

| Path | What it is |
|---|---|
| `core/entry.ts` | The bundle's API over Bend: `run` (check, goals, emit JS for a run), `emit` (one compiler output), `bendtt` (elaboration to BendTT), `boot`, `base_text`, `INFIX`, `VERSION` |
| `core/shim/` | `node:fs` in memory, `node:path` (POSIX), `os`, `url`, `child_process` and `crypto` stubs, `process`/`Buffer` globals |
| `scripts/gen_assets.mjs` | Writes `gen/assets.ts` (`base.bend`, the effects' `.js`, the operator table read from `bend.ts`, version and commit) and `gen/c_effects.json` (the effects' `.c`/`.h`, for the C output only) |
| `scripts/gen_examples.mjs` | Writes `gen/examples.json`: guide snippets, demos and `ex/` files, titles, notes and groups in every language |
| `build.sh` | esbuild → `dist/bend-core.js` (IIFE global `BendCore`) |
| `scripts/build_html.mjs` | Renders `GUIDE.md`, compresses `gen/c_effects.json` (deflate-raw, base64), splices `opcall.js` and `agent.js` into `app.js`, fills `src/index.template.html` → `dist/index.html` |
| `src/app.js` | The whole interface, one IIFE, sectioned by `// Name` headers |
| `src/opcall.js` | Operators ⇄ calls: the infix table's climbing, the namespace walk, printing with the fewest parentheses; spliced at `/*__OPCALL__*/` |
| `src/agent.js` | The agent mode: tools, locks, the two loops, the trace, past sessions, its pane; spliced at `/*__AGENT__*/` |
| `src/i18n.js` | `window.BEND_LANGS = { en, fr, pt }`; values are strings or functions |
| `src/index.template.html` | The page's markup, with one About per language (`about-en`, `about-fr`, `about-pt`) |
| `src/style.css` | Tokens for light and dark, mobile layout first, `min-width: 900px` for two columns |
| `src/runner-prelude.js` | The host a compiled program expects (process, `require("fs")`, `BEND_SYS`), plus the Window display loop |
| `src/runner-tail.js` | Appended after a compiled program that opens a Window: replaces `io_exit` and the `Window.*` effects |
| `ex/` | Programs written for the page: FizzBuzz, a JS foreign effect, the bounty |
| `tests/node/` | `examples`, `guide`, `opcall`, `i18n` (in `npm test`); `core` (a quick look at the bundle); `run` (the harness the others share) |
| `tests/e2e/` | One Playwright script per feature, named for it; `serve.py` serves `dist/` with an optional CSP and gives `shot()` and `fixture()`; `run_all.py` runs them |

`../bend` must be a clone of bendlang/bend at the commit in `BEND_COMMIT`
(the full hash): `core/entry.ts`, the scripts and the tests read it there.

## Build and publish

```sh
git clone https://github.com/bendlang/bend ../bend
git -C ../bend checkout "$(cat BEND_COMMIT)"
npm ci                                               # esbuild
npm run build                                        # → dist/index.html
npm test                                             # examples, guide snippets, conversions, languages
npm run e2e                                          # the Playwright scripts (python3, playwright)
```

The build is reproducible: the same Bend commit gives the same file (the
commit is abbreviated to 7 characters whatever the clone's depth).

- **GitHub Pages.** `.github/workflows/pages.yml` runs on every push to `main`
  (and by hand): it checks out the workshop in `workshop/` and Bend, at the
  commit in `BEND_COMMIT`, in `bend/` beside it, then `npm ci`, `npm run build`
  and `npm test`. It uploads `dist/index.html` alone as the site and deploys
  it. Pull requests are built and tested, not published. Run by hand, it
  takes a `bend_ref` (a commit, tag or branch) to try a newer Bend without
  pinning it. Pages must be set once to the source "GitHub Actions" in the
  repository's settings. Dependabot keeps the actions and esbuild current.
- **On Pages** the page is served over HTTPS under `/<repo>/`, with no CSP:
  workers, `eval`, downloads of any extension, and direct requests to AI
  providers and the hub (as their CORS allows) all work. Claude through the
  `sample` capability exists only in claude.ai's viewer. Storage
  (localStorage, IndexedDB) belongs to the origin `https://<user>.github.io`,
  which every Pages site of that user shares; the keys all start with
  `bend-play:` and the database is `bend-workshop`.
- **claude.ai's viewer.** Update the existing artifact (keep its URL) with
  favicon 🔀, title "Bend 2 pocket workshop", and capabilities
  `{downloads: true, sample: {}}`. `downloads` exports zips from the viewer;
  `sample` gives the assistant the viewer's Claude.
- Hand out the standalone file too: it is `dist/index.html`.

## Runtime

**Checker.** The bundle runs in a worker made from the page's own copy of its
source, as a blob URL. Without workers it runs on the page, serialized. Stop is
`terminate`. A stack overflow in the worker gets one retry on the page, whose
stack is larger (the emitter recurses deep on big programs).

The in-memory FS has three roots: `/work/` for the workspace (cleared per run),
`/bend/bend2/` for Base and the effects, `/home/.bend/lib/` for hub files (kept
across runs; the page sends them once per worker).

**Running.** A compiled program becomes the source of its own worker, wrapped
in `runner-prelude.js`. Output is batched; Stop is `terminate`. Without workers
it runs through `new Function`, then a `<script>` tag. `IO.args()` gets the
Settings arguments, after the program name.

**Windows.** The official JS IO loop never yields, so a worker running it
cannot hear the page. A program that opens a `Window` therefore gets
`runner-tail.js`: an async copy of `io_run` that yields between frames, and its
own `Window.open/frame/set_title/close`. Like `io_run` since 2.0.35, the copy
fires a due timer even while computations keep the loop busy (it looks at
its waits, kept in deadline order by `io_park_on`, at each yield). Frames are quadtrees rasterized as
`window_pix` does (2^k square, tl/tr/bl/br, `0xRRGGBB`), posted with a pool of
transferred buffers, at 60 Hz. Key codes follow the native table (lower-case
character, arrows from 63232, modifiers past 65536); a held key repeats as
up-then-down, like X11. On the page, without workers, the same loop runs
cooperatively and Stop is a flag read each frame.

> **Coupling.** `runner-prelude.js` and `runner-tail.js` mirror internals of
> the JS runtime in `comp.ts`: `io_run`, `io_park_on`, `io_push`, `io_wake`,
> the `$0eff` table keyed by def name, `BEND_SYS.select`, how `Bool` is
> represented, how the loop orders its waits and when it looks at them. Check
> them first on every Bend upgrade: `timers_busy` runs Bend's own
> `tests/io/within_busy.bend` through both loops.

## Checking (entry.ts)

- **Every goal.** The checker stops at the first `?name`. `run` swaps the hole
  for `?TODO` and checks again until done. Columns are mapped back to the
  user's text (`col_back`), and so is the excerpt with its caret. Past 48 goals
  or 4 s, the goals found so far are returned, marked partial.
- **What a goal carries.** Context as printed, plus each variable's quantity
  read from `err.ctx` (the printer omits it), plus the normal form when it
  differs.
- **Verdict.** It mirrors `cli_verdict`/`book_promises`: PASS, or FAIL with the
  defs that rely on `@unsafe` or foreign code.
- **`bendtt`.** It runs `safe_emit` (pure TS) to show what `--verdict` would
  hand the kernel, and which defs it cannot express. The kernel itself is Lean
  and out of a page's reach: claims, the bounty included, need the CLI.

## Compiler outputs

The "Compiled" tab shows what `bend f.bend -o f.<ext>` would write for the
open file (or, from a `.js` or hub file, the last `.bend` file opened). Four
targets, all pure TypeScript, so all within the page's reach:

| Target | From | Note |
|---|---|---|
| JS | `js_book` | needs a `main`; "With the runtime" shows the whole file, else the part between `// Program` and `// Cli` |
| JS module | `js_lib(book, true)` | an ES module exporting each callable def; works for a library, no `main` needed |
| C | `compile_book` | needs a `main`; one file, runtime and program interleaved, so always shown whole |
| BendTT | `safe_emit` | what `--verdict` hands the kernel, headed by the defs out of its scope and those relying on unsafe or foreign code |

- **Lazy.** Nothing is built unless the tab is shown. Only the target picked
  is built. While the tab is shown, typing marks the output stale (dimmed)
  and rebuilds it 1.2 s after typing stops. A tab hidden builds nothing. Each
  output is cached by target, entry and the files' hash (6 kept), so going
  back to a target is instant; JS built by a Run is reused.
- **The C sources.** `compile_book` reads the effects' `.c` sources, which
  nothing else needs. They are kept out of the bundle, carried in the page
  compressed (about 24 KB), and unpacked (`DecompressionStream`) and sent to
  the checker only the first time C is asked for, once per worker. The C
  backend itself (about 94 KB of the bundle) cannot be split off without a
  second copy of Bend's core, so it ships, unused until asked.
- **Errors.** A hole (`?name` or `?TODO`) or a missing `main` gets a plain
  message; any other error, the checker's.
- **Actions.** Copy, and Download with the target's extension. The viewer's
  `downloads` allowlist refuses `.js`, `.c` and `.bendtt`, so there Download
  reports it and Copy remains.
- **Out of reach.** A native binary needs clang; the WASM page of PR #866
  needs emcc.

## Editor

- **Layers.** A transparent `<textarea>` sits over a highlighted `<pre>` and a
  marks layer that underlines the exact error span. Line height is an integer
  in pixels, so the layers never drift. iOS gets a 3 px padding correction.
- **Typing.** Enter auto-indents after `:`. Tab and Shift-Tab shift by 2.
  Smart quotes and dashes from phone keyboards are turned back into ASCII. The
  key bar inserts through `execCommand`, so undo keeps working.
- **Live check.** The live check runs 380 ms after typing stops. A
  `PROOF.bend` in the workspace is checked too, which drives the "laws" badge.
- **Declarations come from the text, not the checker** (`decl_scan`), so
  signatures still work while a file does not check. A declaration runs until
  the next line at column 0, except a `)` closing a multi-line header.

## Goal cards (the proof interface)

One card per hole, under the editor. Each card shows the context (name, then
type), the goal after `⊢`, and a toolbar.

- **Layout.** Types are laid out to the card's width by `pp`. An equality puts
  `{  a` / `== b` / `: T}` on aligned lines; an application breaks one argument
  per line; `->` and `&` break too. Nothing is cut inside a name. Past 8 lines
  a goal folds to 5 with "+N lines"; a tap unfolds it, and hover shows it whole
  in a floating block. The Output pane uses the same layout.
- **Kept cards.** When a hole is replaced, its card stays ("hole replaced, goal
  kept") until the checker gets past the declaration it was in. *Pin* keeps a
  card beyond that. The card for the declaration under the caret is marked and
  scrolled into view.
- **Constructors / Solve.** A goal lists the terms its type is built from:
  constructors with a fresh hole per field, `{==}` for an equality, a pair,
  `0n`/`1n+?`, `[]`/`?h <> ?t`. Every candidate is tried in the checker in
  place of the hole. When exactly one fits and leaves no hole, the button reads
  *Solve* and fills the hole directly. Trying runs by itself after a check when
  the file checks in under 400 ms, at most 24 tries per pass, nearest card
  first. Otherwise the button is dashed (`Constructors…`) and tries on a tap.
- **Split.** Tick variables, then *Match*: one `match a b:` over the product of
  their constructors (`Nat`/`List`/`String` sugar, a pair as `Tuple{a, b}`),
  with a named hole per case. It needs the hole alone on its line and at most
  64 cases. When it does not apply the button is dimmed, and a tap says why.
- **Lemma.** Tick variables, name the lemma, *Extract*. The variables the goal
  names, and those named by the types of ticked ones, are locked in. Parameters
  keep their quantity (`-x`, `+n`). The lemma goes above the enclosing
  declaration, and above its law and comments, since safe code may only name
  what is above it. Its header is laid out like the demos'; if that misreads,
  it falls back to one line. The hole becomes the call. The result is checked
  before anything is written. The lemma's hole keeps the original hole's name,
  so the card follows it.
- **AI.** See *Assistant* below.
- **Law ⇄ def** (from a signature's sheet). It splits a typed def into
  `law` + an untyped `def`, with the claim laid out, or merges them back. It is
  refused with `exs`/`where` or `~` parameters.
- **`#goal:` marks.** A comment line `#goal:` is filled with the goal at that
  point. Each mark is probed in turn: it becomes a hole and the rest of its
  block goes. Marks refresh on Check and Run only, never while typing. A key on
  the key bar inserts one.

## Signatures and navigation

- **Signature bar.** The bar under the editor follows the caret. It shows the
  enclosing call with the current argument in bold, then the name under the
  caret. A type application `List<…>` gets its parameter marked; the short form
  skips the leading quantity binders.
- **Lookup order.** Names resolve in this order: the file's own declarations,
  then an import alias (workspace file or hub module, relative imports inside
  a package included), then Base. A parameter of the enclosing def takes its
  type from the law when the def is untyped.
- **Operators.** An operator resolves through the infix table of `bend.ts`
  (`Core.INFIX`). `+ - * / %`, bit operations, shifts and comparisons call
  `T.verb` for the `T` of the annotation `(… : T)` around them; `&& || ++ <>`
  call fixed defs. With no annotation, a stand-in explains that Bend will
  refuse the operator and lists the types that define the verb.
- **Sheets and tooltips.** Tapping a row opens a sheet: the declaration, its
  doc comment, then "Go to the definition" / "See in Base", law⇄def,
  operators⇄calls, and the assistant. With a mouse, hovering shows the same
  as a tooltip.
- **Operators ⇄ calls.** `(x + y * 3n : Nat)` and `Nat.add(x, Nat.mul(y, 3n))`
  are one term, so either is offered from the other.
  - *Semantics.* The parser builds the second from the first
    (`parse_term_ops`, then `parse_term_ns`). In parentheses, `: T` only names
    the namespace (`T.verb`, for the head of `T`); it is not a type
    ascription, which is `{e : T}`. So `(a < b : Nat)` is `Nat.is_lt(a, b)`,
    a Bool. The walk handing `T` down goes through the `T.verb` operators and
    `&& || ++`, not into calls, `<>`, `&` or `|`. Any type that defines the
    verb works (`(s + x : Set)` is `Set.add(s, x)`). Literals stay as they are:
    `3` is a U32 in both forms, `3n` a Nat.
  - *From operators* (caret on one): the scope is the nearest enclosing
    `( … : T)` (plain parentheses inside it belong to the same walk), else the
    comma-separated slot or statement. Precedence and associativity come
    from the table, read from `bend.ts` at build time. Inner groups with
    their own annotation stay as they are. A `T.verb` operator with no
    annotation is refused, as Bend refuses it.
  - *From calls* (caret in a call, or on its name before the bracket): the
    two-argument calls of operator defs, widened out to the outermost such
    call, become operators. Fixed defs come first (`Bool.and` is `&&`, not
    `(.&. : Bool)`). The walk is written as one group when it meets one
    namespace, as a group per namespace joined by `&&` and the like when it
    meets several, and without annotation when it meets none. Only the
    parentheses precedence needs are written. A result without a group of its
    own is parenthesized unless it fills an argument or a whole statement.
  - *Checked first:* the change is written only if the verdict stays the same.

## Storage (localStorage, per browser)

| Key | Content |
|---|---|
| `bend-play:v2` | Order of projects, current one, settings (live check, size, language, fonts, AI profiles) |
| `bend-play:p:<id>` | One project: name, files, open file, arguments |
| `bend-play:s:<id>` | Its snapshots |
| `bend-play:hub` | Hub files by path under `~/.bend/lib` |
| `bend-play:v1` | The pre-projects workspace, migrated once and left as a fallback |

- **Scratch projects.** An example or a guide snippet opens as a scratch
  project, kept only if edited.
- **Snapshots.** Taken when the open file checks or leaves only goals, and
  before deletes and restores. Edits within 3 minutes share a slot, except the
  session's first, which is kept intact. Each project keeps 30; when the
  storage is full, the oldest automatic snapshots are pruned.
- **Export.** A zip of the plain files in one folder, so that
  `bend main.bend` runs once unzipped. The writer only stores (no compression);
  the reader inflates through `DecompressionStream`. *Export as .json* gives
  the same project in one file. Following the viewer's `downloads` contract,
  a refused format is reported, not silently swapped for another: the user
  picks the other button. Allowed there: `json`, `md`, `txt`, and `zip` unless
  the platform has turned its second list off.
- **Import.** `.bend`, `.js`, `.zip` or `.json`. A zip of `~/.bend/lib` (it has
  `0x<hash>/` or `names/` entries) goes to the hub cache instead, each package
  checked against its manifest (sha256).

## Hub

- **Paths.** Imports read `0x<hash>/path.bend` or `name@version/path.bend`.
  The checker fetches from hub.bend-lang.com and verifies hashes, as the CLI
  does. Fetched files come back to the page (`lib_new`) and are kept for every
  project: a package is named by its hash and never changes, so a project needs
  the network once.
- **Read-only tabs.** Imported modules, and the modules they import, open as
  read-only tabs (⧉ `Alias · file.bend`). Signatures, hover and "Go to the
  definition" reach into them. A read-only file is never checked or run itself.
- **In the claude.ai viewer** the page cannot reach the hub. The way in is the
  zip of `~/.bend/lib`, made after one run with the CLI. The error message says
  so.

## Assistant

- **Profiles.** Named, each with a provider (`claude` via the viewer's
  `sample` capability, `anthropic`, `openai`, `custom` OpenAI-shaped URL such
  as Ollama or LM Studio), a URL, a model and an optional key. Keys stay in
  localStorage and requests go straight from the browser. The single setting
  of before became the first profile.
- **Models.** The model is picked from the provider's own list (`/v1/models`,
  else `/api/tags`), or typed freely. For Claude, the list is the three
  `modelTier` values.
- **Requests.** Each request is self-contained: the guide (cut to fit), the
  workspace files, the target (a goal with its context, an error, or a
  declaration) and the request text, about 60k characters at most. The answer
  streams in. For a goal, *Insert the code* puts the first code block in place
  of the hole, re-indented. The inserted code is judged by the next live check,
  not checked beforehand (see below).
- **In the viewer** only the Claude profile works; the others need the
  standalone file, and a local server must allow CORS.

## Agent

- **What it is.** The assistant working through tools in the Agent tab. It
  can be started from that tab, from a goal card ("Agent: fill this hole"),
  or from an error ("Agent: fix it"). The tab shows only when a profile can
  call tools: Claude where `sample.limits()` reports `tools`, Anthropic,
  OpenAI, or an OpenAI-shaped server with a tool-calling model.
- **Tools.** `list_files`, `read_file` (project files and `hub:` modules),
  `list_symbols` (what a project file, a hub module or Base declares: name,
  kind, line, and for a constructor its type; Base past 300 symbols answers
  with its namespaces and asks for a prefix), `signature` (a name's type alone,
  as the signature bar writes it, with the law of a def proven by one),
  `lookup` (the whole declaration as the signature bar resolves it), `guide` (a
  section by title; titles are found outside code fences, since Bend comments
  start with `#` too), `list_holes` (every `?name` in the project: file, line,
  enclosing def, whether the agent may fill it and why not, and its goal and
  context when the checker reached it, or why it did not), `edit_file` (an
  exact, unique replacement), `create_file`,
  `fill_hole`, `check`, `run` (a main, 10 s, output capped), and `eval` (an
  expression of a given type, through a copy of the file whose `main` is the
  expression; the file itself does not change). Results are plain JSON, cut
  at 6000 characters. Tool errors go back to the agent as errors; they do not
  end the session.
- **Locks.** Each file can be locked in the tab (kept with the project): the
  agent reads it and cannot write it. Base and hub modules are always
  read-only.
- **Hole sessions.** Started on chosen holes, the session gets no `edit_file`
  or `create_file`: `fill_hole` is its only way to write, the page places the
  code at the hole's indentation itself, and only the session's holes are
  accepted. By default the code may leave sub-holes, which join the session.
  The option "each fill must close its goal" refuses code that holds a `?hole`.
- **Loops.** With Claude in the viewer, a call allows a handful of tool rounds
  and 64 KiB of text. A session is therefore a chain of calls. Each starts from
  a brief: the rules, the task, the project as it stands (files inline up to
  20k characters), a journal of the last 30 tool calls, and two sections of
  the guide (Syntax Reference, Laws and Proofs). The chain goes on while the
  agent ends with `STATUS: continue` and made at least one call. With an API,
  the page runs the loop itself (Anthropic `tool_use`/`tool_result` with the
  system cached; OpenAI `tool_calls`/`tool`), the full guide in the system
  prompt.
- **Control.** Tool calls run one at a time, even when a round asks for
  several. Before the first, a snapshot is taken ("before the agent") and the
  editor turns read-only; the page's own edits (key bar, Split, Lemma, file
  and project sheets) are refused while it works. The step budget pauses
  rather than stops: *Continue* grants as many steps again, *Stop* ends the
  session. The session ends with a check, its verdict shown. *Undo the
  session* restores the snapshot. Agent writes go straight to the text, not
  through the browser's undo stack, so no keyboard opens on a phone; the
  snapshot stands for undo.
- **Taking a session up again.** A session that ended (an error, a stop,
  the agent done or blocked, the API out of breath) can be continued from
  the tab: under its journal, the same settings as a new session (what it
  may change, holes, the close option, locks, the file checked from, the
  profile, the budget), all of them changeable, and instead of the task a
  note on what to do now. *Continue the session* starts a new leg: the
  journal, the trace and the snapshot of the start carry on (Undo still goes
  back to before the whole session; a snapshot is also taken at each leg),
  and steps keep counting. Each leg starts from a fresh brief, with Claude
  as with an API: the rules as they stand now, the task, a `<resumed>`
  section saying why the last leg ended and listing the user's notes, then
  the project and the journal. A conversation that broke or grew too long
  is not sent again, and the profile may change provider. The trace records
  a `resume` event with the settings, the note and the files. A past session
  of the open project (its record keeps the snapshot and the settings) can
  be taken up again too, after a reload: *Continue this session* makes it
  the tab's session.
- **Journal.** It shows the agent's text, each tool call with its target,
  ✓/✗ and the verdict after it, the diff of each write, and the output of each
  run or eval.
- **Trace and export.** Every session also keeps a full trace, for
  debugging: the session's settings (profile without its key, mode, holes,
  locks, budget, tools offered, Bend version, files at the start), each Claude
  call with its exact prompt and reply, each API request (system and tools
  once, then the messages new in each round) with its raw response, each tool
  call with its input and the exact text returned, errors, pauses, stop, undo,
  and the end (verdict, files). It exports any time, during or after the
  session, as `.json` (format `bend-workshop/agent-session/1`, a list of events)
  or `.md` (the same, readable, fences sized past any backticks inside). Keys
  are never recorded: request headers are not traced.
- **Following a session.** Under the task, "Journal" shows the summary above
  and "Conversation" the trace itself, live: each event with its time, the
  long parts (prompts, system, files, raw responses, long results) folded and
  built only when opened. Events are appended as they come, so open folds stay
  open. A count heads both: model calls, characters sent and received,
  duration, and tokens in and out when the API reports `usage` (Anthropic,
  with its cache reads; OpenAI). Claude in the viewer reports no tokens.
- **Past sessions.** Each session, finished or stopped, is kept with its trace
  and journal in IndexedDB (database `bend-workshop`, store `sessions`), the
  last 20. A continued session overwrites its own record. The Agent tab lists them; one can be read again (journal or
  conversation), exported, or deleted. Without IndexedDB, nothing is kept and
  nothing breaks.

## Internationalization

- **Languages.** English (the default), French, and Portuguese (Brazilian,
  `pt-BR` formats). The browser's language picks French or Portuguese on a
  first visit; Settings has a button per language, and the choice is
  remembered.
- **Lookup.** `t(key, ...args)` reads `LANGS[lang]`, falling back to English.
  Static markup carries `data-i18n`, `data-i18n-html`, `data-i18n-aria` and
  `data-i18n-ph`. About is one template per language. Examples carry their
  titles, notes and groups in every language.
- **The assistant and the agent** are asked to answer in the interface's
  language (`LANG_NAMES`). Compiler messages, the guide and example code stay
  in English.
- **Switching.** `lang_set` redraws what is on screen without reloading; what a
  run already printed stays as it was.
- **Snapshots.** Their labels are stored as keys, so history reads in any
  language.
- **Adding a language.** A block in `src/i18n.js` with every key of `en`, a
  button in `settings_sheet`, a `LANG_NAMES` entry, an `about-xx` template, a
  third argument to each `L(...)` in `scripts/gen_examples.mjs`, a guess in
  `lang_guess`. `tests/node/i18n.mjs` fails on a missing key, a text where
  English has a function or the reverse, and a function that throws or
  answers an empty text.

## Testing

- **Node** (`npm test`). `examples.mjs` runs every example, each file as the
  entry, in a `vm` context: it must check, and run if it has a main. It knows
  the exceptions by design (a `LAWS.bend` alone, a `.js` effect, a window with
  no display under Node, the bounty's `?TODO`) and fails on anything else.
  `guide.mjs` runs the guide's snippets. `opcall.mjs` checks the conversions
  and their round trips. `i18n.mjs` checks the languages against English.
- **Playwright** (`npm run e2e`, from the repo root, after a build). Each
  script in `tests/e2e/` drives the page for one feature and prints what it
  sees; screenshots go to `tests/e2e/shots/`. `run_all.py` runs them one by
  one with a deadline, and calls a script failed when it raises or reports a
  page error. It skips the slow ones (`heavy_demos`, minutes) unless given
  `--slow`; names given run alone.
- **The scripts.** Basics: `errors_goals_persist`, `themes_csp`,
  `iframe_sandbox`, `no_storage`, `settings_files_base`,
  `typing_guide_effect_hub`, `projects_zip`, `export_viewer`, `network_audit`,
  `fonts_off`, `languages`, `portuguese`. Windows: `window_demos`,
  `window_mobile`, `window_iframe_csp`, `window_no_worker`,
  `window_page_mode_mobile`, `timers_busy` (Bend's `within_busy` through both
  loops). Proof tools: `goals_signatures`, `kept_goals_tooltip`, `long_goals`,
  `split`, `split_narrow`, `split_disabled`, `constructors`, `solve_lazy`,
  `lemma`, `lemma_mobile`, `lemma_pong`, `lawdef_pong`, `operators`, `opcalls`,
  `sigs_marks_lawdef_ai`. Outputs: `verdict_bendtt`, `compiler_outputs`,
  `heavy_demos`. Hub: `hub` (a fake package with real hashes, from
  `fixtures/make_fakehub.py`). Assistant and agent: `ai_profiles`,
  `agent_claude` (a scripted Claude: hole mode, close option, sub-holes, locks,
  run, eval, lookup, guide, pause, stop, undo), `agent_apis` (simulated
  Anthropic and OpenAI servers), `agent_no_worker`, `agent_holes_export`
  (`list_holes`, exports, no key), `agent_tools` (`list_symbols`,
  `signature`), `agent_trace` (the live conversation, tokens, past sessions
  across a reload), `agent_resume` (a session ended by an API error,
  continued with other settings and a note, then taken up again from the
  past sessions after a reload).
- **Simulating the environment.** `serve.py` takes a CSP to imitate the viewer.
  `?probe_ms=1` forces the deferred Constructors state. `frame_page()` puts a
  sandboxed iframe in front of the page: an opaque origin with no storage.
- **What was never tested.** A real phone (visualViewport, the iOS keyboard),
  the real hub (its CORS), real AI providers (the agent included), and the
  real `sample` and `downloads` capabilities, which were only mocked.

## Upgrading Bend

1. Fetch `../bend`, check out the new commit, `npm run build && npm test`. On
   GitHub, the workflow run by hand with `bend_ref` does the same.
2. Read the CHANGELOG for what touches the page:
   - effect registration (`io_eff`, `CID`)
   - the JS IO loop
   - the verdict and `cli_report`
   - the `err_show` format (Context, Location, caret, note)
   - import paths and namespaces
   - Base renames
   - new Node modules imported by `bend.ts`, `comp.ts` or `safe.ts` (each needs
     a shim)
3. `npm run e2e`; the Window scripts (`window_*`, `timers_busy`) matter most. In 2.0.32 → 2.0.35, the one change the page had to follow was the
   JS loop's (timers fire while busy).
4. Update the examples if Base or the syntax moved, then write the new full
   hash in `BEND_COMMIT` and push: the workflow publishes.

## Known limits and open items

- **The JS lane runs on one core.** `!` and parallel calls run in sequence, and
  the ray tracer takes about 3 s a frame. There is no audio, file, socket or
  stdin.
- **No kernel.** The page cannot run the Lean kernel, so `--verdict` and bounty
  claims need the CLI.
- **WASM/WebGPU** (PR #866 and its playground) needs emcc and COOP/COEP, so it
  is not embeddable. An option on the table is a local bridge (a small bun
  server) that builds and serves WASM; it is not built.
- **One-shot assistant answers are not pre-checked.** *Insert the code* (a
  single answer, outside agent mode) writes and then the live check judges.
  Agent writes are checked as they land, but a session may still end with the
  project failing: the final verdict says so, and the session can be undone.
- **The agent was only tested against scripted models.** Real models were
  not tried: how well a given one uses the tools is unknown, and small local
  models are likely to struggle with tool calls.
- **A lemma can land under a comment.** Inserted below a section comment that
  a blank line separates from its declaration, the lemma sits between the two.
- **`U32` is offered for splitting** because Base defines it as
  `U32{data: Word(32n)}`. That is correct, and rarely useful.
- **The way back cuts annotations to their head.** `(v + w : Vec<n>)` →
  `Vec.add(v, w)` → `(v + w : Vec)`: the same term, since only the head
  names the namespace, but not the same text.
- **Signatures do not cover locals.** Variables bound by `let` or patterns show
  no type; a `?hole` gives the context.
