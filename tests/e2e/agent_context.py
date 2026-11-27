# The context (an API's conversation in a turn) against its own limit
# (here 6000 bytes): the old tools' answers cut, then its first steps
# summarised by the memory's model into <so_far>, said in the journal; a
# word sent while a request is pending goes into the conversation before
# the next one; grep finds a line; a turn that ends unclear is relaunched
# with the same conversation, told why. A JS stand-in for the server, so
# that a request can be held while the test types.
import time, json
from playwright.sync_api import sync_playwright
from serve import serve
serve("dist", 8123)
MAIN = "import Base\n\n# BIGMARK " + "x" * 2400 + "\ndef main() -> Nat:\n  1n\n"
MOCK = r"""
window.__bodies = []; window.__sums = []; window.__n = 0; window.__holdAt = 1; window.__held = false;
const real = window.fetch;
const ok = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
const call = (id, name, args) => ({ choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] });
const say = (text) => ({ choices: [{ message: { role: 'assistant', content: text } }] });
window.fetch = async (url, opts) => {
  url = String(url);
  if (!url.startsWith('http://localhost:11434')) return real(url, opts);
  if (url.includes('/v1/models')) return ok({ data: [{ id: 'llama3' }] });
  const body = JSON.parse(opts.body);
  const first = JSON.stringify(body.messages[0] || '');
  if (first.includes("You compact an agent's working context")) { window.__sums.push(body); return ok(say('SUMMARY-XYZ: read main.bend twice, it holds BIGMARK.')); }
  window.__bodies.push(body);
  const n = window.__n++;
  if (n === window.__holdAt) { window.__held = true; await new Promise((r) => { window.__release = r; }); }
  const plan = [call('c1', 'read_file', { path: 'main.bend' }), call('c2', 'read_file', { path: 'main.bend' }),
    call('c3', 'grep', { pattern: 'def main', path: 'main.bend' }), call('c4', 'read_file', { path: 'main.bend' }),
    say('I stop here for now.'), say('Done.\nSTATUS: done')];
  return ok(plan[Math.min(n, plan.length - 1)]);
};
"""
def check(label, ok, *more):
    print(("ok   " if ok else "!! FAIL ") + label, *[str(m)[:400] for m in more])
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 900}, locale="en-US")
    ctx.add_init_script("if (!localStorage.getItem('seed')) { localStorage.setItem('seed', '1'); localStorage.setItem('bend-play:v2', %s); }"
        % json.dumps(json.dumps({"current": "x", "order": [], "live": True, "size": 14, "lang": "en", "ai": {"provider": "custom", "url": "http://localhost:11434", "model": "llama3", "key": ""}})))
    ctx.add_init_script(MOCK)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(0.8)
    # the context's own limit, in the profile's agent limits
    page.click("#btn-settings"); time.sleep(0.3)
    page.locator(".ai-limits > summary").first.click(); time.sleep(0.2)
    page.locator(".ai-limits input[aria-label^='The turn']").fill("6000"); time.sleep(0.2)
    page.click(".sheet-head button"); time.sleep(0.2)
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", MAIN)
    page.wait_for_selector("#verdict[data-state=ok]", timeout=30000); time.sleep(0.5)
    page.click(".tab[data-tab=agent]"); time.sleep(0.3)
    page.locator(".agent .chip", has_text="The project").click(); time.sleep(0.2)
    page.click(".agent-form .btn:has-text('Start')")
    # a word while the second request is pending
    page.wait_for_function("window.__held === true", timeout=30000)
    page.fill("#agent-tell", "hurry up, please"); page.click(".agent-tell .btn:has-text('Send')"); time.sleep(0.3)
    waiting = page.inner_text(".agent-tell")
    page.evaluate("window.__release()")
    page.wait_for_selector(".ag-verdict", timeout=60000); time.sleep(0.5)
    bodies = page.evaluate("window.__bodies")
    sums = page.evaluate("window.__sums")
    pane = page.inner_text("#pane-agent")
    check("the word waits for the next request", "1 message waits" in waiting, waiting)
    told = [k for k, bd in enumerate(bodies) if any("The user, while you were working: hurry up, please" in json.dumps(m) for m in bd["messages"])]
    check("the word is in the conversation from the next request on", told and told[0] == 2, told)
    check("grep found the line", any("main.bend:" in json.dumps(m) and "def main" in json.dumps(m) for m in bodies[3]["messages"] if m.get("role") == "tool"))
    check("the memory's model summarised the first steps", len(sums) >= 1)
    so_far = [k for k, bd in enumerate(bodies) if "SUMMARY-XYZ" in json.dumps(bd["messages"][1])]
    check("the summary in <so_far> of the first message", so_far, so_far)
    check("the journal says what happened to the context", "summarised" in pane and "past its 6 KB" in pane, [l for l in pane.split("\n") if "Context" in l])
    sizes = [len(json.dumps(bd["messages"][2:])) for bd in bodies]
    print("   context sizes per request:", sizes)
    # the relaunch after "I stop here" keeps the conversation
    last = bodies[-1]["messages"]
    check("relaunched with the conversation kept", any(m.get("role") == "assistant" and "I stop here" in json.dumps(m) for m in last)
          and "this conversation kept" in json.dumps(last[-1]), [m.get("role") for m in last])
    check("the journal says the context was kept", "Context kept" in pane)
    lm = last[-1]["content"] if isinstance(last[-1]["content"], str) else json.dumps(last[-1]["content"])
    print("   resumed message:", len(lm), [l[:60] for l in lm.split("\n") if l.startswith("<")])
    for e in errs: print("!!", e[:300])
    b.close()
