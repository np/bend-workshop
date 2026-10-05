import time, json, re
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
P = json.load(open(fixture("fakehub/pkg.json"))); PKG = P["pkg"]
MAIN = "import Base\nimport " + PKG + "/lib.bend as Lib\nimport fake@1.0.0.0/color.bend as Col\n\ndef main() -> Nat:\n  Lib.double(2n)\n\ndef shade() -> Col.Color:\n  Lib.paint(1n)\n"
def hub_route(route):
    url = route.request.url
    path = url.split("hub.bend-lang.com/", 1)[1]
    body = None
    if path == PKG + "/manifest": body = P["manifest"]
    elif path.startswith(PKG + "/"): body = P["files"].get(path[len(PKG) + 1:])
    elif path == "name/fake@1.0.0.0": body = PKG
    if body is None: route.fulfill(status=404, body="no", headers={"access-control-allow-origin": "*"})
    else: route.fulfill(status=200, body=body, headers={"access-control-allow-origin": "*", "content-type": "text/plain"})
def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US")
    hits = []
    ctx.route("https://hub.bend-lang.com/**", lambda r: (hits.append(r.request.url.split(".com/")[1][:50]), hub_route(r)))
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    page.on("console", lambda m: errs.append("console " + m.type + ": " + m.text[:200]))
    set_code(page, MAIN)
    page.wait_for_function("() => Object.keys((JSON.parse(localStorage.getItem('bend-play:hub') || '{\"files\":{}}')).files).length >= 3", timeout=20000); time.sleep(1.5)
    print("1 verdict:", page.inner_text("#verdict-text")[:60], "| diag:", page.inner_text("#diag")[:200].replace("\n", " / "), "| hub requests:", hits)
    print("1 tabs:", [x.strip() for x in page.locator(".file").all_inner_texts()])
    print("1 cache:", sorted(page.evaluate("Object.keys(JSON.parse(localStorage.getItem('bend-play:hub')).files)")))
    # signature through the hub alias, and go to definition
    code = page.evaluate("document.querySelector('#ed-ta').value")
    pos = code.index("Lib.double") + 6
    page.evaluate("(p) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.setSelectionRange(p, p); }", pos); time.sleep(0.3)
    print("2 sig:", [x.replace("\n", " | ") for x in page.locator(".sig-row").all_inner_texts()])
    page.locator(".sig-row").first.click(); time.sleep(0.3)
    print("2 sheet:", page.inner_text(".sheet-head h2"), "|", page.locator(".sheet .btn").all_inner_texts())
    page.click(".sheet .btn:has-text('Go to the definition')"); time.sleep(0.5)
    sel = page.evaluate("(() => { const ta = document.querySelector('#ed-ta'); const v = ta.value; const line = v.slice(0, ta.selectionStart).split('\\n').length; return [ta.readOnly, line, v.split('\\n')[line - 1]]; })()")
    print("2 opened:", sel, "| verdict:", page.inner_text("#verdict-text"), "| active tab:", page.locator(".file[aria-selected=true]").inner_text().strip())
    # inside the hub module: C.Color resolves through its relative import
    code2 = page.evaluate("document.querySelector('#ed-ta').value")
    pos = code2.index("C.Color") + 3
    page.evaluate("(p) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.setSelectionRange(p, p); }", pos); time.sleep(0.3)
    print("3 sig in hub:", [x.replace("\n", " | ") for x in page.locator(".sig-row").all_inner_texts()])
    page.keyboard.type("xyz"); time.sleep(0.2)
    print("3 read-only kept:", page.evaluate("document.querySelector('#ed-ta').value") == code2)
    page.screenshot(path=shot("shot_hub.png"))
    page.locator(".file", has_text="main.bend").click(); time.sleep(0.8)
    print("4 back:", page.inner_text("#verdict-text")[:30], "| readonly:", page.evaluate("document.querySelector('#ed-ta').readOnly"))
    for e in errs: print("!!", e[:300])
    ctx.close()
    # a fresh browser, no hub at all: the zip of ~/.bend/lib fills the cache
    ctx = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US")
    ctx.route("https://hub.bend-lang.com/**", lambda r: r.abort())
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    set_code(page, MAIN); time.sleep(1)
    page.wait_for_selector("#verdict[data-state=bad]", timeout=20000)
    print("5 no hub:", page.get_attribute("#verdict", "data-state"), page.inner_text("#diag")[:160].replace("\n", " / "))
    page.click("#btn-proj")
    with page.expect_file_chooser() as fc:
        page.click("text=Import…")
    fc.value.set_files(fixture("fakehub/lib.zip")); time.sleep(0.8)
    print("5 toast:", page.inner_text(".toast")[:60] if page.locator(".toast").count() else None)
    page.click("#check"); time.sleep(2)
    print("5 after zip:", page.inner_text("#verdict-text")[:40], "| tabs:", [x.strip() for x in page.locator(".file.hub").all_inner_texts()])
    for e in errs: print("!!", e[:300])
    b.close()
