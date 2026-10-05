import time, json
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
root = "../bend/demos/app_pong_game_2d/"
files = [{"name": n, "text": open(root + n).read()} for n in ["main.bend", "LAWS.bend", "PROOF.bend"]]
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.add_init_script("if (!localStorage.getItem('seed')) { localStorage.setItem('seed', '1'); localStorage.setItem('bend-play:v2', " + json.dumps(json.dumps({"current": "x", "order": ["x"], "live": True, "size": 14, "lang": "en"})) + "); localStorage.setItem('bend-play:p:x', " + json.dumps(json.dumps({"id": "x", "name": "pong", "files": files, "active": 2, "args": ""})) + "); }")
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000); time.sleep(1)
    code = page.evaluate("document.querySelector('#ed-ta').value")
    pos = code.index("def press4(") + 6
    page.evaluate("(p) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.setSelectionRange(p, p); }", pos); time.sleep(0.3)
    print("sig:", page.locator(".sig-row").first.inner_text().replace("\n", " | ")[:140])
    page.locator(".sig-row").first.click(); time.sleep(0.3)
    print("buttons:", page.locator(".sheet .btn").all_inner_texts())
    page.click(".sheet .btn:has-text('Split into')"); time.sleep(2.0)
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    c = page.evaluate("document.querySelector('#ed-ta').value")
    i = c.index("law press4"); print("law:\n" + c[i:c.index("  match b1")])
    print("verdict:", page.inner_text("#verdict-text"))
    for e in errs: print("!!", e[:200])
    b.close()
