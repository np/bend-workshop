# The agent's list_symbols and signature tools, through a scripted Claude.
import os, time, json
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
MOCK = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent_claude.py")).read().split('MOCK = """', 1)[1].split('"""', 1)[0]
CODE = "import Base\n\n# Doubles.\ndef double(+n: U32) -> U32:\n  (n + n : U32)\n\ntype Shape is Data:\n  Circle{r: U32}\n  Square{s: U32}\n\nlaw zero:\n  for x: Nat\n  {Nat.add(x, 0n) == x : Nat}\n\ndef zero(x):\n  match x:\n    case 0n:\n      {==}\n    case 1n+p:\n      %zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}\n      {==}\n"
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.add_init_script(MOCK)
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1.2)
    page.click("#btn-settings"); page.locator(".ai-box .btn", has_text="New profile").click(); time.sleep(0.4); page.click(".sheet-head button")
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", CODE); time.sleep(1.2)
    page.click(".tab[data-tab=agent]"); time.sleep(0.3)
    page.evaluate("""window.__plan = [[['list_symbols', {module: 'main.bend'}], ['list_symbols', {module: 'Base'}], ['list_symbols', {module: 'Base', prefix: 'List.'}],
      ['signature', {name: 'double'}], ['signature', {name: 'Circle'}], ['signature', {name: 'zero'}], ['signature', {name: 'Nat.add'}], ['signature', {name: 'Shape'}], ['signature', {name: 'nope'}]]]""")
    page.click(".agent-form .btn:has-text('Start')"); page.wait_for_selector(".ag-verdict", timeout=30000); time.sleep(0.3)
    for l in page.evaluate("window.__seen")[0]["log"]:
        print(l[:200])
    for e in errs: print("!!", e[:200])
    b.close()
