import time, json
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
URL = "http://localhost:8123/index.html"
def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
def code(page): return page.evaluate("document.querySelector('#ed-ta').value")
def caret(page, pos): page.evaluate("(p) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.setSelectionRange(p, p); }", pos)
def sig(page): return [x.replace("\n", " | ") for x in page.locator(".sig-row").all_inner_texts()], page.evaluate("document.querySelector('.sig .arg')?.textContent")
def close_sheet(page): page.click(".sheet-head button")

MOCK = """window.claude = { use: async (n) => n === 'sample' ? Object.assign(async (input, opts) => {
  window.__prompt = input; const text = 'Here is a proof.\\n\\n```python\\n{==}\\n```\\n\\nReflexivity closes it.';
  if (opts && opts.onText) { opts.onText({ text: text.slice(0, 10), delta: text.slice(0, 10) }); }
  return { text, truncated: false }; }, { json: async () => ({}) }) : null };"""

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.add_init_script(MOCK)
    page.goto(URL); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)

    # 1. type signature with the active parameter
    set_code(page, "import Base\n\ndef f(xs: List<&1, U32>, m: Maybe<Nat>) -> U32:\n  0\n")
    time.sleep(0.6); c = code(page)
    caret(page, c.index("&1, U32") + 5); time.sleep(0.3); print("1a List arg 2:", sig(page))
    caret(page, c.index("<Nat>") + 2); time.sleep(0.3); print("1b Maybe arg 1:", sig(page))
    caret(page, c.index("-> U32") + 4); time.sleep(0.3); print("1c not a call:", sig(page))

    # 2. #goal: marks
    prog = "import Base\n\nlaw add_zero:\n  for x: Nat\n  {Nat.add(x, 0n) == x : Nat}\n\ndef add_zero(x):\n  match x:\n    case 0n:\n      {==}\n    case 1n+p:\n      #goal:\n      %add_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}\n      #goal:\n      {==}\n"
    set_code(page, prog); time.sleep(0.8); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    page.click("#check")
    for _ in range(50):
        if "#goal: {" in code(page): break
        time.sleep(0.2)
    time.sleep(0.6)
    print("2 marks:", [l.strip() for l in code(page).split("\n") if "#goal:" in l])
    # insert a mark via the key bar in the zero case, on the {==} line
    caret(page, code(page).index("      {==}\n    case 1n+p") + 6)
    page.evaluate("[...document.querySelectorAll('#keys button')].find(b => b.textContent === '#goal:').click()")
    time.sleep(1.5)
    print("2b inserted:", [l.strip() for l in code(page).split("\n") if "#goal:" in l][:1], "| verdict:", page.inner_text("#verdict-text")[:20])

    # 3. split case: now in e2e28
    # 4. law/def refactor
    set_code(page, "import Base\n\ndef add_zero(x: Nat) -> {Nat.add(x, 0n) == x : Nat}:\n  match x:\n    case 0n:\n      {==}\n    case 1n+p:\n      %add_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}\n      {==}\n")
    time.sleep(0.8); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    caret(page, code(page).index("add_zero(x:") + 2); time.sleep(0.3)
    page.locator(".sig-row").first.click(); time.sleep(0.3)
    print("4 sheet buttons:", [x for x in page.locator(".sheet .btn").all_inner_texts()])
    page.click(".sheet .btn:has-text('Split into')"); time.sleep(1.0)
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    print("4b split:", repr(code(page)[12:120]))
    caret(page, code(page).index("law add_zero") + 5); time.sleep(0.3)
    page.locator(".sig-row").first.click(); time.sleep(0.3)
    page.click(".sheet .btn:has-text('Merge')"); time.sleep(1.0)
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    print("4c merged:", repr(code(page)[12:80]), "| verdict:", page.inner_text("#verdict-text")[:16])

    # 5. assistant via the viewer's Claude
    set_code(page, "import Base\n\nlaw add_zero:\n  for x: Nat\n  {Nat.add(x, 0n) == x : Nat}\n\ndef add_zero(x):\n  match x:\n    case 0n:\n      ?base\n    case 1n+p:\n      %add_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}\n      {==}\n")
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(0.4)
    print("5 chips before config:", page.locator(".goal-head .chip").count())
    page.click("#btn-settings"); time.sleep(0.2)
    page.locator(".ai-box .btn", has_text="New profile").click(); time.sleep(0.5)
    print("5a providers:", page.locator(".ai-box select").nth(1).evaluate("s => [...s.options].map(o => o.text)"))
    close_sheet(page); time.sleep(0.3)
    page.locator(".goal-head .chip", has_text="AI").first.click(); time.sleep(0.3)
    print("5b sheet:", page.inner_text(".ai-what")[:40], "|", page.locator(".ai-req").input_value())
    page.click(".sheet .btn:has-text('Ask')"); time.sleep(1.0)
    prompt = page.evaluate("window.__prompt")
    print("5c prompt:", len(prompt), "chars | guide:", "<guide>" in prompt, "| files:", "<file name=\"main.bend\">" in prompt, "| goal:", "⊢ {0n == 0n : Nat}" in prompt)
    print("5d answer:", page.inner_text(".ai-out")[:30].replace("\n", "/"), "| insert visible:", page.locator(".sheet .btn:has-text('Insert')").is_visible())
    page.click(".sheet .btn:has-text('Insert')"); time.sleep(1.0)
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    print("5e inserted:", repr(code(page).split("case 0n:\n")[1][:12]), "| verdict:", page.inner_text("#verdict-text")[:16])
    # 5f. a custom OpenAI-shaped server, answered by a route
    page.route("http://localhost:11434/**", lambda route: route.fulfill(status=200, content_type="application/json",
        body=json.dumps({"choices": [{"message": {"content": "Try this:\n```python\n42\n```"}}]})))
    set_code(page, "import Base\n\ndef main() -> U32:\n  ?v\n")
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(0.4)
    page.click("#btn-settings"); time.sleep(0.3)
    page.locator(".ai-box select").nth(1).select_option("custom"); time.sleep(0.5)
    page.locator(".ai-rows input").nth(2).fill("local-model"); close_sheet(page); time.sleep(0.3)
    page.locator(".goal-head .chip", has_text="AI").first.click(); time.sleep(0.3)
    page.click(".sheet .btn:has-text('Ask')"); time.sleep(1.0)
    print("5f custom:", page.inner_text(".ai-out")[:20].replace("\n", "/"))
    page.click(".sheet .btn:has-text('Insert')"); time.sleep(0.8)
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
    print("5g inserted:", repr(code(page)[-6:]), "| stored:", page.evaluate("JSON.parse(localStorage.getItem('bend-play:v2')).ai"))
    page.screenshot(path=shot("shot_f5.png"))
    for e in errs: print("!!", e[:300])
    b.close()
