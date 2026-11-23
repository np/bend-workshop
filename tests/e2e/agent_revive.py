# The model's server failing in a session (an OpenAI-shaped server, as
# Ollama): its model list asked for every minute (?revive_ms shortens it),
# 10 failed lists give up, once it lists, up to 30 lists for the model to
# come back; then the very same request again: the conversation goes on
# as if nothing happened. Stop cancels the wait.
import time, json
from playwright.sync_api import sync_playwright
from serve import serve
serve("dist", 8123)
PROOF = "import Base\n\nlaw add_zero:\n  for x: Nat\n  {Nat.add(x, 0n) == x : Nat}\n\ndef add_zero(x):\n  match x:\n    case 0n:\n      ?base\n    case 1n+p:\n      %add_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}\n      ?step\n"
CORS = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*"}
def check(label, ok, *more):
    print(("ok   " if ok else "!! FAIL ") + label, *[str(m)[:300] for m in more])
def run(b, plan_models, chat_fail_at, stop_during=False, label=""):
    st = {"chat": 0, "models": 0, "bodies": []}
    def server(route):
        r = route.request
        if r.method == "OPTIONS": return route.fulfill(status=204, headers=CORS)
        if "/api/tags" in r.url:
            return route.fulfill(status=500, headers=CORS, body="down")
        if "/v1/models" in r.url:
            k = st["models"]; st["models"] += 1
            what = plan_models[min(k, len(plan_models) - 1)]
            if what == "fail": return route.fulfill(status=500, headers=CORS, body="down")
            ids = ["llama3"] if what == "with" else ["other"]
            return route.fulfill(status=200, content_type="application/json", headers=CORS, body=json.dumps({"data": [{"id": i} for i in ids]}))
        n = st["chat"]; st["chat"] += 1
        st["bodies"].append(json.loads(r.post_data))
        if n == chat_fail_at: return route.fulfill(status=503, headers=CORS, body="model server restarting")
        k = n - (1 if n > chat_fail_at else 0)
        if k == 0: msg = {"role": "assistant", "content": "", "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "fill_hole", "arguments": json.dumps({"hole": "base", "code": "{==}"})}}]}
        elif k == 1: msg = {"role": "assistant", "content": "", "tool_calls": [{"id": "c2", "type": "function", "function": {"name": "fill_hole", "arguments": json.dumps({"hole": "step", "code": "{==}"})}}]}
        else: msg = {"role": "assistant", "content": "Done.\nSTATUS: done"}
        route.fulfill(status=200, content_type="application/json", headers=CORS, body=json.dumps({"choices": [{"message": msg}]}))
    ctx = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US")
    ctx.route("http://localhost:11434/**", server)
    ctx.add_init_script("if (!localStorage.getItem('seed')) { localStorage.setItem('seed', '1'); localStorage.setItem('bend-play:v2', %s); }"
                        % json.dumps(json.dumps({"current": "x", "order": [], "live": True, "size": 14, "lang": "en", "ai": {"provider": "custom", "url": "http://localhost:11434", "model": "llama3", "key": ""}})))
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html?revive_ms=40"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(0.5)
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", PROOF)
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(0.8)
    page.click(".tab[data-tab=agent]"); time.sleep(0.4)
    page.click(".agent-form .btn:has-text('Start')")
    if stop_during:
        for _ in range(100):
            if "waiting for it" in page.inner_text("#pane-agent") or "its model list" in page.inner_text("#pane-agent"): break
            time.sleep(0.05)
        page.click(".agent-run .btn:has-text('Stop')")
    page.wait_for_selector(".ag-verdict", timeout=60000); time.sleep(0.5)
    out = {"st": st, "pane": page.inner_text("#pane-agent"), "code": page.evaluate("document.querySelector('#ed-ta').value"), "errs": errs}
    ctx.close()
    return out
with sync_playwright() as p:
    b = p.chromium.launch()
    # 1 the second request fails; the list fails, then lacks the model, then has it
    # (an OpenAI-shaped server is asked /v1/models, then /api/tags: here the
    # second always fails, so a list lives or dies by the first)
    got = run(b, ["fail", "without", "with"], 1)
    bodies = got["st"]["bodies"]
    check("1 the session went on to its end", "ALL PROOFS CHECK" in got["pane"] and "?step" not in got["code"], got["pane"][:200])
    check("1 the list asked three times", got["st"]["models"] == 3, got["st"]["models"])
    check("1 the same request again, no error in the conversation", len(bodies) == 4 and bodies[1]["messages"] == bodies[2]["messages"]
          and not any("503" in json.dumps(m) or "restarting" in json.dumps(m) for m in bodies[3]["messages"]), [len(b["messages"]) for b in bodies])
    check("1 the journal says it waited and came back", "The server is back" in got["pane"])
    # 2 the list never comes: 10 tries, then the session ends with the error
    got = run(b, ["fail"], 1)
    check("2 ten lists, then given up", got["st"]["models"] == 10 and "did not come back" in got["pane"], got["st"]["models"])
    check("2 the request not sent again", got["st"]["chat"] == 2, got["st"]["chat"])
    # 3 the server lists, the model never: 30 lists, then given up
    got = run(b, ["without"], 1)
    check("3 thirty lists without the model, then given up", got["st"]["models"] == 30 and "within 30 minutes" in got["pane"], got["st"]["models"])
    # 4 Stop while waiting
    got = run(b, ["without"], 1, stop_during=True)
    check("4 Stop ends the wait", got["st"]["models"] < 30 and got["st"]["chat"] == 2, got["st"]["models"], got["st"]["chat"])
    for e in got["errs"]: print("!!", e[:200])
    b.close()
