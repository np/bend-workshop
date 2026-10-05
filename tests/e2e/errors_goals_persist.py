import sys, json, time
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist")

URL = "http://localhost:8123/index.html"
logs = []

def attach(page):
    page.on("console", lambda m: logs.append(("console." + m.type, m.text)) if "403" not in m.text else None)
    page.on("pageerror", lambda e: logs.append(("pageerror", str(e))))

def state(page):
    return page.evaluate("document.querySelector('#verdict').dataset.state")

def wait_state(page, st, timeout=20000):
    page.wait_for_function("s => document.querySelector('#verdict').dataset.state === s", arg=st, timeout=timeout)

def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select();
      document.execCommand('insertText', false, code); }""", code)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(locale="fr-FR", viewport={"width": 390, "height": 780}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    attach(page)
    page.goto(URL)
    wait_state(page, "ok")

    # 1. a type error, live
    set_code(page, 'import Base\n\ndef main() -> U32:\n  "oops"\n')
    wait_state(page, "bad")
    print("1 verdict:", page.inner_text("#verdict-text"))
    print("1 typing class:", page.evaluate("document.querySelector('#app').className"))
    print("1 mark hidden:", page.evaluate("document.querySelector('#ed-mark').hidden"), "gutter err:", page.evaluate("document.querySelector('#ed-gutter .err')?.textContent"))
    page.screenshot(path=shot("shot_m3.png"))
    page.click("#verdict")
    time.sleep(0.3)
    print("1 diag:", repr(page.inner_text("#diag")[:200]))
    page.screenshot(path=shot("shot_m4.png"))

    # 2. a goal
    set_code(page, 'import Base\n\ndef f(x: U32, b: Bool) -> U32:\n  ?goal\n')
    page.wait_for_selector("#verdict[data-state=goal]", timeout=10000)
    print("2 verdict:", page.inner_text("#verdict-text"))

    # 3. auto-indent: Enter after ':'
    set_code(page, 'import Base\n\ndef main() -> U32:')
    page.keyboard.press("Enter")
    page.keyboard.type("42")
    val = page.evaluate("document.querySelector('#ed-ta').value")
    print("3 value:", repr(val))
    wait_state(page, "ok")

    # key bar
    page.click("#keys button:has-text('->')")
    print("3b after key:", repr(page.evaluate("document.querySelector('#ed-ta').value")[-6:]))

    # 4. examples → proof demo
    page.click("#btn-examples")
    time.sleep(0.2)
    page.screenshot(path=shot("shot_m5.png"))
    page.click(".ex:has-text('Tri par insertion')")
    wait_state(page, "ok")
    page.wait_for_function("!document.querySelector('#laws').hidden", timeout=20000)
    print("4 laws:", page.inner_text("#laws"), "| files:", page.evaluate("[...document.querySelectorAll('.file')].map(f => f.textContent + ':' + f.className)"))
    page.screenshot(path=shot("shot_m6.png"))
    page.click("#run")
    page.wait_for_function("document.querySelector('#log').textContent.includes('exécuté')", timeout=20000)
    print("4 log:", repr(page.inner_text("#log")))

    # break the sort: laws must fail
    code = page.evaluate("document.querySelector('#ed-ta').value").replace("      x <> h <> t\n", "      h <> x <> t\n")
    set_code(page, code)
    page.wait_for_function("document.querySelector('#laws').dataset.state === 'bad'", timeout=30000)
    print("4b laws:", page.inner_text("#laws"), "|", page.get_attribute("#laws", "title")[:160])
    page.evaluate("document.querySelector('#ed-ta').blur()")
    page.screenshot(path=shot("shot_m7.png"))

    # 5. tabs
    page.click("#btn-guide")
    time.sleep(0.4)
    print("5 guide h2:", page.evaluate("document.querySelectorAll('#guide h2, #guide h3').length"), "try:", page.evaluate("document.querySelectorAll('#guide .try').length"))
    page.screenshot(path=shot("shot_m8.png"))
    page.click(".tab[data-tab=base]")
    time.sleep(0.3)
    page.fill("#base-q", "List.map")
    time.sleep(0.3)
    print("5 base hits:", page.evaluate("document.querySelectorAll('#base-list .decl').length"))
    page.screenshot(path=shot("shot_m9.png"))
    page.click(".tab[data-tab=js]")
    page.wait_for_function("document.querySelector('#js-info').textContent !== 'Compilation…'", timeout=20000)
    print("5 js info:", page.inner_text("#js-info"), "| code len:", page.evaluate("document.querySelector('#js-code').textContent.length"))

    # 6. stop a long run
    page.click("#chev")
    page.click("#btn-examples")
    page.click(".ex:has-text('Hello, world')")
    wait_state(page, "ok")
    set_code(page, 'import Base\n\ndef main() -> IO(Unit):\n  do IO<Unit>:\n    IO.print("avant")\n    IO.sleep(60000)\n    IO.print("après")\n')
    wait_state(page, "ok")
    page.click("#run")
    page.wait_for_function("document.querySelector('#log').textContent.includes('avant')", timeout=20000)
    print("6 busy:", page.get_attribute("#run", "data-busy"))
    page.click("#run")
    page.wait_for_function("document.querySelector('#log').textContent.includes('Arrêté')", timeout=5000)
    print("6 log:", repr(page.inner_text("#log")))

    # 7. persistence
    page.reload()
    wait_state(page, "ok")
    print("7 persisted:", "IO.sleep(60000)" in page.evaluate("document.querySelector('#ed-ta').value"))
    b.close()

for k, v in logs:
    print(k, v[:300])
