import time, sys
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
# the artifact viewer, as far as it can be guessed: inline scripts only, no blob workers, no eval
serve("dist", 8124, csp="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; worker-src 'none'")
serve("dist", 8123)
CASES = [("CSP: no workers, no eval", "http://localhost:8124/index.html", None),
         ("no Worker, eval allowed", "http://localhost:8123/index.html", "delete window.Worker;")]
def lit(page):
    return page.locator("#screen").evaluate("""(c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const seen = new Set(); for (let i = 0; i < d.length; i += 4 * 97) seen.add((d[i] << 16) | (d[i+1] << 8) | d[i+2]); return seen.size; }""")
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, url, init in CASES:
        page = b.new_context(locale="fr-FR", viewport={"width": 1280, "height": 800}).new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        if init: page.add_init_script(init)
        page.goto(url)
        page.locator("#verdict[data-state=ok]").wait_for(timeout=30000)
        for ex in ["Triangle", "Pong"]:
            page.locator("#btn-examples").click(); page.locator(".ex", has_text=ex).first.click()
            time.sleep(1.5); page.locator("#verdict[data-state=ok]").wait_for(timeout=30000)
            page.locator("#run").click()
            try:
                page.locator(".tab[data-tab=screen]:not([hidden])").wait_for(timeout=8000)
            except Exception:
                print(f"== {name} / {ex}: NO WINDOW |", page.locator("#log").inner_text().strip().replace("\n", " / ")[-220:]); continue
            time.sleep(1.5)
            info = page.locator("#screen-info").inner_text()
            box = page.locator("#screen").bounding_box()
            page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            page.keyboard.down("s"); time.sleep(0.4); page.keyboard.up("s")
            colors = lit(page)
            # the page must stay alive: the editor still takes a keystroke's worth of script
            alive = page.locator("#verdict-text").inner_text()[:30]
            if ex == "Triangle":
                page.keyboard.press("Escape"); time.sleep(0.8)
                end = "Esc → busy=" + str(page.locator("#run").get_attribute("data-busy"))
            else:
                page.locator("#run").click(); time.sleep(0.8)
                end = "Stop → busy=" + str(page.locator("#run").get_attribute("data-busy"))
            page.locator(".tab[data-tab=out]").click()
            tail = page.locator("#log").inner_text().strip().split("\n")[-2:]
            print(f"== {name} / {ex}: {info} | colors={colors} | {end} | {' / '.join(tail)[:170]}")
        for e in errs[:4]: print("   !!", e[:250])
        page.close()
    b.close()
