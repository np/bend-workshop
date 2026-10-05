import time
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
CODE = "import Base\n\ndef f(x: Nat, y: Nat) -> Nat:\n  (x + y * 3n : Nat)\n\ndef g(a: Nat, b: Nat, +c: Nat, +d: Nat) -> Bool:\n  Bool.and(Nat.is_lt(a, c), Nat.is_le(b, d))\n\ndef h(x: U32) -> U32:\n  x + 1\n"
def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
def code(page): return page.evaluate("document.querySelector('#ed-ta').value")
def caret(page, needle, off=0):
    pos = code(page).index(needle) + off
    page.evaluate("(p) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.setSelectionRange(p, p); }", pos); time.sleep(0.3)
def sheet_buttons(page):
    page.locator(".sig-row").first.click(); time.sleep(0.3)
    return page.locator(".sheet .btn").all_inner_texts()
with sync_playwright() as p:
    b = p.chromium.launch()
    for locale in ["en-US", "fr-FR"]:
        page = b.new_context(viewport={"width": 390, "height": 780}, locale=locale, is_mobile=True, has_touch=True).new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000)
        set_code(page, CODE); time.sleep(1.2)
        v0 = page.inner_text("#verdict-text").split(" ")[0:3]
        calls = "Write as calls" if locale.startswith("en") else "Écrire en appels"
        ops = "Write with operators" if locale.startswith("en") else "Écrire avec des opérateurs"
        # operators → calls, from the caret on *
        caret(page, "y * 3n", 2)
        print("==", locale, "verdict:", " ".join(v0), "| sheet on *:", sheet_buttons(page))
        page.click(".sheet .btn:has-text('" + calls + "')"); time.sleep(1.5)
        print("   f is now:", [l.strip() for l in code(page).split("\n") if "Nat.add" in l or "Nat.mul" in l], "| verdict:", page.inner_text("#verdict-text")[:30])
        # and back, from the caret on the inner call's name
        caret(page, "Nat.mul", 2)
        print("   sheet on Nat.mul:", sheet_buttons(page))
        page.click(".sheet .btn:has-text('" + ops + "')"); time.sleep(1.5)
        print("   f again:", [l.strip() for l in code(page).split("\n") if "3n" in l])
        # calls → operators across && with one namespace
        caret(page, "Nat.is_lt", 3)
        print("   sheet on Nat.is_lt:", sheet_buttons(page))
        page.click(".sheet .btn:has-text('" + ops + "')"); time.sleep(1.5)
        print("   g is now:", [l.strip() for l in code(page).split("\n") if "&&" in l], "| verdict:", page.inner_text("#verdict-text")[:30])
        page.click(".toast button"); time.sleep(0.8)
        print("   undo:", [l.strip() for l in code(page).split("\n") if "Bool.and" in l])
        # an operator Bend refuses: no annotation
        caret(page, "x + 1", 2)
        rows = page.locator(".sig-row").all_inner_texts()
        print("   x + 1 row:", [r.replace("\n", " | ") for r in rows][:1])
        for e in errs: print("!!", e[:200])
        page.close()
    b.close()
