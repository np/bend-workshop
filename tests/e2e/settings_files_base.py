import time
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(locale="fr-FR", viewport={"width": 390, "height": 780}, is_mobile=True, has_touch=True, device_scale_factor=2).new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html")
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    page.click("#btn-settings"); time.sleep(0.3); page.screenshot(path=shot("shot_s1.png"))
    page.fill(".form input[type=text]", "alice 42")
    page.click("text=A+"); page.click("text=A+")
    page.click(".sheet-head button")
    # args example
    page.evaluate("""() => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, 'import Base\\n\\ndef show(xs: List<String>) -> IO(Unit):\\n  match xs:\\n    case Nil{}:\\n      IO.pure(Unit, Unit{})\\n    case Con{h, t}:\\n      do IO<Unit>:\\n        IO.print(h)\\n        show(t)\\n\\ndef main() -> IO(Unit):\\n  do IO<Unit>:\\n    args : List<String> <- IO.args()\\n    show(args)\\n'); }""")
    time.sleep(1.0)
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    page.click("#run")
    for _ in range(50):
        log = page.locator("#log").inner_text()
        if "exécuté" in log: break
        time.sleep(0.2)
    print("args run:", repr(log))
    page.screenshot(path=shot("shot_s2.png"))
    # new file
    page.click("#chev")
    page.click(".file-add"); time.sleep(0.2)
    page.fill(".form input[type=text]", "lib.bend"); page.click("text=Créer le fichier"); time.sleep(0.5)
    print("files:", page.evaluate("[...document.querySelectorAll('.file')].map(f => f.textContent)"))
    page.click(".file-more"); time.sleep(0.3); page.screenshot(path=shot("shot_s3.png"))
    page.click("text=Supprimer lib.bend"); time.sleep(0.3)
    print("files after delete:", page.evaluate("[...document.querySelectorAll('.file')].map(f => f.textContent)"))
    page.click(".toast button"); time.sleep(0.3)
    print("files after undo:", page.evaluate("[...document.querySelectorAll('.file')].map(f => f.textContent)"))
    # base + js
    page.click("#chev"); page.click(".tab[data-tab=base]"); time.sleep(0.3); page.screenshot(path=shot("shot_s4.png"))
    page.fill("#base-q", "Map"); time.sleep(0.3); page.screenshot(path=shot("shot_s5.png"))
    page.click("#chev"); time.sleep(0.2)
    page.click(".file >> nth=0"); time.sleep(0.2)
    page.click("#chev"); time.sleep(0.2)
    page.click(".tab[data-tab=js]"); time.sleep(2.5); page.screenshot(path=shot("shot_s6.png"))
    print("js info:", page.inner_text("#js-info"))
    for e in errs: print("err", e[:200])
    b.close()
