"""What one Claude call hands the next: the earlier messages, the tool calls
with what they returned (a repeated read once, a read of a quoted project
file not repeated), the NEXT: plan; and the profile's own agent limits."""
import time
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
MOCK = """window.__plan = []; window.__inputs = []; window.__says = [];
window.claude = { use: async (n) => n === 'sample' ? Object.assign(async (input, opts) => {
  window.__inputs.push(input);
  const tools = opts.tools || [];
  const call = async (name, args) => { const tl = tools.find(t => t.name === name);
    try { return await tl.execute(args, { signal: opts.signal }); } catch (e) { return 'Error: ' + e.message; } };
  for (const [name, args] of (window.__plan.shift() || [])) await call(name, args);
  const text = window.__says.shift() || 'Done.\\nSTATUS: done';
  if (opts.onText) opts.onText({ text, delta: text });
  return { text, truncated: false };
}, { limits: async () => ({ tools: { maxCount: 16 }, maxPromptBytes: window.__maxp || 262144 }), json: async () => ({}) }) : null };"""
PROOF = "import Base\n\nlaw add_zero:\n  for x: Nat\n  {Nat.add(x, 0n) == x : Nat}\n\ndef add_zero(x):\n  match x:\n    case 0n:\n      ?base\n    case 1n+p:\n      ?step\n"
def check(label, *oks):
    print(label, *oks)
    assert all(o is True for o in oks if isinstance(o, bool)), label
def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
def run(page, plan, says):
    page.evaluate("([p, s]) => { window.__plan = p; window.__says = s; window.__inputs = []; }", [plan, says])
    page.click(".agent-form .btn:has-text('Start')")
    page.wait_for_selector(".ag-verdict", timeout=30000); time.sleep(0.4)
    return page.evaluate("window.__inputs")
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.add_init_script(MOCK)
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1.2)
    page.click("#btn-settings"); page.locator(".ai-box .btn", has_text="New profile").click(); time.sleep(0.4)
    page.click(".ai-limits > summary"); time.sleep(0.2)
    print("1 limits:", page.locator(".ai-limits label").all_inner_texts())
    defaults = page.eval_on_selector_all(".ai-limits input", "xs => xs.map(x => x.placeholder)")
    check("1 defaults:", defaults, defaults == ["40000", "6000", "40", "1000", "8000"])
    page.click(".sheet-head button")
    set_code(page, PROOF); page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(1.0)
    page.click(".tab[data-tab=agent]"); time.sleep(0.3)
    page.fill(".agent-form textarea", "Prove add_zero.")
    plan = [[["lookup", {"name": "Nat.add"}], ["read_file", {"path": "main.bend"}], ["lookup", {"name": "Nat.add"}], ["check", {}]],
            [["fill_hole", {"hole": "base", "code": "{==}"}]]]
    says = ["Looked around.\nNEXT: fill ?base with {==}, then ?step by induction.\nSTATUS: continue", "Done.\nSTATUS: done"]
    ins = run(page, plan, says)
    second = ins[1]
    so = second[second.index("<so_far>"):second.index("</so_far>")]
    check("2 calls:", len(ins) == 2, "| call 2 says:", "call 2 of a session" in so)
    check("2 plan:", "<plan>" in so and "fill ?base with {==}" in so)
    check("2 earlier message:", "Looked around." in so)
    check("2 lookup once, with its result:", so.count('lookup {"name":"Nat.add"}') == 1, "Nat.add" in so.split("lookup", 2)[-1][:400])
    check("2 read not repeated:", "is in <files>" in so)
    check("2 continuing rule:", "You are continuing this session" in second)
    check("2 asked for NEXT:", "NEXT:" in ins[0])
    # limits: one tool call handed on
    page.click(".agent-end .btn:has-text('New session')"); time.sleep(0.3)
    page.click("#btn-settings"); time.sleep(0.3)
    if page.locator(".ai-limits").get_attribute("open") is None:
        page.click(".ai-limits > summary")
    page.locator(".ai-limits label", has_text="Tool calls handed").locator("input").fill("1"); time.sleep(0.2)
    page.click(".sheet-head button")
    page.fill(".agent-form textarea", "Prove add_zero.")
    ins = run(page, [[["lookup", {"name": "Nat.add"}], ["list_holes", {}]], []], ["Half.\nNEXT: more\nSTATUS: continue", "Done.\nSTATUS: done"])
    so = ins[1][ins[1].index("<so_far>"):]
    check("3 one call kept:", "The last 1 of them" in so, "list_holes" in so, "lookup {" not in so)
    page.screenshot(path=shot("shot_agent_memory.png"))
    # the prompt stays under what sample.limits() reports: a small cap sends
    # the quoted files away
    ctx2 = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US")
    ctx2.add_init_script("window.__maxp = 40000;\n" + MOCK)
    page = ctx2.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1.2)
    page.click("#btn-settings"); page.locator(".ai-box .btn", has_text="New profile").click(); time.sleep(0.4)
    page.click(".sheet-head button")
    set_code(page, PROOF + "\n" + "".join("# padding line %05d, to make the file large enough\n" % i for i in range(600)))
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(1.0)
    page.click(".tab[data-tab=agent]"); time.sleep(0.3)
    page.fill(".agent-form textarea", "Prove add_zero.")
    ins = run(page, [[]], ["Done.\nSTATUS: done"])
    size = len(ins[0].encode())
    check("4 under the reported cap:", size, size <= 32000, "| files sent away:", "<files>" not in ins[0], "too large to quote" in ins[0])
    print("errors:", errs)
    for e in errs: print("!! " + e)
    b.close()
