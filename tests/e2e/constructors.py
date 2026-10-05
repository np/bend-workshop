import time
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
def code(page): return page.evaluate("document.querySelector('#ed-ta').value")
def cands(page, nth=0):
    card = page.locator(".goal").nth(nth)
    page.wait_for_function("(n) => { const h = document.querySelectorAll('.goal')[n].querySelector('.goal-head'); return /Solve|Constructors/.test(h.textContent) && !h.textContent.includes('\u2026'); }", arg=nth, timeout=15000)
    if card.locator(".chip", has_text="Solve").count():
        return [("SOLVE:" + card.locator(".chip", has_text="Solve").get_attribute("aria-label"), True, "")]
    card.locator(".chip", has_text="Constructors").click()
    page.wait_for_function("(n) => { const c = document.querySelectorAll('.goal')[n].querySelector('.cands'); return c && !c.textContent.includes('Checking'); }", arg=nth, timeout=30000)
    return [(x.inner_text(), x.get_attribute("aria-disabled") == "false", x.get_attribute("title")) for x in card.locator(".cand").all()]
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)

    # equality goals: {==} fits in the base case, not in the step before the rewrite
    set_code(page, "import Base\n\nlaw add_zero:\n  for x: Nat\n  {Nat.add(x, 0n) == x : Nat}\n\ndef add_zero(x):\n  match x:\n    case 0n:\n      ?base\n    case 1n+p:\n      ?step\n")
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(0.5)
    page.evaluate("document.querySelector('#ed-ta').blur()")
    print("1 base:", cands(page, 0))
    print("1 step:", cands(page, 1))
    page.screenshot(path=shot("shot_f8.png"))
    page.locator(".goal").nth(0).locator(".chip", has_text="Solve").click(); time.sleep(1.0)
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000)
    print("1c after put:", repr(code(page).split("case 0n:\n")[1][:12]), "| verdict:", page.inner_text("#verdict-text")[:12])

    # datatypes: Maybe, List, Nat, a pair, and an indexed type where a constructor cannot fit
    set_code(page, "import Base\n\ndef f(n: U32) -> Maybe<Nat>:\n  ?m\n\ndef g() -> List<U32>:\n  ?l\n\ndef h() -> Nat & Bool:\n  ?p\n\ndef k() -> Nat:\n  ?n\n")
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(0.5)
    page.evaluate("document.querySelector('#ed-ta').blur()")
    print("2 Maybe:", cands(page, 0))
    print("2 List:", cands(page, 1))
    print("2 pair:", cands(page, 2))
    print("2 Nat:", cands(page, 3))
    page.locator(".goal").nth(0).locator(".cand").nth(1).click(); time.sleep(1.0)
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000)
    print("2b Some put:", repr(code(page).split("Maybe<Nat>:\n")[1][:18]), "| selection:", page.evaluate("(() => { const ta = document.querySelector('#ed-ta'); return ta.value.slice(ta.selectionStart, ta.selectionEnd); })()"), "| goals:", page.inner_text("#goals-count"))
    # a computed family: the checker shows the goal normalized, so LE(1n, 2n) offers Unit{} and LE(2n, 1n) nothing
    set_code(page, "import Base\n\ndef LE(a: Nat, b: Nat) -> Data:\n  match a b:\n    case 0n b0:\n      Unit\n    case 1n+a1 0n:\n      Empty\n    case 1n+a1 1n+b1:\n      LE(a1, b1)\n\ndef one_two() -> LE(1n, 2n):\n  ?le\n\ndef two_one() -> LE(2n, 1n):\n  ?no\n")
    time.sleep(0.6)
    st = page.get_attribute("#verdict", "data-state"); print("3 verdict:", st, page.inner_text("#verdict-text")[:60])
    if st == "goal":
        page.evaluate("document.querySelector('#ed-ta').blur()")
        print("3 LE(1n, 2n):", cands(page, 0))
        print("3 LE(2n, 1n):", cands(page, 1), "|", page.locator(".goal").nth(1).locator(".cands").inner_text())
    for e in errs: print("!!", e[:200])
    b.close()
