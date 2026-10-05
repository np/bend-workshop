import time
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(locale="fr-FR", viewport={"width": 390, "height": 780}, is_mobile=True, has_touch=True).new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/frame.html")
    f = page.frame_locator("#f")
    f.locator("#verdict[data-state=ok]").wait_for(timeout=30000)
    f.locator("#btn-examples").click(); f.locator(".ex", has_text="FizzBuzz").click()
    time.sleep(1.2); f.locator("#verdict[data-state=ok]").wait_for(timeout=30000)
    f.locator("#btn-proj").click(); time.sleep(0.3)
    print("no storage at all:", f.locator("#proj-name").inner_text(), "| sheet opens:", f.locator(".sheet").count() == 1)
    for e in errs: print("!!", e[:200])
    b.close()
