import time, json
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
root = "../bend/demos/app_pong_game_2d/"
files = [{"name": n, "text": open(root + n).read()} for n in ["main.bend", "LAWS.bend"]] + [{"name": "PROOF.bend", "text": open(fixture("pong_proof.bend")).read()}]
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" else None)
    page.add_init_script("if (!localStorage.getItem('seed')) { localStorage.setItem('seed', '1'); localStorage.setItem('bend-play:v2', " + json.dumps(json.dumps({"current": "x", "order": ["x"], "live": True, "size": 14, "lang": "en"})) + "); localStorage.setItem('bend-play:p:x', " + json.dumps(json.dumps({"id": "x", "name": "pong", "files": files, "active": 2, "args": ""})) + "); }")
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(1.5)
    print("verdict:", page.inner_text("#verdict-text"), "| cards:", page.locator(".goal").count())
    page.locator(".goal-head .chip", has_text="Lemma").click(); time.sleep(0.4)
    print("rows:", [(r.locator(".goal-var").inner_text(), r.locator("input").is_checked()) for r in page.locator(".goal-body .pick").all()], "| name:", page.locator(".lemma-name").input_value())
    page.evaluate("""() => { window.__toasts = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }).observe(document.body, { childList: true }); }""")
    page.locator(".goal-head .chip", has_text="Extract").click(); time.sleep(3)
    print("toasts:", page.evaluate("window.__toasts"))
    c = page.evaluate("document.querySelector('#ed-ta').value")
    i = c.find("def body")
    j = c.find("def press4")
    print("written:", i >= 0, "\n" + (c[i:j] if i >= 0 else ""))
    print("call:", [l for l in c.split("\n") if "body(" in l and not l.startswith("def")])
    print("verdict:", page.inner_text("#verdict-text"), "| cards:", [x.split("\n")[0] for x in page.locator(".goal").all_inner_texts()])
    for e in errs: print("!!", e[:400])
    b.close()
