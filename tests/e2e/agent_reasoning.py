# Reasoning, a profile's setting: with Anthropic, adaptive thinking with
# its summaries and an effort go in the request (and more room for tokens);
# the thinking block comes back to the model unchanged within the turn; the
# journal shows its summary, folded. Without the setting, nothing is sent.
import time, json
from playwright.sync_api import sync_playwright
from serve import serve
serve("dist", 8123)
PROOF = "import Base\n\ndef add_zero(x: Nat) -> {Nat.add(x, 0n) == x : Nat}:\n  match x:\n    case 0n:\n      ?base\n    case 1n+p:\n      ?step\n"
CORS = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, GET, OPTIONS"}
THINK = {"type": "thinking", "thinking": "The base case is reflexive: Nat.add(0n, 0n) reduces to 0n.", "signature": "sig-abc"}
state = {"n": 0, "bodies": []}
def anthropic(route):
    if route.request.method == "OPTIONS": return route.fulfill(status=204, headers=CORS)
    if route.request.method == "GET": return route.fulfill(status=200, content_type="application/json", headers=CORS, body=json.dumps({"data": [{"id": "claude-opus-5-5"}]}))
    body = json.loads(route.request.post_data); state["bodies"].append(body); n = state["n"]; state["n"] += 1
    if n % 2 == 0: content = [THINK, {"type": "tool_use", "id": "t1", "name": "fill_hole", "input": {"hole": "base", "code": "{==}"}}]
    else: content = [{"type": "text", "text": "Filled.\nSTATUS: done"}]
    route.fulfill(status=200, content_type="application/json", headers=CORS, body=json.dumps({"content": content, "stop_reason": "tool_use" if n % 2 == 0 else "end_turn"}))
def check(label, *oks):
    print(label, *oks)
    assert all(o is True for o in oks if isinstance(o, bool)), label
def session(page):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", PROOF)
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(0.8)
    page.click(".tab[data-tab=agent]"); time.sleep(0.3)
    if page.locator(".agent-end .btn:has-text('New session')").count():
        page.click(".agent-end .btn:has-text('New session')"); time.sleep(0.3)
    page.click(".agent-form .btn:has-text('Start')")
    page.wait_for_selector(".ag-verdict", timeout=30000); time.sleep(0.5)
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 900}, locale="en-US")
    ctx.route("https://api.anthropic.com/**", anthropic)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(0.8)
    page.click("#btn-settings"); page.locator(".ai-box .btn", has_text="New profile").click(); time.sleep(0.4)
    page.locator(".ai-box select").nth(1).select_option("anthropic"); time.sleep(0.5)
    page.locator(".ai-rows input[type=password]").fill("sk-test")
    # 1 without the setting: no thinking, no effort, the old token room
    page.click(".sheet-head button"); time.sleep(0.3)
    session(page)
    first = state["bodies"][0]
    check("1 default:", first["model"], "thinking" not in first, "output_config" not in first, first["max_tokens"] == 4096)
    # 2 adaptive and high effort
    page.click("#btn-settings"); time.sleep(0.3)
    page.locator(".ai-rows select[aria-label=Reasoning]").select_option("adaptive")
    page.locator(".ai-rows select[aria-label=Effort]").select_option("high"); time.sleep(0.3)
    page.click(".sheet-head button"); time.sleep(0.3)
    state["bodies"].clear()
    session(page)
    a, bb = state["bodies"][0], state["bodies"][1]
    check("2 request:", a.get("thinking"), a.get("output_config"), a["max_tokens"],
          a.get("thinking") == {"type": "adaptive", "display": "summarized"}, a.get("output_config") == {"effort": "high"}, a["max_tokens"] == 16000)
    sent_back = [c for m in bb["messages"] if m["role"] == "assistant" for c in m["content"]]
    check("2 the block goes back unchanged:", sent_back[0] == THINK)
    page.locator(".ag-think > summary").first.click(); time.sleep(0.2)
    check("2 journal shows the summary:", "reflexive" in page.inner_text(".ag-think-text"))
    for e in errs: print("!!", e[:200])
    assert not errs
    b.close()
