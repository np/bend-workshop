import time
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 390, "height": 780}, locale="fr-FR", is_mobile=True, has_touch=True).new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    set_code(page, "import Base\n\ndef f(-A: Type, +n: Nat, x: A, xs: List<A>, h: {n == 0n : Nat}) -> {Nat.add(n, 0n) == n : Nat}:\n  ?g\n")
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(1.2)
    page.evaluate("document.querySelector('#ed-ta').blur()")
    page.locator(".goal-head .chip", has_text="Lemme").tap(); time.sleep(0.4)
    print("tools:", page.locator(".goal-tools").inner_text().replace("\n", " | "), "| input:", page.locator(".lemma-name").input_value())
    rights = page.evaluate("[...document.querySelectorAll('.goal-tools > *')].map(e => Math.round(e.getBoundingClientRect().right))")
    print("right edges:", rights)
    page.screenshot(path=shot("shot_lemma_390.png"))
    # a bad name, then a taken one
    page.fill(".lemma-name", "2bad"); page.locator(".goal-head .chip", has_text="Extraire").tap(); time.sleep(0.3)
    print("bad name:", page.inner_text(".toast")[:70])
    page.fill(".lemma-name", "f"); page.locator(".goal-head .chip", has_text="Extraire").tap(); time.sleep(0.3)
    print("taken:", page.inner_text(".toast")[:70])
    page.locator(".goal-head .chip", has_text="Annuler").tap(); time.sleep(0.3)
    print("after cancel:", page.locator(".goal-head .chip").all_inner_texts())
    for e in errs: print("!!", e[:200])
    b.close()
