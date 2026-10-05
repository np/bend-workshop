import os, time
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8124, csp="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; worker-src 'none'")
MOCK = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent_claude.py")).read().split('MOCK = """', 1)[1].split('"""', 1)[0]
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.add_init_script(MOCK)
    page.goto("http://localhost:8124/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1.2)
    page.click("#btn-settings"); page.locator(".ai-box .btn", has_text="New profile").click(); time.sleep(0.4); page.click(".sheet-head button")
    page.click(".tab[data-tab=agent]"); time.sleep(0.4)
    page.evaluate("""window.__plan = [[['run', {}], ['eval', {expr: 'Nat.add(2n, 3n)', type: 'Nat'}], ['eval', {expr: 'do IO<Unit>:\\n  IO.print("from eval")', type: 'IO(Unit)'}]]]""")
    page.click(".agent-form .btn:has-text('Start')"); page.wait_for_selector(".ag-verdict", timeout=30000); time.sleep(0.4)
    for l in page.evaluate("window.__seen")[0]["log"]: print(l[:160])
    for e in errs: print("!!", e[:200])
    b.close()
