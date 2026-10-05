import time
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    for name, code in [("not alone", "import Base\n\ndef f(n: Nat) -> Nat:\n  1n+?h\n"), ("nothing to split", "import Base\n\ndef f(g: U32 -> U32) -> U32:\n  ?h\n")]:
        set_code(page, code); page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(1.2)
        sp = page.locator(".goal-head .chip", has_text="Split")
        print(name, "| visible:", sp.is_visible(), "| aria-disabled:", sp.get_attribute("aria-disabled"), "| title:", sp.get_attribute("title"))
        sp.dispatch_event("click"); time.sleep(0.3)
        print("   tap →", page.inner_text(".toast")[:80], "| picking boxes:", page.locator(".goal-body input").count())
    b.close()
