import time, json, os
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
DEMOS = ["pure_par_sort", "pure_hvm5_mini", "app_ray_tracer_3d", "app_pong_game_2d", "proof_numerics"]
def load(d):
    root = "../bend/demos/" + d
    return [{"name": n, "text": open(root + "/" + n).read()} for n in sorted(os.listdir(root)) if n.endswith(".bend")]

with sync_playwright() as p:
    b = p.chromium.launch()
    for d in DEMOS:
        page = b.new_context(locale="fr-FR", viewport={"width": 1280, "height": 800}).new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        files = load(d)
        active = [f["name"] for f in files].index("main.bend")
        page.add_init_script("localStorage.setItem('bend-play:v1', " + json.dumps(json.dumps({"files": files, "active": active, "args": "", "live": False, "size": 14})) + ");")
        page.goto("http://localhost:8123/index.html")
        page.wait_for_selector("#run", timeout=30000)
        time.sleep(0.5)
        t0 = time.time()
        page.click("#run")
        log = ""
        for _ in range(450):
            log = page.locator("#pane-out .out").inner_text()
            if "exécuté" in log or "Error" in log or "stack" in log or "Arrêté" in log or "pas le droit" in log or "bend:" in log:
                break
            time.sleep(0.2)
        dt = time.time() - t0
        tail = [l for l in log.strip().split("\n") if l.strip()][-3:]
        print(f"== {d}: {dt:.1f}s |", " / ".join(x[:150] for x in tail))
        if page.get_attribute("#run", "data-busy") == "true":
            page.click("#run")
        for e in errs[:3]: print("   pageerror:", e[:200])
        page.close()
    b.close()
