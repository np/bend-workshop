import time, json
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
PROOF = "import Base\n\nlaw add_zero:\n  for x: Nat\n  {Nat.add(x, 0n) == x : Nat}\n\ndef add_zero(x):\n  match x:\n    case 0n:\n      ?base\n    case 1n+p:\n      %add_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}\n      ?step\n"
CORS = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, GET, OPTIONS"}
state = {"anthropic": 0, "openai": 0, "bodies": []}
def anthropic(route):
    if route.request.method == "OPTIONS": return route.fulfill(status=204, headers=CORS)
    if route.request.method == "GET": return route.fulfill(status=200, content_type="application/json", headers=CORS, body=json.dumps({"data": [{"id": "claude-sonnet-4-6"}]}))
    body = json.loads(route.request.post_data); state["bodies"].append(body); n = state["anthropic"]; state["anthropic"] += 1
    if n == 0: content = [{"type": "text", "text": "Let me look."}, {"type": "tool_use", "id": "t1", "name": "check", "input": {}}]
    elif n == 1: content = [{"type": "tool_use", "id": "t2", "name": "fill_hole", "input": {"hole": "base", "code": "{==}"}}, {"type": "tool_use", "id": "t3", "name": "fill_hole", "input": {"hole": "step", "code": "{==}"}}]
    else: content = [{"type": "text", "text": "Both holes are filled and the checker agrees.\nSTATUS: done"}]
    route.fulfill(status=200, content_type="application/json", headers=CORS, body=json.dumps({"content": content, "stop_reason": "tool_use" if n < 2 else "end_turn"}))
def openai(route):
    if route.request.method == "OPTIONS": return route.fulfill(status=204, headers=CORS)
    if "/v1/models" in route.request.url: return route.fulfill(status=200, content_type="application/json", headers=CORS, body=json.dumps({"data": [{"id": "qwen3-coder"}]}))
    body = json.loads(route.request.post_data); state["bodies"].append(body); n = state["openai"]; state["openai"] += 1
    if n == 0: msg = {"role": "assistant", "content": None, "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "fill_hole", "arguments": json.dumps({"hole": "base", "code": "{==}"})}}]}
    elif n == 1: msg = {"role": "assistant", "content": "", "tool_calls": [{"id": "c2", "type": "function", "function": {"name": "fill_hole", "arguments": json.dumps({"hole": "step", "code": "{==}"})}}]}
    else: msg = {"role": "assistant", "content": "Done.\nSTATUS: done"}
    route.fulfill(status=200, content_type="application/json", headers=CORS, body=json.dumps({"choices": [{"message": msg}]}))
def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
with sync_playwright() as p:
    b = p.chromium.launch()
    for prov in ["anthropic", "custom"]:
        ctx = b.new_context(viewport={"width": 390, "height": 780}, locale="fr-FR", is_mobile=True, has_touch=True)
        ctx.route("https://api.anthropic.com/**", anthropic); ctx.route("http://localhost:11434/**", openai)
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
        page.click("#btn-settings"); page.locator(".ai-box .btn", has_text="Nouveau profil").click(); time.sleep(0.4)
        page.locator(".ai-box select").nth(1).select_option(prov); time.sleep(0.5)
        if prov == "anthropic": page.locator(".ai-rows input[type=password]").fill("sk-test")
        page.click(".sheet-head button"); time.sleep(0.3)
        set_code(page, PROOF); page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(1)
        page.evaluate("document.querySelector('#ed-ta').blur()")
        page.click("#chev"); time.sleep(0.3)
        page.locator(".tab[data-tab=agent]").scroll_into_view_if_needed(); page.click(".tab[data-tab=agent]"); time.sleep(0.4)
        page.click(".agent-form .btn:has-text('Démarrer')")
        page.wait_for_selector(".ag-verdict", timeout=30000); time.sleep(0.5)
        print("==", prov, "| final:", page.inner_text(".ag-verdict"), "| journal:", [x.split("\n")[0][:40] for x in page.locator(".ag-tool").all_inner_texts()])
        print("   said:", [x[:60] for x in page.locator(".ag-say").all_inner_texts()])
        last = state["bodies"][-1]
        if prov == "anthropic":
            print("   round 3 got:", [(m["role"], [c.get("type") for c in m["content"]] if isinstance(m["content"], list) else "text") for m in last["messages"]], "| system cached:", last["system"][0].get("cache_control"), "| tools:", [t["name"] for t in last["tools"]])
        else:
            print("   round 3 got:", [(m["role"], m.get("tool_call_id", "")) for m in last["messages"]], "| tools:", [t["function"]["name"] for t in last["tools"]])
        if prov == "custom": page.screenshot(path=shot("shot_agent_m.png"), full_page=False)
        for e in errs: print("!!", e[:200])
        ctx.close()
    b.close()
