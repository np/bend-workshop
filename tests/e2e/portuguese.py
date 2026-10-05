# Portuguese: chosen from a pt-BR browser, picked in Settings, and spoken by
# the header, the examples, About, goal cards, the compiler outputs and the agent.
import time
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
MOCK = "window.claude = { use: async (n) => n === 'sample' ? Object.assign(async () => ({ text: 'ok' }), { limits: async () => ({ tools: { maxCount: 16 } }) }) : null };"
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 390, "height": 780}, locale="pt-BR", is_mobile=True, has_touch=True).new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.add_init_script(MOCK)
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    print("1 detected:", page.evaluate("document.documentElement.lang"), "|", [x.strip() for x in page.locator(".top button").all_inner_texts()][1:3],
          "| run:", page.inner_text("#run-lbl"), "| check:", page.inner_text("#check .lbl"))
    page.click("#btn-examples"); time.sleep(0.3)
    print("2 examples:", page.locator(".group").first.inner_text(), "|", [x.split("\n")[0] for x in page.locator(".ex").all_inner_texts()][:4])
    page.locator(".ex", has_text="Ordenação por inserção").click(); time.sleep(1.5)
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    print("3 verdict:", page.inner_text("#verdict-text")[:30], "| laws:", page.inner_text("#laws"))
    page.click("#btn-about"); time.sleep(0.3)
    print("4 about:", page.inner_text(".sheet-head h2"), "|", page.inner_text(".about")[:70].replace("\n", " "))
    page.click(".sheet-head button")
    page.evaluate("""() => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, 'import Base\\n\\ndef f(xs: List<U32>, n: Nat) -> U32:\\n  ?g\\n'); }""")
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(1.2); page.evaluate("document.querySelector('#ed-ta').blur()")
    print("5 goal card:", page.inner_text("#goals-count"), "|", page.locator(".goal-head .chip").all_inner_texts(), "| verdict:", page.inner_text("#verdict-text")[:22])
    page.screenshot(path=shot("shot_pt.png"))
    page.click("#chev"); time.sleep(0.2)
    print("6 tabs:", page.locator(".tab:visible").all_inner_texts())
    page.click("#btn-settings"); time.sleep(0.3)
    print("7 settings:", page.inner_text(".sheet-head h2"), "|", page.locator(".sheet .row .btn").all_inner_texts()[:3])
    page.locator(".sheet .btn", has_text="English").click(); time.sleep(0.6)
    print("8 switched:", page.inner_text(".sheet-head h2"), "| lang:", page.evaluate("document.documentElement.lang"))
    page.locator(".sheet .btn", has_text="Português").click(); time.sleep(0.6)
    print("9 back:", page.inner_text(".sheet-head h2"), "| stored:", page.evaluate("JSON.parse(localStorage.getItem('bend-play:v2')).lang"))
    for e in errs: print("!!", e[:200])
    b.close()
