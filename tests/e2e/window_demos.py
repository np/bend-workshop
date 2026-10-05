import time, json, os, sys
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
def load(d):
    root = "../bend/demos/" + d
    return [{"name": n, "text": open(root + "/" + n).read()} for n in sorted(os.listdir(root)) if n.endswith(".bend")]
def canvas_stats(page):
    return page.evaluate("""() => { const c = document.querySelector('#screen'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const seen = new Set(); let lit = 0; for (let i = 0; i < d.length; i += 4 * 97) { const v = (d[i] << 16) | (d[i+1] << 8) | d[i+2]; seen.add(v); if (v) lit++; }
      return { w: c.width, h: c.height, colors: seen.size, lit, css: c.style.width + ' x ' + c.style.height }; }""")

DEMOS = sys.argv[1:] or ["app_triangle_2d"]
with sync_playwright() as p:
    b = p.chromium.launch()
    for d in DEMOS:
        page = b.new_context(locale="fr-FR", viewport={"width": 1280, "height": 800}).new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" and "403" not in m.text else None)
        files = load(d)
        active = [f["name"] for f in files].index("main.bend")
        page.add_init_script("if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded', '1'); localStorage.setItem('bend-play:v1', " + json.dumps(json.dumps({"files": files, "active": active, "args": "", "live": False, "size": 14})) + "); }")
        page.goto("http://localhost:8123/index.html")
        page.wait_for_selector("#run", timeout=30000)
        time.sleep(0.4)
        t0 = time.time()
        page.click("#run")
        try:
            page.wait_for_selector(".tab[data-tab=screen]:not([hidden])", timeout=60000)
        except Exception as e:
            print("== ", d, "no window:", page.locator("#pane-out .out").inner_text()[-400:])
            continue
        print(f"== {d}: window after {time.time() - t0:.1f}s |", page.inner_text("#screen-info"))
        time.sleep(2.0)
        print("   info:", page.inner_text("#screen-info"), "| canvas:", canvas_stats(page))
        page.screenshot(path=shot(f"shot_w_{d}.png"))
        # a click in the middle, then keys
        box = page.locator("#screen").bounding_box()
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        time.sleep(0.6)
        for key in ["w", "w", "ArrowUp", "ArrowRight", "d"]:
            page.keyboard.down(key); time.sleep(0.15); page.keyboard.up(key)
        time.sleep(0.5)
        print("   after input:", canvas_stats(page))
        page.screenshot(path=shot(f"shot_w_{d}_2.png"))
        page.keyboard.press("Escape")
        time.sleep(1.0)
        busy = page.get_attribute("#run", "data-busy")
        print("   after Escape: busy =", busy, "|", page.inner_text("#screen-info"))
        if busy == "true":
            page.click("#run"); time.sleep(0.3)
        page.click(".tab[data-tab=out]")
        print("   log:", " / ".join(l for l in page.locator("#log").inner_text().split("\n") if l.strip())[-260:])
        for e in errs[:4]: print("   !!", e[:300])
        page.close()
    b.close()
