# Format (the file's sheet, and Shift+Alt+F): Bend's own formatter, checked
# first, one Undo; an already formatted file says so.
import time
from playwright.sync_api import sync_playwright
from serve import serve
serve("dist", 8123)
MESSY = "import Base\n\n# doubles\ndef double(+n:Nat)->Nat:\n   Nat.add( n,n )   # twice\n\ndef main() -> Nat:\n      double(  2n)\n"
def check(label, ok, *more):
    print(("ok   " if ok else "!! FAIL ") + label, *[repr(m)[:400] for m in more])
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 390, "height": 800}, locale="en-US").new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000)
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", MESSY)
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000); time.sleep(0.4)
    code = lambda: page.evaluate("document.querySelector('#ed-ta').value")
    page.evaluate("document.querySelector('.file.on, .file[aria-selected=true]').click()"); time.sleep(0.4)
    page.locator(".sheet .btn", has_text="Format").click(); time.sleep(1.5)
    got = code()
    print(got)
    check("formatted: indentation and spacing", "def double(+n: Nat) -> Nat:\n  Nat.add(n, n)  # twice\n" in got and "\n  double(2n)\n" in got, got)
    check("comments kept", "# doubles" in got and "# twice" in got)
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    page.locator("#ed-ta").focus(); page.keyboard.press("Control+z"); time.sleep(0.6)
    check("one Undo brings it back", code() == MESSY, code())
    page.locator("#ed-ta").focus(); page.keyboard.press("Shift+Alt+F"); time.sleep(1.5)
    check("Shift+Alt+F formats too", code() == got)
    page.keyboard.press("Shift+Alt+F"); time.sleep(1.0)
    check("again: already formatted", "Already formatted" in page.inner_text("#status"), page.inner_text("#status"))
    for e in errs: print("!!", e[:300])
    b.close()
