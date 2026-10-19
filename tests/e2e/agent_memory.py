"""The agent's memory, as UniiChat's: each Claude call gets the view of the
project's chat (<chat>), zoom opens a line, the memory outlives a session and
a reload, a small budget merges lines through the compactor (Claude's quick
tier), the prompt stays under what sample.limits() reports, the Memory view
in the tab, forgetting it and Undo."""
import time
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
MOCK = """window.__plan = []; window.__inputs = []; window.__says = []; window.__got = []; window.__compactions = 0;
window.claude = { use: async (n) => n === 'sample' ? Object.assign(async (input, opts) => {
  if (opts.modelTier === 'quick' && !opts.tools) { window.__compactions++; return { text: 'summary line ' + window.__compactions, truncated: false }; }
  window.__inputs.push(input);
  const tools = opts.tools || [];
  const call = async (name, args) => { const tl = tools.find(t => t.name === name);
    try { const r = await tl.execute(args, { signal: opts.signal }); window.__got.push([name, r]); return r; } catch (e) { window.__got.push([name, 'Error: ' + e.message]); return 'Error: ' + e.message; } };
  for (const [name, args] of (window.__plan.shift() || [])) await call(name, args);
  const text = window.__says.shift() || 'Done.\\nSTATUS: done';
  if (opts.onText) opts.onText({ text, delta: text });
  return { text, truncated: false };
}, { limits: async () => ({ tools: { maxCount: 16 }, maxPromptBytes: window.__maxp || 262144 }), json: async () => ({}) }) : null };"""
PROOF = "import Base\n\nlaw add_zero:\n  for x: Nat\n  {Nat.add(x, 0n) == x : Nat}\n\ndef add_zero(x):\n  match x:\n    case 0n:\n      ?base\n    case 1n+p:\n      ?step\n"

def check(label, *oks):
    print(label, *oks)
    assert all(o is True for o in oks if isinstance(o, bool)), label

def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)

def run(page, plan, says, task="Prove add_zero."):
    page.evaluate("([p, s]) => { window.__plan = p; window.__says = s; window.__inputs = []; window.__got = []; }", [plan, says])
    if page.locator(".agent-end .btn:has-text('New session')").count():
        page.click(".agent-end .btn:has-text('New session')"); time.sleep(0.3)
    page.fill(".agent-form textarea", task)
    page.click(".agent-form .btn:has-text('Start')")
    page.wait_for_selector(".ag-verdict", timeout=30000); time.sleep(0.6)
    return page.evaluate("window.__inputs")

def chat_of(prompt):
    return prompt[prompt.index("<chat>\n"):prompt.index("\n</chat>")]

def open_page(b, init=""):
    ctx = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US")
    ctx.add_init_script(init + MOCK)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1.2)
    return ctx, page

errs = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx, page = open_page(b)
    page.click("#btn-settings"); page.locator(".ai-box .btn", has_text="New profile").click(); time.sleep(0.4)
    page.click(".ai-limits > summary"); time.sleep(0.2)
    labels = page.locator(".ai-limits label").all_inner_texts()
    defaults = page.eval_on_selector_all(".ai-limits input", "xs => xs.map(x => x.placeholder)")
    check("1 limits:", labels, defaults, defaults == ["40000", "6000", "48000", "8000"])
    page.click(".sheet-head button")
    set_code(page, PROOF); page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(1.0)
    page.click(".tab[data-tab=agent]"); time.sleep(0.3)

    # 2 one session, two calls: the second sees the first in its memory, and zooms
    plan = [[["lookup", {"name": "Nat.add"}], ["read_file", {"path": "main.bend"}], ["check", {}]],
            [["zoom", {"id": 2}], ["fill_hole", {"hole": "base", "code": "{==}"}]]]
    says = ["Looked around.\nNEXT: fill ?base with {==}, then ?step by induction.\nSTATUS: continue", "Filled ?base.\nSTATUS: done"]
    ins = run(page, plan, says)
    first, second = ins[0], ins[1]
    c1, c2 = chat_of(first), chat_of(second)
    check("2 first call: the session note and the task in <chat>", "0+1|note: A session starts" in c1, "1+1|user: Prove add_zero." in c1)
    check("2 second call: what the first did", "tool: lookup" in c2, "tool: read_file" in c2, "agent: Looked around." in c2, "fill ?base with {==}" in c2)
    check("2 the rule says what <chat> is", "<chat> is your memory" in second, "<task>\nProve add_zero." in second)
    got = page.evaluate("window.__got")
    zoom = [r for n, r in got if n == "zoom"][0]
    check("2 zoom(2) gives the lookup whole", '"kind": "tool"' in zoom, "Nat.add" in zoom)

    # 3 a new session sees the first one, its end and its verdict
    ins = run(page, [[["check", {}]]], ["Checked.\nSTATUS: done"], task="What is left?")
    c = chat_of(ins[0])
    check("3 next session remembers:", "fill_hole" in c, "note: The session ends after" in c, "user: What is left?" in c)

    # 4 the memory survives a reload
    time.sleep(0.8)
    page.reload(); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1.2)
    page.click(".tab[data-tab=agent]"); time.sleep(0.5)
    ins = run(page, [[]], ["Nothing to do.\nSTATUS: done"], task="Still there?")
    c = chat_of(ins[0])
    check("4 after a reload:", "Looked around." in c, "user: What is left?" in c)

    # 5 the Memory view: the lines, opened down to a message
    page.locator(".agent-modes .chip", has_text="Memory").click(); time.sleep(0.3)
    stats = page.inner_text(".mem > p")
    rows = page.locator(".mem-lines > .mem-row").count()
    page.locator(".mem-lines > .mem-row > summary").nth(1).click(); time.sleep(0.2)
    opened = page.locator(".mem-lines > .mem-row[open] .cv-pre").first.inner_text()
    check("5 memory view:", stats, rows > 10, "Prove add_zero." in opened)
    page.screenshot(path=shot("shot_agent_memory_view.png"))

    # 6 a small budget: lines merge, through the compactor
    page.click("#btn-settings"); time.sleep(0.3)
    if page.locator(".ai-limits").get_attribute("open") is None:
        page.click(".ai-limits > summary")
    page.locator(".ai-limits label", has_text="memory").locator("input").fill("2500"); time.sleep(0.2)
    page.click(".sheet-head button")
    page.locator(".agent-modes .chip", has_text="Journal").click(); time.sleep(0.2)
    ins = run(page, [[["list_holes", {}]]], ["Listed.\nSTATUS: done"], task="List the holes.")
    c = chat_of(ins[0])
    import re
    spans = [int(m) for m in re.findall(r"^\d+\+(\d+)\|", c[7:], re.M)]
    n = page.evaluate("window.__compactions")
    check("6 merged:", spans[:4], max(spans) >= 4, len(c.encode()) <= 2500 + 600, "| compactions:", n, n > 0, "summary line" in c)

    # 7 forgetting, and Undo
    page.locator(".agent-modes .chip", has_text="Memory").click(); time.sleep(0.3)
    page.locator(".mem .btn", has_text="Forget").click(); time.sleep(0.4)
    empty = page.locator(".mem .empty").count() == 1
    page.locator(".toast button", has_text="Undo").click(); time.sleep(0.4)
    back = page.locator(".mem-lines > .mem-row").count()
    check("7 forget, then undo:", empty, back > 0)
    ctx.close()

    # 8 the prompt stays under what sample.limits() reports: the files go first
    ctx, page = open_page(b, "window.__maxp = 40000;\n")
    page.click("#btn-settings"); page.locator(".ai-box .btn", has_text="New profile").click(); time.sleep(0.4)
    page.click(".sheet-head button")
    set_code(page, PROOF + "\n" + "".join("# padding line %05d, to make the file large enough\n" % i for i in range(600)))
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(1.0)
    page.click(".tab[data-tab=agent]"); time.sleep(0.3)
    ins = run(page, [[]], ["Done.\nSTATUS: done"])
    size = len(ins[0].encode())
    check("8 under the reported cap:", size, size <= 32000, "| files sent away:", "<files>\n" not in ins[0], "too large to quote" in ins[0])
    for e in errs: print("!! " + e)
    b.close()
