# The browser's own find scrolls the editor to a match; closing its bar
# resizes the window (on a phone): the editor must stay where the find
# took it, the caret elsewhere. With the editor focused (a keyboard), a
# resize still brings the caret back into view.
import time
from playwright.sync_api import sync_playwright
from serve import serve
serve("dist", 8123)
CODE = "import Base\n\n" + "".join("def f%d() -> Nat:\n  %dn\n\n" % (i, i) for i in range(80))
def check(label, *oks):
    print(label, *oks)
    assert all(o is True for o in oks if isinstance(o, bool)), label
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 390, "height": 780}, locale="en-US", is_mobile=True, has_touch=True).new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000)
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); ta.setSelectionRange(0, 0); ta.blur(); }""", CODE)
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000); time.sleep(0.5)
    # a find took the editor down, the caret stayed at the top
    page.evaluate("document.querySelector('#ed').scrollTop = 1200")
    page.set_viewport_size({"width": 390, "height": 700}); time.sleep(0.4)
    page.set_viewport_size({"width": 390, "height": 780}); time.sleep(0.4)
    top = page.evaluate("document.querySelector('#ed').scrollTop")
    check("1 stays after the find bar closes:", top, top > 1000)
    # editing: a resize (the keyboard) brings the caret back
    page.evaluate("() => { const ta = document.querySelector('#ed-ta'); ta.focus({ preventScroll: true }); ta.setSelectionRange(0, 0); }")
    page.set_viewport_size({"width": 390, "height": 600}); time.sleep(0.4)
    top2 = page.evaluate("document.querySelector('#ed').scrollTop")
    check("2 the caret comes back while editing:", top2, top2 < 100)
    for e in errs: print("!!", e[:200])
    assert not errs
    b.close()
