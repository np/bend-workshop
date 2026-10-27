# A parameter consumed more than once: the error's fix writes the copying
# match around the def's body, then adds a second one to that match rather
# than a new layer; the error comes before the goals in the output.
import time
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
ONE = """import Base

def f(x: Nat, y: Nat) -> Nat:
  Nat.add(Nat.add(y, y), ?h)
"""
def check(label, *oks):
    print(label, *oks)
    assert all(o is True for o in oks if isinstance(o, bool)), label
def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
def text(page):
    return page.eval_on_selector("#ed-ta", "t => t.value")
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000)
    set_code(page, ONE)
    page.wait_for_selector("#verdict[data-state=bad]", timeout=30000); time.sleep(0.5)
    page.click(".tab[data-tab=out]"); time.sleep(0.3)
    diag = page.inner_text("#diag")
    check("1 error first:", diag.lstrip().startswith("✗"), "consumed more than once" in diag)
    page.locator("#diag .goto", has_text="Copy y").click(); time.sleep(0.4)
    t1 = text(page)
    check("1 wrapped:", "  match y:\n    case +y:\n      Nat.add(Nat.add(y, y), ?h)" in t1)
    # the browser's own undo takes it back in one step, and redo again
    page.evaluate("document.querySelector('#ed-ta').focus()"); page.keyboard.press("Control+z"); time.sleep(0.3)
    check("1 Ctrl+Z:", text(page) == ONE)
    page.keyboard.press("Control+Shift+z"); time.sleep(0.3)
    check("1 redo:", text(page) == t1)
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000)
    set_code(page, t1.replace("?h", "Nat.add(x, x)"))
    page.wait_for_selector("#verdict[data-state=bad]", timeout=30000); time.sleep(0.5)
    page.click(".tab[data-tab=out]"); time.sleep(0.3)
    page.locator("#diag .goto", has_text="Copy x").click(); time.sleep(0.4)
    t2 = text(page)
    check("2 extended, in the parameters' order:", "  match x y:\n    case +x +y:\n      Nat.add(Nat.add(y, y), Nat.add(x, x))" in t2)
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    page.locator(".toast button", has_text="Undo").click(); time.sleep(0.4)
    check("3 undo:", "match y:\n" in text(page))
    for e in errs: print("!!", e[:200])
    assert not errs
    b.close()
