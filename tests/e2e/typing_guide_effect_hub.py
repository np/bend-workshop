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
    ta = page.locator("#ed-ta")
    # smart quotes + dashes typed by a phone keyboard
    page.evaluate("() => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, 'x'); ta.select(); }")
    page.keyboard.insert_text("\u201Cbonjour\u201D")
    print("quotes:", repr(page.evaluate("document.querySelector('#ed-ta').value")))
    # Tab / Shift+Tab on a selection
    page.evaluate("() => { const ta = document.querySelector('#ed-ta'); ta.select(); document.execCommand('insertText', false, 'a\\nb\\nc'); ta.setSelectionRange(0, 5); }")
    page.keyboard.press("Tab")
    print("indent:", repr(page.evaluate("document.querySelector('#ed-ta').value")))
    page.keyboard.press("Shift+Tab")
    print("dedent:", repr(page.evaluate("document.querySelector('#ed-ta').value")))
    # guide: try a snippet
    page.click("#btn-guide"); time.sleep(0.4)
    page.locator("#guide .try").nth(2).click(); time.sleep(0.3)
    print("guide snippet:", repr(page.evaluate("document.querySelector('#ed-ta').value")[:60]), "| panel:", page.evaluate("document.querySelector('#app').className"))
    # JS effect example
    page.click("#btn-examples"); page.click(".ex:has-text('Effet étranger')")
    time.sleep(1.0); page.wait_for_selector("#verdict[data-state=ok], #verdict[data-state=warn]", timeout=30000)
    page.click("#run")
    for _ in range(50):
        log = page.locator("#log").inner_text()
        if "exécuté" in log: break
        time.sleep(0.2)
    print("effect:", repr(log))
    page.click(".file:has-text('clock.js')"); time.sleep(0.6)
    print("js file verdict:", page.inner_text("#verdict-text"))
    page.screenshot(path=shot("shot_f1.png"))
    # hub import
    page.click(".file:has-text('main.bend')")
    page.evaluate("() => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, 'import Base\\nimport 0x0123456789abcdef0123456789abcdef/main.bend as P\\n\\ndef main() -> U32:\\n  1\\n'); }")
    time.sleep(1.5)
    page.wait_for_selector("#verdict[data-state=bad]", timeout=30000)
    print("hub:", page.inner_text("#verdict-text"))
    for e in errs: print("err", e[:200])
    b.close()
