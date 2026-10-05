import time, json
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
OLD = json.dumps({"current": "x", "order": [], "live": True, "size": 14, "lang": "en", "ai": {"provider": "custom", "url": "http://localhost:11434", "model": "llama3", "key": ""}})
MOCK = """window.__prompts = []; window.claude = { use: async (n) => n === 'sample' ? Object.assign(async (input, opts) => { window.__prompts.push({ tier: opts && opts.modelTier }); return { text: '```python\\n{==}\\n```' }; }, { json: async () => ({}) }) : null };"""
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US")
    def models(route):
        u = route.request.url
        if "11434/v1/models" in u:
            route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps({"data": [{"id": "qwen3-coder"}, {"id": "llama3"}, {"id": "deepseek-r1"}]}))
        elif "9999/v1/models" in u:
            route.fulfill(status=404, body="no", headers={"access-control-allow-origin": "*"})
        elif "9999/api/tags" in u:
            route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps({"models": [{"name": "gemma3:4b"}]}))
        elif "/v1/chat/completions" in u:
            body = json.loads(route.request.post_data)
            route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps({"choices": [{"message": {"content": "model " + body["model"] + "\\n```python\\n{==}\\n```"}}]}))
        else:
            route.continue_()
    ctx.route("http://localhost:11434/**", models); ctx.route("http://localhost:9999/**", models)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.add_init_script("if (!localStorage.getItem('seed')) { localStorage.setItem('seed', '1'); localStorage.setItem('bend-play:v2', " + json.dumps(OLD) + "); }")
    page.add_init_script(MOCK)
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1.5)
    page.click("#btn-settings"); time.sleep(1.2)
    box = page.locator(".ai-box")
    sels = box.locator("select")
    print("1 migrated profiles:", sels.nth(0).evaluate("s => [...s.options].map(o => o.text)"), "| active:", sels.nth(0).input_value() != "")
    print("1 model list:", sels.nth(2).evaluate("s => [...s.options].map(o => o.text)"), "| picked:", sels.nth(2).input_value(), "| status:", box.locator(".ai-status").inner_text())
    sels.nth(2).select_option("qwen3-coder"); time.sleep(0.2)
    print("1 free text now:", box.locator(".ai-rows input").nth(2).input_value())
    # a second profile: Ollama on another port, with /api/tags only
    box.locator(".btn", has_text="New profile").click(); time.sleep(0.4)
    box = page.locator(".ai-box"); sels = box.locator("select")
    print("2 provider default (viewer has Claude):", sels.nth(1).input_value())
    sels.nth(1).select_option("custom"); time.sleep(0.4)
    box = page.locator(".ai-box")
    box.locator(".ai-rows input").nth(0).fill("Ollama 4b"); box.locator(".ai-rows input").nth(0).dispatch_event("change"); time.sleep(0.3)
    box = page.locator(".ai-box")
    box.locator(".ai-rows input").nth(1).fill("http://localhost:9999"); time.sleep(1.6)
    box = page.locator(".ai-box"); sels = box.locator("select")
    print("2 tags list:", sels.nth(2).evaluate("s => [...s.options].map(o => o.text)"), "| status:", box.locator(".ai-status").inner_text())
    sels.nth(2).select_option("gemma3:4b"); time.sleep(0.2)
    # a Claude profile with a tier
    box.locator(".btn", has_text="New profile").click(); time.sleep(0.4)
    box = page.locator(".ai-box"); sels = box.locator("select")
    print("3 claude tiers:", sels.nth(2).evaluate("s => [...s.options].map(o => o.text)"))
    sels.nth(2).select_option("complex"); time.sleep(0.2)
    print("3 profiles:", page.locator(".ai-box select").nth(0).evaluate("s => [...s.options].map(o => o.text)"))
    page.click(".sheet-head button")
    stored = page.evaluate("JSON.parse(localStorage.getItem('bend-play:v2')).ai")
    print("4 stored:", [(p["name"], p["provider"], p["model"]) for p in stored["profiles"]])
    # ask with each: the sheet's profile picker
    page.evaluate("""() => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, 'import Base\\n\\ndef f() -> {0n == 0n : Nat}:\\n  ?g\\n'); }""")
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(0.8)
    page.locator(".goal-head .chip", has_text="AI").click(); time.sleep(0.3)
    pick = page.locator(".sheet select")
    print("5 sheet profiles:", pick.evaluate("s => [...s.options].map(o => o.text)"), "| note:", page.inner_text(".ai-note")[:40])
    page.click(".sheet .btn:has-text('Ask')"); time.sleep(0.8)
    print("5 claude tier sent:", page.evaluate("window.__prompts"))
    pick.select_option(label="Ollama 4b"); page.click(".sheet .btn:has-text('Ask')")
    page.wait_for_function("() => !document.querySelector('.ai-out').textContent.startsWith('Thinking')", timeout=15000)
    print("5 ollama answer:", page.inner_text(".ai-out")[:30].replace("\n", "/"))
    pick.select_option(label="OpenAI-compatible URL"); page.click(".sheet .btn:has-text('Ask')"); time.sleep(0.3)
    page.wait_for_function("() => !document.querySelector('.ai-out').textContent.startsWith('Thinking') && !document.querySelector('.ai-out').textContent.includes('gemma')", timeout=15000)
    print("5 migrated answer:", page.inner_text(".ai-out")[:30].replace("\n", "/"))
    page.screenshot(path=shot("shot_ai.png"))
    for e in errs: print("!!", e[:200])
    b.close()
