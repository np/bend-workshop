import time
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8124, csp="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; worker-src 'none'")
def rows(page):
    return page.locator("#screen").evaluate("""(c) => { const d = c.getContext('2d').getImageData(0, 0, 40, c.height).data; const r = []; for (let y = 0; y < c.height; y++) { for (let x = 0; x < 40; x++) { const i = (y * 40 + x) * 4; if (d[i] | d[i+1] | d[i+2]) { r.push(y); break; } } } return r.length ? [r[0], r[r.length - 1]] : null; }""")
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(locale="fr-FR", viewport={"width": 390, "height": 780}, is_mobile=True, has_touch=True, device_scale_factor=2).new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8124/index.html")
    page.locator("#verdict[data-state=ok]").wait_for(timeout=30000)
    page.locator("#btn-examples").click(); page.locator(".ex", has_text="Pong").click()
    time.sleep(1.5); page.locator("#verdict[data-state=ok]").wait_for(timeout=30000)
    page.locator("#run").click()
    page.locator(".tab[data-tab=screen]:not([hidden])").wait_for(timeout=20000)
    time.sleep(1.2)
    before = rows(page)
    s_key = page.locator("#pad button", has_text="S").first
    s_key.dispatch_event("pointerdown", {"bubbles": True, "pointerId": 7}); time.sleep(0.8)
    s_key.dispatch_event("pointerup", {"bubbles": True, "pointerId": 7}); time.sleep(0.2)
    print("mobile, page mode:", page.locator("#screen-info").inner_text(), "| paddle", before, "→", rows(page))
    # run again right after a stop: the old loop must not leak into the new one
    page.locator("#run").click(); time.sleep(0.05); page.locator("#run").click()
    time.sleep(1.5)
    print("restart:", page.locator("#screen-info").inner_text(), "| busy:", page.locator("#run").get_attribute("data-busy"))
    page.locator("#pad button", has_text="Esc").first.dispatch_event("pointerdown", {"bubbles": True, "pointerId": 8}); time.sleep(0.8)
    print("after Esc:", page.locator("#screen-info").inner_text(), "| busy:", page.locator("#run").get_attribute("data-busy"))
    # a plain program still runs on the page as before
    page.locator("#chev").click()
    page.locator("#btn-examples").click(); page.locator(".ex", has_text="FizzBuzz").click()
    time.sleep(1.5); page.locator("#verdict[data-state=ok]").wait_for(timeout=30000)
    page.locator("#run").click(); time.sleep(1.0)
    log = page.locator("#log").inner_text()
    print("fizzbuzz on the page:", "FizzBuzz" in log, "|", log.strip().split("\n")[-2][:90])
    for e in errs: print("!!", e[:250])
    b.close()
