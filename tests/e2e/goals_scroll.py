# The goals list keeps its place while checks and probes repaint it: a
# list scrolled down stays there after an edit, and a field being typed
# in (the Rewrite equality) keeps the focus and its text.
import time
from playwright.sync_api import sync_playwright
from serve import serve
serve("dist", 8123)
CODE = "import Base\n\n" + "".join("def f%d(x: Nat) -> {Nat.add(x, 0n) == x : Nat}:\n  ?h%d\n\n" % (i, i) for i in range(12))
def check(label, *oks):
    print(label, *oks)
    assert all(o is True for o in oks if isinstance(o, bool)), label
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000)
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", CODE)
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(2.0)
    page.evaluate("document.querySelector('#ed-ta').blur()")
    page.evaluate("document.querySelector('#goals-list').scrollTop = 99999"); time.sleep(0.2)
    before = page.evaluate("document.querySelector('#goals-list').scrollTop")
    # an edit at the top: a new check, new probes, repaints
    page.evaluate("""() => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.setSelectionRange(12, 12); document.execCommand('insertText', false, '# a comment\\n'); ta.blur(); }""")
    time.sleep(3.0)
    after = page.evaluate("document.querySelector('#goals-list').scrollTop")
    check("1 scroll kept:", before, after, before > 100 and abs(after - before) < 40)
    # typing in a card's field while repaints come
    page.locator(".goal").last.locator(".goal-head .chip", has_text="Rewrite").click(); time.sleep(0.3)
    inp = page.locator(".rw input")
    inp.click(); page.keyboard.type("add_z")
    # the code changes under it (as the agent or another file would): a
    # check, probes, repaints, while the typing goes on
    page.evaluate("""() => { const ta = document.querySelector('#ed-ta'); ta.value = ta.value + '\\n# more\\n'; ta.dispatchEvent(new Event('input', { bubbles: true })); }""")
    for ch in "ero(x)":
        page.keyboard.type(ch); time.sleep(0.25)
    time.sleep(1.0)
    check("2 typing kept:", page.locator(".rw input").input_value() == "add_zero(x)",
          page.evaluate("document.activeElement && document.activeElement.closest('.rw') !== null"))
    for e in errs: print("!!", e[:200])
    assert not errs
    b.close()
