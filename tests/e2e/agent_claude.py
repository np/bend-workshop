import time, json
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
MOCK = """window.__plan = []; window.__seen = []; window.__sizes = [];
window.claude = { use: async (n) => n === 'sample' ? Object.assign(async (input, opts) => {
  window.__sizes.push(input.length);
  const tools = opts.tools || [];
  const call = async (name, args) => { const tl = tools.find(t => t.name === name); if (!tl) return 'NO TOOL ' + name;
    try { return await tl.execute(args, { signal: opts.signal }); } catch (e) { return 'Error: ' + e.message; } };
  const steps = window.__plan.shift() || [];
  const log = [];
  for (const [name, args] of steps) log.push(name + ' => ' + String(await call(name, args)).replace(/\\s+/g, ' ').slice(0, 220));
  window.__seen.push({ tools: tools.map(t => t.name), log });
  const text = 'Did my part.\\nSTATUS: ' + (window.__plan.length ? 'continue' : 'done');
  if (opts.onText) opts.onText({ text, delta: text });
  return { text, truncated: false };
}, { limits: async () => ({ tools: { maxCount: 16 }, maxPromptBytes: 65536 }), json: async () => ({}) }) : null };"""
PROOF = "import Base\n\nlaw add_zero:\n  for x: Nat\n  {Nat.add(x, 0n) == x : Nat}\n\ndef add_zero(x):\n  match x:\n    case 0n:\n      ?base\n    case 1n+p:\n      ?step\n"
def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
def code(page): return page.evaluate("document.querySelector('#ed-ta').value")
def wait_done(page):
    page.wait_for_selector(".ag-verdict", timeout=30000); time.sleep(0.4)
def seen(page):
    s = page.evaluate("window.__seen"); page.evaluate("window.__seen = []"); return s
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e) + " @ " + (e.stack or "")[:600].replace("\n", " | ")))
    page.add_init_script(MOCK)
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1.2)
    page.click("#btn-settings"); page.locator(".ai-box .btn", has_text="New profile").click(); time.sleep(0.4); page.click(".sheet-head button")
    print("0 agent tab visible:", page.locator(".tab[data-tab=agent]").is_visible())
    set_code(page, PROOF); page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(1.0)

    # 1. hole mode, from the ?base card: only fill_hole, only ?base
    page.locator(".goal", has_text="?base").locator(".goal-head .chip", has_text="AI").click(); time.sleep(0.3)
    page.click(".sheet .btn:has-text('Agent: fill this hole')"); time.sleep(0.4)
    print("1 pane:", page.locator("#pane-agent .chip.on").inner_text(), "| holes:", page.locator(".agent-holes").inner_text().replace("\n", " "))
    page.evaluate("""window.__plan = [[['check', {}], ['edit_file', {path: 'main.bend', old_text: 'x', new_text: 'y'}], ['fill_hole', {hole: 'step', code: '{==}'}], ['fill_hole', {hole: 'base', code: '{==}'}]]]""")
    page.click(".agent-form .btn:has-text('Start')")
    wait_done(page)
    s = seen(page)
    print("1 tools offered:", s[0]["tools"])
    for l in s[0]["log"]: print("   ", l[:200])
    print("1 text:", repr(code(page).split("case 0n:\n")[1][:40]), "| final:", page.inner_text(".ag-verdict"))
    print("1 journal:", [x.replace("\n", " ")[:60] for x in page.locator(".ag-tool").all_inner_texts()])
    page.screenshot(path=shot("shot_agent1.png"))

    # 2. close the goal: a fill with a hole is refused
    page.click(".agent-end .btn:has-text('New session')"); time.sleep(0.3)
    page.locator(".agent .chip", has_text="Only chosen holes").click(); time.sleep(0.2)
    page.locator(".agent-holes label", has_text="?step").locator("input").check()
    page.locator(".agent .check", has_text="close its goal").locator("input").check()
    page.evaluate("""window.__plan = [[['fill_hole', {hole: 'step', code: '%add_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}\\n?inner'}]]]""")
    page.click(".agent-form .btn:has-text('Start')"); wait_done(page)
    print("2 close:", seen(page)[0]["log"][0][:160])

    # 3. sub-holes allowed: the new hole becomes the session's, a second call fills it
    page.click(".agent-end .btn:has-text('New session')"); time.sleep(0.3)
    page.locator(".agent .chip", has_text="Only chosen holes").click(); time.sleep(0.2)
    page.locator(".agent-holes label", has_text="?step").locator("input").check()
    page.locator(".agent .check", has_text="close its goal").locator("input").uncheck()
    page.evaluate("""window.__plan = [[['fill_hole', {hole: 'step', code: '%add_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}\\n?inner'}]], [['list_files', {}], ['fill_hole', {hole: 'inner', code: '{==}'}]]]""")
    page.click(".agent-form .btn:has-text('Start')"); wait_done(page)
    s = seen(page)
    print("3 call 1:", s[0]["log"][0][:200])
    print("3 call 2:", [l[:140] for l in s[1]["log"]])
    print("3 final:", page.inner_text(".ag-verdict"), "| sizes:", page.evaluate("window.__sizes"))
    page.click(".agent-end .btn:has-text('Undo the session')"); time.sleep(0.8)
    print("3 undone:", "?step" in code(page) and "?inner" not in code(page))

    # 4. project mode, a locked file, run, eval, lookup, guide
    page.evaluate("""() => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, 'import Base\\n\\ndef double(+n: Nat) -> Nat:\\n  Nat.add(n, n)\\n\\ndef main() -> IO(Unit):\\n  do IO<Unit>:\\n    IO.print(\"hi\")\\n'); }"""); time.sleep(1.2)
    page.click(".file-add"); page.fill(".form input[type=text]", "lib.bend"); page.click("text=Create the file"); time.sleep(0.6)
    page.locator(".file", has_text="main.bend").click(); time.sleep(0.4)
    page.click(".tab[data-tab=agent]"); time.sleep(0.3)
    page.click(".agent-end .btn:has-text('New session')") if page.locator(".agent-end").count() else None
    page.locator(".agent .chip", has_text="The project").click(); time.sleep(0.2)
    page.locator(".agent-files .chip", has_text="lib.bend").click(); time.sleep(0.2)
    print("4 locks:", page.locator(".agent-files").inner_text().replace("\n", " "))
    page.evaluate("""window.__plan = [[['edit_file', {path: 'lib.bend', old_text: 'import Base', new_text: 'x'}],
      ['edit_file', {path: 'main.bend', old_text: 'IO.print("hi")', new_text: 'IO.print(U32.show(7))'}],
      ['run', {}], ['eval', {expr: 'double(21n)', type: 'Nat'}], ['lookup', {name: 'Nat.add'}], ['guide', {section: 'Laws'}], ['create_file', {path: 'x.bend', text: 'import Base\\n'}]]]""")
    page.click(".agent-form .btn:has-text('Start')"); wait_done(page)
    for l in seen(page)[0]["log"]: print("   4", l[:170])
    print("4 files:", [x.strip() for x in page.locator(".file").all_inner_texts()], "| lib locked untouched:", "x" != page.evaluate("JSON.parse(localStorage.getItem('bend-play:p:' + JSON.parse(localStorage.getItem('bend-play:v2')).current)).files.find(f => f.name === 'lib.bend').text"))
    page.screenshot(path=shot("shot_agent4.png"))

    # 5. pause at the budget, continue, then stop at the next pause
    page.click(".agent-end .btn:has-text('New session')"); time.sleep(0.3)
    page.fill("#agent-budget", "2")
    page.evaluate("""window.__plan = [[['check', {}], ['check', {}], ['check', {}], ['check', {}], ['check', {}]]]""")
    page.click(".agent-form .btn:has-text('Start')"); time.sleep(1.5)
    print("5 paused:", page.locator(".agent-run").inner_text().replace("\n", " "))
    page.click(".agent-run .btn:has-text('Continue')"); time.sleep(1.5)
    print("5 paused again:", page.locator(".agent-run").inner_text().replace("\n", " "))
    page.click(".agent-run .btn:has-text('Stop')"); wait_done(page)
    print("5 stopped:", [l[:60] for l in seen(page)[0]["log"]])
    # the editor is read-only while it runs, and the page's own edits are refused
    print("6 editable again:", not page.evaluate("document.querySelector('#ed-ta').readOnly"))
    for e in errs: print("!!", e[:300])
    b.close()
