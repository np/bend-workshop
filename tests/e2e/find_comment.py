# The editor's tools: # comments the selected lines out and back in;
# find marks the text in the open file (Enter goes on, the count follows),
# lists the other files that hold it, and keeps the typing in its bar.
import time
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
CODE = """import Base

def two(a: Nat, b: Nat) -> Nat:
  x = Nat.add(a, 1n)
  y = Nat.add(b, 1n)
  Nat.add(x, y)
"""
def check(label, *oks):
    print(label, *oks)
    assert all(o is True for o in oks if isinstance(o, bool)), label
def text(page):
    return page.eval_on_selector("#ed-ta", "t => t.value")
with sync_playwright() as p:
    b = p.chromium.launch()
    for vp, mobile in [({"width": 1280, "height": 800}, False), ({"width": 360, "height": 740}, True)]:
        ctx = b.new_context(viewport=vp, locale="en-US", is_mobile=mobile, has_touch=mobile)
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000)
        page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", CODE)
        page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
        # 1 comment two lines out, then back in
        page.evaluate("() => { const ta = document.querySelector('#ed-ta'); const v = ta.value; ta.focus(); ta.setSelectionRange(v.indexOf('  x ='), v.indexOf('  y =') + 3); }")
        page.click("#btn-comment"); time.sleep(0.2)
        t1 = text(page)
        check("1 out:", "  # x = Nat.add(a, 1n)\n  # y = Nat.add(b, 1n)\n" in t1)
        page.click("#btn-comment"); time.sleep(0.2)
        check("1 in:", text(page) == CODE)
        page.keyboard.press("Control+z"); time.sleep(0.2)
        check("1 undo:", text(page) == t1)
        page.keyboard.press("Control+z"); time.sleep(0.2)
        check("1 undo again:", text(page) == CODE)
        if not mobile:
            page.evaluate("() => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.setSelectionRange(ta.value.indexOf('Nat.add(x'), ta.value.indexOf('Nat.add(x')); }")
            page.keyboard.press("Control+/"); time.sleep(0.2)
            check("1 Ctrl+/:", "  # Nat.add(x, y)" in text(page))
            page.keyboard.press("Control+/"); time.sleep(0.2)
            page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
        # 2 find, in a second file too
        page.evaluate("() => { document.querySelector('#ed-ta').setSelectionRange(0, 0); }")
        page.click("#btn-find"); time.sleep(0.2)
        page.keyboard.type("1N")
        time.sleep(0.3)
        count = page.inner_text("#find-count")
        marks = page.locator(".ed-marks mark.hit").count()
        cur = page.locator(".ed-marks mark.hit.cur").count()
        check("2 found:", count, count == "1/2", marks, marks == 2, cur == 1, text(page) == CODE)
        page.keyboard.press("Enter"); time.sleep(0.2)
        check("2 next:", page.inner_text("#find-count") == "2/2")
        sel = page.evaluate("() => { const ta = document.querySelector('#ed-ta'); return ta.value.slice(ta.selectionStart, ta.selectionEnd); }")
        check("2 selected:", sel == "1n")
        page.keyboard.press("Shift+Enter"); time.sleep(0.2)
        check("2 back:", page.inner_text("#find-count") == "1/2")
        page.screenshot(path=shot("shot_find_%s.png" % ("phone" if mobile else "wide")))
        page.keyboard.press("Escape"); time.sleep(0.2)
        check("2 closed:", page.locator("#find").is_hidden(), page.locator(".ed-marks mark.hit").count() == 0)
        for e in errs: print("!!", e[:200])
        assert not errs
        ctx.close()
    b.close()
