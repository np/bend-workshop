# Rewrite on a goal card: an equality (a lemma's call) learnt from the
# checker, every place of the goal it rewrites tried and shown with the
# goal it leaves, and the one that closes it written with {==}.
import time
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
CODE = """import Base

def add_zero(x: Nat) -> {Nat.add(x, 0n) == x : Nat}:
  match x:
    case 0n:
      {==}
    case 1n+p:
      ?step
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
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(0.6)
    page.evaluate("document.querySelector('#ed-ta').blur()")
    page.locator(".goal-head .chip", has_text="Rewrite").first.click(); time.sleep(0.3)
    page.fill(".rw input", "add_zero(p)")
    page.locator(".rw .chip", has_text="Find").click()
    page.wait_for_selector(".rw-cand", timeout=30000); time.sleep(0.3)
    cands = page.locator(".rw-cand").all_inner_texts()
    eq = page.locator(".rw > .dim").first.inner_text()
    check("1 equality and places:", eq, "== p" in eq, len(cands), len(cands) >= 2, page.locator(".rw-cand.fits").count() >= 1)
    page.screenshot(path=shot("shot_rewrite.png"))
    closes = page.locator(".rw-cand.fits", has_text="{==}")
    check("2 one closes it:", closes.count() >= 1)
    closes.first.click(); time.sleep(0.5)
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    text = page.eval_on_selector("#ed-ta", "t => t.value")
    check("3 written:", "      %" in text, "      {==}" in text, "?step" not in text)
    page.locator(".toast button", has_text="Undo").click(); time.sleep(0.5)
    check("4 undo:", "?step" in page.eval_on_selector("#ed-ta", "t => t.value"))
    for e in errs: print("!!", e[:200])
    assert not errs
    b.close()
