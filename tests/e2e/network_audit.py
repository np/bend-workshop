import time
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
with sync_playwright() as p:
    b = p.chromium.launch()
    for label, init in [("workers", None), ("page mode (no Worker)", "delete window.Worker;")]:
        ctx = b.new_context(viewport={"width": 1280, "height": 800}, locale="fr-FR")
        reqs = []
        ctx.on("request", lambda r: reqs.append(r.url[:110]) if not r.url.startswith(("http://localhost:8123", "blob:", "data:")) else None)
        page = ctx.new_page()
        if init: page.add_init_script(init)
        page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
        page.click("#run"); time.sleep(1.5)
        for ex in ["Tri par insertion", "Triangle", "Effet étranger", "bounty"]:
            page.click("#btn-examples"); page.locator(".ex", has_text=ex).first.click(); time.sleep(1.5)
            page.click("#run"); time.sleep(2.0)
            if page.locator("#run[data-busy=true]").count(): page.click("#run"); time.sleep(0.3)
        page.click(".tab[data-tab=js]"); time.sleep(0.5); page.click(".tab[data-tab=guide]"); time.sleep(0.3); page.click(".tab[data-tab=base]"); time.sleep(0.3)
        print("==", label, "| outgoing requests:", sorted(set(reqs)))
        ctx.close()
    b.close()
