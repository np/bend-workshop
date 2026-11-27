# The memory with an API (a simulated Anthropic server): past its budget,
# lines merge through the compactor (Haiku, its own system prompt); a turn
# whose conversation outgrows the context's own limit is compacted, its
# first steps summarised by Haiku into <so_far>, and goes on; the next
# session starts from the memory, merged.
import json, time, re
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
CORS = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, GET, OPTIONS"}
reqs = []
state = {"k": 0}
def anthropic(route):
    if route.request.method == "OPTIONS": return route.fulfill(status=204, headers=CORS)
    if route.request.method == "GET": return route.fulfill(status=200, content_type="application/json", headers=CORS, body=json.dumps({"data": [{"id": "claude-x"}]}))
    body = json.loads(route.request.post_data)
    reqs.append(body)
    if isinstance(body.get("system"), str) and body["system"].startswith("You compact an agent's working context"):
        return route.fulfill(status=200, content_type="application/json", headers=CORS,
                             body=json.dumps({"content": [{"type": "text", "text": "SOFAR: read main.bend again and again"}]}))
    if isinstance(body.get("system"), str) and body["system"].startswith("You write an agent's memory"):
        return route.fulfill(status=200, content_type="application/json", headers=CORS,
                             body=json.dumps({"content": [{"type": "text", "text": "merged: lookups and reads of main.bend"}]}))
    k = state["k"]; state["k"] += 1
    content = [{"type": "tool_use", "id": "t%d" % k, "name": "read_file", "input": {"path": "main.bend"}}] if k < 10 else \
              [{"type": "text", "text": "Read it ten times.\nSTATUS: done"}]
    route.fulfill(status=200, content_type="application/json", headers=CORS, body=json.dumps({"content": content}))
PROOF = "import Base\n\nlaw add_zero:\n  for x: Nat\n  {Nat.add(x, 0n) == x : Nat}\n\ndef add_zero(x):\n  match x:\n    case 0n:\n      ?base\n    case 1n+p:\n      ?step\n"
def check(label, *oks):
    print(label, *oks)
    assert all(o is True for o in oks if isinstance(o, bool)), label
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US")
    ctx.route("https://api.anthropic.com/**", anthropic)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000)
    page.click("#btn-settings"); page.locator(".ai-box .btn", has_text="New profile").click(); time.sleep(0.4)
    page.locator(".ai-box select").nth(1).select_option("anthropic"); time.sleep(0.3)
    page.locator(".ai-rows input[type=password]").fill("sk-x"); time.sleep(0.5)
    page.click(".ai-limits > summary"); time.sleep(0.2)
    page.locator(".ai-limits label", has_text="Project quoted").locator("input").fill("100")
    page.locator(".ai-limits label", has_text="memory in each call").locator("input").fill("1500")
    page.locator(".ai-limits label", has_text="The turn's conversation").locator("input").fill("3000")
    print("compactor placeholder:", page.locator(".ai-limits label", has_text="summaries").locator("input").get_attribute("placeholder"))
    time.sleep(0.5); page.click(".sheet-head button")
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", PROOF)
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); page.evaluate("document.querySelector('#ed-ta').blur()")
    page.click(".tab[data-tab=agent]"); time.sleep(0.3)
    page.fill(".agent-form textarea", "Read main.bend ten times.")
    page.click(".agent-form .btn:has-text('Start')"); page.wait_for_selector(".ag-verdict", timeout=60000); time.sleep(0.5)
    turns = [r for r in reqs if not (isinstance(r.get("system"), str) and r["system"].startswith("You "))]
    ctxs = [r for r in reqs if isinstance(r.get("system"), str) and r["system"].startswith("You compact")]
    check("1 the long turn compacted by Haiku:", len(ctxs), len(ctxs) > 0, ctxs and ctxs[0]["model"] == "claude-haiku-5-5")
    so_far = [r for r in turns if "SOFAR:" in r["messages"][0]["content"] and "<so_far>" in r["messages"][0]["content"]]
    check("2 it goes on with its summary in <so_far>, never started again:", len(so_far) > 0,
          not any(len(r["messages"]) == 1 and "(Going on:" in r["messages"][0]["content"] for r in turns))
    check("2 the journal says so:", "summarised" in page.inner_text("#pane-agent"))
    # the next session starts from the memory, merged by Haiku
    page.click(".agent-end .btn:has-text('New session')"); time.sleep(0.3)
    page.fill(".agent-form textarea", "Go on.")
    n0 = len(reqs)
    page.click(".agent-form .btn:has-text('Start')"); page.wait_for_selector(".agent-ended", timeout=60000); time.sleep(0.5)
    comps = [r for r in reqs[n0:] if isinstance(r.get("system"), str) and r["system"].startswith("You write")]
    check("3 compactions:", len(comps), len(comps) > 0, comps[0]["model"] if comps else None, comps and comps[0]["model"] == "claude-haiku-5-5",
          "| asks for one line:", comps and "Merge lines" in comps[0]["messages"][0]["content"])
    first = [r for r in reqs[n0:] if not (isinstance(r.get("system"), str) and r["system"].startswith("You "))][0]["messages"][0]["content"]
    chat = first[first.index("<chat>\n"):first.index("\n</chat>")]
    spans = [int(m) for m in re.findall(r"^\d+\+(\d+)\|", chat[7:], re.M)]
    check("3 its memory merged:", spans, max(spans) >= 2, "merged: lookups" in chat)
    page.locator(".agent-modes .chip", has_text="Conversation").click(); time.sleep(0.3)
    heads = page.locator(".cv-head").all_inner_texts()
    check("4 the conversation shows them:", any("Memory:" in h for h in heads), any("Summary by" in h for h in heads))
    for e in errs: print("!!", e[:200])
    b.close()
