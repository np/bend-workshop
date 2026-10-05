import time
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 780}, locale="fr-FR", is_mobile=True, has_touch=True)
    reqs = []
    ctx.on("request", lambda r: reqs.append(r.url[:60]) if not r.url.startswith(("http://localhost:8123", "blob:", "data:")) else None)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    print("1 default load:", sorted(set(reqs)), "| link:", page.locator("#gf-css").count())
    page.click("#btn-settings"); time.sleep(0.3)
    box = page.locator(".sheet label.check", has_text="Google Fonts").locator("input")
    print("2 setting checked:", box.is_checked())
    page.screenshot(path=shot("shot_privacy.png"))
    box.uncheck(); time.sleep(0.4)
    print("3 after unchecking: link:", page.locator("#gf-css").count(), "| stored:", page.evaluate("JSON.parse(localStorage.getItem('bend-play:v2')).fonts"))
    page.click(".sheet-head button")
    reqs.clear()
    page.reload(); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    page.click("#run"); time.sleep(1.5)
    print("4 reload with fonts off:", sorted(set(reqs)), "| link:", page.locator("#gf-css").count(), "| run:", page.locator("#log").inner_text().strip().split("\n")[-1][:40])
    # the editor stays aligned with the system font: textarea and highlight layer have the same height
    print("5 alignment:", page.evaluate("(() => { const ta = document.querySelector('#ed-ta'), pre = document.querySelector('pre.ed-hl'); return [getComputedStyle(ta).fontFamily.slice(0, 30), Math.round(pre.offsetHeight) === Math.round(ta.scrollHeight) || Math.abs(pre.offsetHeight - ta.scrollHeight) < 2]; })()"))
    page.click("#btn-settings"); time.sleep(0.2)
    page.locator(".sheet label.check", has_text="Google Fonts").locator("input").check(); time.sleep(0.4)
    print("6 back on: link:", page.locator("#gf-css").count())
    for e in errs: print("!!", e[:200])
    b.close()
