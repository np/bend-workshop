import time
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
with sync_playwright() as p:
    b = p.chromium.launch()
    for locale in ["en-US", "fr-FR"]:
        page = b.new_context(viewport={"width": 1280, "height": 800}, locale=locale).new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
        print("==", locale, "hello verdict:", page.inner_text("#verdict-text"))
        page.click("#btn-examples")
        page.click(".ex:has-text('bounty')" if locale.startswith("en") else ".ex:has-text('bounty')")
        time.sleep(1.2)
        st = page.get_attribute("#verdict", "data-state")
        print("   bounty:", st, "|", page.inner_text("#verdict-text"), "| proj:", page.inner_text("#proj-name"), "| first line:", page.evaluate("document.querySelector('#ed-ta').value.split('\\n')[2]"))
        # the BendTT view in the JS tab
        page.click(".tab[data-tab=js]"); time.sleep(0.5)
        page.locator("#out-targets .chip", has_text="BendTT").click(); time.sleep(1.5)
        print("   bendtt view:", page.inner_text("#js-info")[:120].replace("\n", " / "), "| code:", page.evaluate("document.querySelector('#js-code').textContent.slice(0, 60)").replace("\n", " / "))
        # fill the TODO with something that types (nothing can) → still a hole; try the x+0 example instead
        page.click("#btn-examples"); page.click(".ex:has-text('x + 0')"); time.sleep(1.2); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
        print("   x+0 verdict:", page.inner_text("#verdict-text"))
        page.click(".tab[data-tab=js]"); time.sleep(0.3)
        page.locator("#out-targets .chip", has_text="BendTT").click()
        time.sleep(1.5)
        print("   x+0 bendtt:", page.inner_text("#js-info")[:140].replace("\n", " / "), "| tt:", page.evaluate("document.querySelector('#js-code').textContent.split('\\n')[0]")[:80])
        page.screenshot(path=shot(f"shot_v_{locale[:2]}.png"))
        # the foreign effect example: SOME PROOFS FAIL with the two defs
        page.click("#btn-examples"); page.click(".ex:has-text('foreign')" if locale.startswith("en") else ".ex:has-text('étranger')"); time.sleep(1.5)
        print("   foreign verdict:", page.get_attribute("#verdict", "data-state"), page.inner_text("#verdict-text"), "| diag:", page.inner_text("#diag").replace("\n", " / ")[:100])
        for e in errs: print("!!", e[:200])
        page.close()
    b.close()
