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
    def load(code):
        page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
        page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(0.8)
        page.evaluate("document.querySelector('#ed-ta').blur()")
    def find(eq):
        page.locator(".goal-head .chip", has_text="Rewrite").first.click(); time.sleep(0.3)
        page.fill(".rw input", eq)
        page.locator(".rw .chip", has_text="Find").click()
        page.wait_for_selector(".rw-cand", timeout=30000); time.sleep(0.3)
    LEMMA = CODE.replace("      ?step\n", "      %add_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}\n      {==}\n")
    # 5 a hole inside an expression: the rewrite goes inline
    load(LEMMA + "\ndef t(n: Nat) -> {Nat.add(n, 0n) == n : Nat} & Nat:\n  (?h, 0n)\n")
    find("add_zero(n)")
    groups = page.locator(".rw-group").all_inner_texts()
    check("5 grouped:", groups, any("Right side" in g for g in groups))
    page.locator(".rw-cand.fits", has_text="{==}").first.click(); time.sleep(0.5)
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    check("5 inline:", "((%add_zero(n) : {Nat.add(n, 0n) == _ : Nat}; {==}), 0n)" in page.eval_on_selector("#ed-ta", "t => t.value"))
    # 6 a function printed eta-expanded in the goal, plain in the equality
    load(LEMMA + "\nlaw opaque:\n  for f: Nat -> Nat -> Nat\n  for z: Nat\n  Nat\n\ndef u(n: Nat, e: {opaque(Nat.add, n) == n : Nat}) -> {Nat.add(opaque(a => b => Nat.add(a, b), n), 0n) == n : Nat}:\n  ?g\n")
    find("e")
    left = page.locator(".rw-group", has_text="Left side")
    fits = [x for x in page.locator(".rw-cand.fits").all_inner_texts()]
    check("6 eta:", left.count() == 1, any("Nat.add(_, 0n)" in x for x in fits), fits[:2])
    # 7 a goal that is not an equality
    load("import Base\n\ndef F(n: Nat) -> Type:\n  match n:\n    case 0n:\n      Unit\n    case 1n+p:\n      Nat\n\ndef w(n: Nat, e: {Nat.add(n, 0n) == n : Nat}, v: F(Nat.add(n, 0n))) -> F(n):\n  ?k\n")
    find("e")
    fits = page.locator(".rw-cand.fits").all_inner_texts()
    check("7 any goal:", len(fits) >= 1, any("F(Nat.add(n, 0n))" in x for x in fits), fits[:2])
    page.screenshot(path=shot("shot_rewrite_groups.png"))
    for e in errs: print("!!", e[:200])
    assert not errs
    b.close()
