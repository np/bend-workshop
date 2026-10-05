import time
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
URL = "http://localhost:8123/index.html"
def texts(page):
    return {
        "lang": page.evaluate("document.documentElement.lang"),
        "header": [b.strip() for b in page.locator(".top button").all_inner_texts()],
        "tabs": [b.strip() for b in page.locator(".tab").all_inner_texts()],
        "run": page.inner_text("#run-lbl"), "check": page.inner_text("#check .lbl"),
        "verdict": page.inner_text("#verdict-text"), "proj": page.inner_text("#proj-name"),
        "hint": page.inner_text("#out-hint")[:50],
        "aria": [page.get_attribute("#btn-settings", "aria-label"), page.get_attribute("#ed-ta", "aria-label")],
    }
with sync_playwright() as p:
    b = p.chromium.launch()
    for locale in ["en-US", "fr-FR", "de-DE"]:
        ctx = b.new_context(viewport={"width": 390, "height": 780}, is_mobile=True, has_touch=True, locale=locale)
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto(URL)
        page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
        print("==", locale, texts(page))
        for e in errs: print("!!", e[:200])
        ctx.close()
    # switch live in settings, then reload: the choice sticks
    ctx = b.new_context(viewport={"width": 390, "height": 780}, is_mobile=True, has_touch=True, locale="en-US")
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(URL); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    page.click("#btn-examples"); page.click(".ex:has-text('Insertion sort')")
    time.sleep(1.2); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    page.click("#btn-settings"); time.sleep(0.2)
    print("settings EN:", [b.strip() for b in page.locator(".sheet .btn").all_inner_texts()])
    page.click(".sheet .btn:has-text('Français')"); time.sleep(1.0)
    print("settings FR:", [b.strip() for b in page.locator(".sheet .btn").all_inner_texts()], "| sheet title:", page.inner_text(".sheet-head h2"))
    page.click(".sheet-head button"); time.sleep(0.6)
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    t = texts(page)
    print("after switch:", t, "| laws:", page.inner_text("#laws"))
    page.click("#btn-examples"); time.sleep(0.2)
    print("examples FR:", [x.split("\n")[0] for x in page.locator(".ex").all_inner_texts()][:4], page.locator(".group").first.inner_text())
    page.click(".sheet-head button")
    page.click("#btn-proj"); time.sleep(0.2)
    print("projects FR:", page.inner_text(".sheet-head h2"), "|", [b.strip() for b in page.locator(".sheet .btn").all_inner_texts()])
    page.click(".sheet-head button")
    page.click("#btn-about"); time.sleep(0.2)
    print("about FR:", page.inner_text(".about")[:60])
    page.click(".sheet-head button")
    page.reload(); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    print("after reload:", texts(page)["lang"], texts(page)["header"])
    # run: output messages in French, keys aria
    page.click("#run")
    for _ in range(50):
        log = page.locator("#log").inner_text()
        if "exécuté" in log: break
        time.sleep(0.2)
    print("run FR:", log.strip().split("\n")[-1][:90], "| key aria:", page.get_attribute("#keys button", "aria-label"))
    page.screenshot(path=shot("shot_l1.png"))
    # back to English live
    page.click("#btn-settings"); page.click(".sheet .btn:has-text('English')"); time.sleep(0.8); page.click(".sheet-head button"); time.sleep(0.5)
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    print("back EN:", texts(page)["header"], texts(page)["verdict"], "| laws:", page.inner_text("#laws"), "| pad:", [x for x in page.locator("#pad button").all_inner_texts()][4:9])
    for e in errs: print("!!", e[:250])
    b.close()
