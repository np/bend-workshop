# A file failing in the hole's own declaration (a parameter consumed
# twice): the checker may stop before the hole, so a candidate leaving the
# same error proves nothing: no Solve, {==} not offered as fitting.
import time
from playwright.sync_api import sync_playwright
from serve import serve
serve("dist", 8123)
CODE = """import Base

def two(x: Nat) -> Nat:
  Nat.add(x, 1n)

def g(x: Nat) -> {Nat.add(x, 0n) == x : Nat}:
  ?h
"""
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
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(1.5)
    # an error comes in an earlier declaration: the card stays
    page.evaluate("""() => { const ta = document.querySelector('#ed-ta'); const i = ta.value.indexOf('Nat.add(x, 1n)'); ta.focus(); ta.setSelectionRange(i, i + 14); document.execCommand('insertText', false, 'Nat.add(x, x)'); }""")
    page.wait_for_selector("#verdict[data-state=bad]", timeout=30000); time.sleep(2.5)
    page.evaluate("document.querySelector('#ed-ta').blur()")
    cards = page.locator(".goal .goal-head").all_inner_texts()
    chips = page.locator(".goal-head .chip").all_inner_texts()
    print("cards:", cards, "| chips:", chips, "| verdict:", page.inner_text("#verdict-text")[:60])
    check("1 no Solve:", "Solve" not in chips)
    if any(c.startswith("Constructors") for c in chips):
        page.locator(".goal-head .chip", has_text="Constructors").first.click(); time.sleep(1.5)
        check("2 {==} not fitting:", page.locator(".cand.fits", has_text="{==}").count() == 0)
    for e in errs: print("!!", e[:200])
    assert not errs
    b.close()
