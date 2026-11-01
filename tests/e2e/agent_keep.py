# "Keep running when the page is hidden": on the tap that starts the
# session, a faint looping sound plays (media session titled, Stop wired
# to the agent's stop), an indicator shows; all of it stops at the end.
# Off by default: nothing plays.
import time
from playwright.sync_api import sync_playwright
from serve import serve
serve("dist", 8123)
MOCK = """window.__plays = 0; window.__last = null;
const play0 = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function () { window.__plays++; window.__last = this; return play0.call(this); };
window.claude = { use: async (n) => n === 'sample' ? Object.assign(async (input, opts) => {
  await new Promise((r) => setTimeout(r, 2500)); return { text: 'Nothing to do.\\nSTATUS: blocked', truncated: false };
}, { limits: async () => ({ tools: { maxCount: 16 }, maxPromptBytes: 262144 }), json: async () => ({}) }) : null };"""
def check(label, *oks):
    print(label, *oks)
    assert all(o is True for o in oks if isinstance(o, bool)), label
with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=user-gesture-required"])
    ctx = b.new_context(viewport={"width": 390, "height": 780}, locale="en-US", is_mobile=True, has_touch=True)
    ctx.add_init_script(MOCK)
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000); time.sleep(0.8)
    page.click("#btn-settings"); page.locator(".ai-box .btn", has_text="New profile").click(); time.sleep(0.3); page.click(".sheet-head button")
    page.click("#chev"); time.sleep(0.2); page.click(".tab[data-tab=agent]"); time.sleep(0.3)
    # 1 off by default
    check("1 off by default:", not page.locator("#agent-keep").is_checked())
    page.click(".agent-form .btn:has-text('Start')"); time.sleep(0.8)
    check("1 nothing plays:", page.evaluate("window.__plays") == 0, page.locator(".agent-awake").count() == 0)
    page.wait_for_selector(".ag-verdict", timeout=30000); time.sleep(0.4)
    page.click(".agent-end .btn:has-text('New session')"); time.sleep(0.3)
    # 2 on: plays during the session, stops after
    page.locator("#agent-keep").check()
    page.click(".agent-form .btn:has-text('Start')"); time.sleep(0.8)
    playing = page.evaluate("window.__last && !window.__last.paused && window.__last.loop")
    title = page.evaluate("navigator.mediaSession && navigator.mediaSession.metadata && navigator.mediaSession.metadata.title")
    time.sleep(0.5)
    dur = page.evaluate("window.__last.duration")
    level = page.evaluate("""async () => { const buf = await (await fetch(window.__last.src)).arrayBuffer();
      const d = new DataView(buf); let peak = 0; for (let i = 44; i < buf.byteLength; i += 2) peak = Math.max(peak, Math.abs(d.getInt16(i, true)));
      return 20 * Math.log10(peak / 32767); }""")
    check("2 long and loud enough for Chrome (>= 5 s, above -72 dBFS), yet faint:", dur, level, dur >= 5, -72 < level < -40,
          page.evaluate("navigator.mediaSession.playbackState") == "playing")
    check("2 playing:", page.evaluate("window.__plays") == 1, playing, title == "Bend agent at work", page.locator(".agent-awake").count() == 1)
    # 3 the settings, readable while it works, in the first tab
    chips = page.locator(".agent-modes .chip").all_inner_texts()
    page.locator(".agent-modes .chip", has_text="Session").click(); time.sleep(0.3)
    sv = page.inner_text(".agent-settings")
    check("3 session tab first, settings shown:", chips[0] == "Session", "Keep running" in sv, "main.bend" in sv)
    page.locator(".agent-modes .chip", has_text="Journal").click(); time.sleep(0.2)
    page.wait_for_selector(".ag-verdict", timeout=30000); time.sleep(0.4)
    check("2 stopped at the end:", page.evaluate("window.__last.paused"), page.locator(".agent-awake").count() == 0,
          page.evaluate("navigator.mediaSession.metadata === null"))
    for e in errs: print("!!", e[:200])
    assert not errs
    b.close()
