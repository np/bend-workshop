# ?TODO shows in the goals as a named hole does: a card with its context
# and goal, each ?TODO a card of its own; and while the agent works, a guide
# snippet cannot open over the project.
import time
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
CODE = "import Base\n\ndef f(x: Nat) -> {Nat.add(x, 0n) == x : Nat}:\n  match x:\n    case 0n:\n      ?TODO\n    case 1n+p:\n      ?step\n\ndef g(n: Nat) -> Nat:\n  ?TODO\n"
MOCK = """window.claude = { use: async (n) => n === 'sample' ? Object.assign(async (input, opts) => {
  await new Promise((r) => setTimeout(r, 4000)); return { text: 'Done.\\nSTATUS: blocked', truncated: false };
}, { limits: async () => ({ tools: { maxCount: 16 }, maxPromptBytes: 262144 }), json: async () => ({}) }) : null };"""
def check(label, *oks):
    print(label, *oks)
    assert all(o is True for o in oks if isinstance(o, bool)), label
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US")
    ctx.add_init_script(MOCK)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(0.8)
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", CODE)
    page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(0.8)
    names = [x.split("\n")[0] for x in page.locator(".goal .goal-head").all_inner_texts()]
    body = page.inner_text(".goals")
    check("1 TODO cards:", names, sum(1 for n in names if n.startswith("?TODO")) == 2, "?step" in body, "{0n == 0n : Nat}" in body,
          page.inner_text("#verdict-text").startswith("3 goals"))
    # 2 Constructors fills a ?TODO like a named hole
    card = page.locator(".goal", has=page.locator(".goal-head", has_text="?TODO")).first
    chips = card.locator(".goal-head .chip").all_inner_texts()
    print("   chips:", chips)
    card.locator(".goal-head .chip", has_text="Solve").click(); time.sleep(0.8)
    check("2 filled:", "      {==}\n    case 1n+p" in page.eval_on_selector("#ed-ta", "t => t.value"))
    # 3 the agent at work: a guide snippet does not open
    page.click("#btn-settings"); page.locator(".ai-box .btn", has_text="New profile").click(); time.sleep(0.3); page.click(".sheet-head button")
    page.click(".tab[data-tab=agent]"); time.sleep(0.3)
    page.click(".agent-form .btn:has-text('Start')"); time.sleep(0.8)
    page.click(".tab[data-tab=guide]"); time.sleep(0.4)
    before = page.inner_text("#proj-name")
    page.locator("#guide .try").first.click(); time.sleep(0.5)
    check("3 no snippet over the project:", page.inner_text("#proj-name") == before, "agent is at work" in page.inner_text("#status"))
    for e in errs: print("!!", e[:200])
    assert not errs
    b.close()
