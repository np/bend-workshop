import time
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
def col_profile(page):
    # where the left paddle is: rows lit in the leftmost columns
    return page.evaluate("""() => { const c = document.querySelector('#screen'); const d = c.getContext('2d').getImageData(0, 0, 40, c.height).data; const rows = []; for (let y = 0; y < c.height; y++) { let lit = false; for (let x = 0; x < 40; x++) { const i = (y * 40 + x) * 4; if (d[i] | d[i+1] | d[i+2]) { lit = true; break; } } if (lit) rows.push(y); } return rows.length ? [rows[0], rows[rows.length - 1]] : null; }""")
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(locale="fr-FR", viewport={"width": 390, "height": 780}, is_mobile=True, has_touch=True, device_scale_factor=2).new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html")
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    page.click("#btn-examples"); page.click(".ex:has-text('Pong')")
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    page.click("#run")
    page.wait_for_selector(".tab[data-tab=screen]:not([hidden])", timeout=60000)
    time.sleep(1.5)
    print("mobile:", page.inner_text("#screen-info"), "| app class:", page.evaluate("document.querySelector('#app').className"), "| canvas css:", page.evaluate("document.querySelector('#screen').style.width"))
    before = col_profile(page)
    pad_s = page.locator("#pad button", has_text="S").first
    box = pad_s.bounding_box()
    page.touchscreen.tap(box["x"] + 5, box["y"] + 5)   # a tap is too short to move much
    # hold S with a synthetic pointer sequence
    page.evaluate("""() => { const b = [...document.querySelectorAll('#pad button')].find(x => x.textContent === 'S'); b.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, pointerId: 7})); }""")
    time.sleep(0.8)
    page.evaluate("""() => { const b = [...document.querySelectorAll('#pad button')].find(x => x.textContent === 'S'); b.dispatchEvent(new PointerEvent('pointerup', {bubbles: true, pointerId: 7})); }""")
    time.sleep(0.2)
    after = col_profile(page)
    print("left paddle rows before/after holding S:", before, after)
    page.screenshot(path=shot("shot_w_mobile.png"))
    page.locator("#pad button", has_text="Esc").first.tap()
    time.sleep(0.8)
    print("after Esc:", page.inner_text("#screen-info"), "| busy:", page.get_attribute("#run", "data-busy"))
    # the guide's App example
    page.click("#btn-examples"); page.click(".ex:has-text('Une fenêtre')")
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    page.click("#run")
    time.sleep(2.0)
    print("guide app:", page.inner_text("#screen-info"))
    page.screenshot(path=shot("shot_w_mobile2.png"))
    page.click("#screen-close"); time.sleep(0.8)
    print("after close:", page.inner_text("#screen-info"), "| busy:", page.get_attribute("#run", "data-busy"))
    for e in errs: print("!!", e[:300])
    b.close()
