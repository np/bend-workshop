import time
from playwright.sync_api import sync_playwright
from serve import serve, fixture, frame_page
from serve import shot as shot_path
serve("dist", 8123)
serve("dist", 8124, csp="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; worker-src 'none'")
serve("dist", 8125, csp="default-src 'self'; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline'; worker-src blob:")

def run_case(p, name, url, init=None, dark=False, png=None, vp=(1280, 800)):
    b = p.chromium.launch()
    ctx = b.new_context(locale="fr-FR", viewport={"width": vp[0], "height": vp[1]}, color_scheme="dark" if dark else "light")
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" and "403" not in m.text else None)
    if init:
        page.add_init_script(init)
    page.goto(url)
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    page.click("#btn-examples")
    page.click(".ex:has-text('FizzBuzz')")
    time.sleep(1.2)
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    page.click("#run")
    for _ in range(100):
        log = page.locator("#log").inner_text()
        if "exécuté" in log or "pas le droit" in log:
            break
        time.sleep(0.2)
    print("==", name, "| FizzBuzz ok:", "FizzBuzz" in log and "14" in log, "|", log.strip().split("\n")[-2:], )
    if png:
        page.screenshot(path=shot_path(png))
    for e in errs[:6]:
        print("   err:", e[:200])
    b.close()

with sync_playwright() as p:
    run_case(p, "desktop dark", "http://localhost:8123/index.html", dark=True, png="shot_d2.png")
    run_case(p, "CSP: no workers, no eval", "http://localhost:8124/index.html")
    run_case(p, "CSP: blob workers, no eval", "http://localhost:8125/index.html")
