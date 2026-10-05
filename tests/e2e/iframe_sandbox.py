import time
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
frame_page()
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(locale="fr-FR", viewport={"width": 390, "height": 780}, is_mobile=True, has_touch=True).new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: errs.append(m.type + ": " + m.text) if "403" not in m.text else None)
    page.goto("http://localhost:8123/frame.html")
    f = page.frame_locator("#f")
    f.locator("#verdict[data-state=ok]").wait_for(timeout=30000)
    f.locator("#run").click()
    for _ in range(100):
        log = f.locator("#log").inner_text()
        if "exécuté" in log or "pas le droit" in log:
            break
        time.sleep(0.2)
    print("sandboxed iframe:", repr(log))
    for e in errs[:8]:
        print("  ", e[:220])
    b.close()
