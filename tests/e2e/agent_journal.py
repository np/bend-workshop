"""The agent's journal and its ends: a reply without a STATUS line is
taken up again by the page; done while a hole is open too; the journal is
newest first, each entry with its time of day, unfolding into its own
events (the prompt, the reply, the tool's answer); the conversation links
back to the journal; the user's own instructions reach the prompt; the
memory's summaries are an entry of their own."""
import re, time
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
MOCK = """window.__plan = []; window.__inputs = []; window.__says = [];
window.claude = { use: async (n) => n === 'sample' ? Object.assign(async (input, opts) => {
  if (opts.modelTier === 'quick' && !opts.tools) return { text: 'summary', truncated: false };
  window.__inputs.push(input);
  const tools = opts.tools || [];
  for (const [name, args] of (window.__plan.shift() || [])) { const tl = tools.find(t => t.name === name); try { await tl.execute(args, {}); } catch (e) {} }
  const text = window.__says.shift() || 'Nothing more.\\nSTATUS: blocked';
  if (opts.onText) opts.onText({ text, delta: text });
  return { text, truncated: false };
}, { limits: async () => ({ tools: { maxCount: 16 }, maxPromptBytes: 262144 }), json: async () => ({}) }) : null };"""
PROOF = "import Base\n\ndef add_zero(x: Nat) -> {Nat.add(x, 0n) == x : Nat}:\n  match x:\n    case 0n:\n      ?base\n    case 1n+p:\n      ?step\n"

def check(label, *oks):
    print(label, *oks)
    assert all(o is True for o in oks if isinstance(o, bool)), label

errs = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 900}, locale="en-US")
    ctx.add_init_script(MOCK)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(1.0)
    # the user's own instructions, in Settings
    page.click("#btn-settings"); page.locator(".ai-box .btn", has_text="New profile").click(); time.sleep(0.3)
    page.click(".ai-instr > summary"); time.sleep(0.2)
    page.fill("#ai-instructions", "Always name lemmas in snake_case.")
    page.click(".ai-instr .cv-fold > summary"); time.sleep(0.2)
    rules = page.inner_text(".ai-instr .cv-pre")
    check("1 rules shown:", "agent at work" in rules, "STATUS: done" in rules)
    page.click(".sheet-head button")
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", PROOF)
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(0.8)
    page.click(".tab[data-tab=agent]"); time.sleep(0.3)
    # hole session on ?base: the first reply has no STATUS (relaunched), the
    # second says done with ?base filled
    page.locator(".agent-form .chip", has_text="Only chosen holes").click(); time.sleep(0.2)
    page.evaluate("""() => { window.__plan = [[['check', {}]], [['fill_hole', {hole: 'base', code: '{==}'}]]];
      window.__says = ['Looked at it.', 'Filled.\\nSTATUS: done']; }""")
    page.click(".agent-form .btn:has-text('Start')")
    page.wait_for_selector(".ag-verdict", timeout=30000); time.sleep(0.6)
    ins = page.evaluate("window.__inputs")
    check("2 relaunched once:", len(ins), len(ins) == 2, "your message ended without a STATUS line" in ins[1],
          "Always name lemmas in snake_case." in ins[0], ins[0].index("Always name lemmas") < ins[0].index("<chat>\n"))
    items = page.locator(".agent-log > .ag-item")
    first = items.first.inner_text()
    times = page.locator(".ag-when > span").all_inner_texts()
    notes = page.locator(".ag-note").all_inner_texts()
    check("3 newest first, timed:", "Final check" in first or "check" in first.lower(), all(re.match(r"^\d\d:\d\d:\d\d$", x) for x in times if x),
          any("Relaunched by the page" in n for n in notes))
    # 4 a reply unfolds into its call and its reply
    say = page.locator(".agent-log > .ag-item", has=page.locator(".ag-say", has_text="Filled.")).first
    say.locator(".ag-unfold").click(); time.sleep(0.3)
    say = page.locator(".agent-log > .ag-item", has=page.locator(".ag-say", has_text="Filled.")).first
    heads = say.locator(".ag-events .cv-head").all_inner_texts()
    check("4 unfolded:", heads, any("Claude call" in h or "call" in h.lower() for h in heads), any("answer" in h.lower() for h in heads))
    # 5 from the conversation back to the journal
    page.locator(".agent-modes .chip", has_text="Conversation").click(); time.sleep(0.3)
    first_head = page.locator(".cv-head").first.inner_text()
    check("5 conversation newest first, with clock:", re.match(r"^\d\d:\d\d:\d\d · \+", first_head) is not None)
    page.locator(".cv .cv-to-j").nth(3).click(); time.sleep(0.3)
    check("5 back in the journal, unfolded:", page.locator(".agent-modes .chip.on").inner_text() == "Journal", page.locator(".ag-events").count() >= 1)
    page.screenshot(path=shot("shot_agent_journal.png"))
    for e in errs: print("!!", e[:200])
    assert not errs
    b.close()
