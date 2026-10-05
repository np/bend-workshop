import time
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
def code(page): return page.evaluate("document.querySelector('#ed-ta').value")
def chips(page): return page.locator(".goal-head .chip").all_inner_texts()
with sync_playwright() as p:
    b = p.chromium.launch()
    for locale, vp in [("en-US", {"width": 1280, "height": 800}), ("fr-FR", {"width": 390, "height": 780})]:
        page = b.new_context(viewport=vp, locale=locale, is_mobile=vp["width"] < 500, has_touch=vp["width"] < 500).new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
        set_code(page, "import Base\n\ndef f(xs: List<U32>, b: Bool, n: U32, m: Maybe<Nat>) -> U32:\n  ?g\n")
        page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(0.5)
        page.evaluate("document.querySelector('#ed-ta').blur()")
        print("==", locale, "| head:", chips(page), "| boxes:", page.locator(".goal-body input").count())
        page.locator(".goal-head .chip", has_text="Découper" if locale.startswith("fr") else "Split").click(); time.sleep(0.2)
        boxes = page.locator(".goal-body input")
        print("   picking:", chips(page), "| boxes:", boxes.count(), "| disabled:", [boxes.nth(i).is_disabled() for i in range(boxes.count())],
              "| Match disabled:", page.locator(".chip.go").is_disabled())
        if locale.startswith("fr"): page.screenshot(path=shot("shot_f7.png"))
        boxes.nth(0).check(); boxes.nth(1).check(); boxes.nth(3).check(); time.sleep(0.2)
        print("   Match disabled now:", page.locator(".chip.go").is_disabled())
        page.locator(".chip.go").click(); time.sleep(1.2)
        page.wait_for_selector("#verdict[data-state=goal]", timeout=30000)
        body = code(page).split("-> U32:\n")[1]
        print("   match:", body.split("\n")[0], "| cases:", [l.strip() for l in body.split("\n") if l.strip().startswith("case")])
        print("   holes:", [l.strip() for l in body.split("\n") if "?" in l][:3], "… | verdict:", page.inner_text("#verdict-text")[:16], "| head after:", chips(page)[:2])
        # cancel path
        page.locator(".goal-head .chip", has_text="Découper" if locale.startswith("fr") else "Split").first.click(); time.sleep(0.2)
        page.locator(".goal-head .chip", has_text="Annuler" if locale.startswith("fr") else "Cancel").first.click(); time.sleep(0.2)
        print("   after cancel:", chips(page)[:3])
        for e in errs: print("!!", e[:200])
        page.close()
    b.close()
