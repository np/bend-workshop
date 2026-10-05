import time
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
frame_page()
serve("dist", 8125, csp="default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; worker-src blob:")
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, url, framed in [("sandboxed iframe", "http://localhost:8123/frame.html", True), ("CSP no eval", "http://localhost:8125/index.html", False)]:
        page = b.new_context(locale="fr-FR", viewport={"width": 1280, "height": 800}).new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto(url)
        root = page.frame_locator("#f") if framed else page
        root.locator("#verdict[data-state=ok]").wait_for(timeout=30000)
        root.locator("#btn-examples").click(); root.locator(".ex", has_text="Triangle").click()
        time.sleep(1.5)
        root.locator("#verdict[data-state=ok]").wait_for(timeout=30000)
        root.locator("#run").click()
        root.locator(".tab[data-tab=screen]:not([hidden])").wait_for(timeout=60000)
        time.sleep(1.5)
        print(name, "→", root.locator("#screen-info").inner_text())
        root.locator("#run").click()
        for e in errs[:3]: print("  !!", e[:200])
        page.close()
    b.close()
