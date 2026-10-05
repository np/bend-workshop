import time
from playwright.sync_api import sync_playwright
from serve import serve, shot, fixture, frame_page
serve("dist", 8123)
LONG = "import Base\n\ndef f(a: Nat, b: Nat, c: Nat) -> {Nat.add(Nat.add(Nat.add(a, b), Nat.add(b, c)), Nat.add(Nat.add(c, a), Nat.add(a, Nat.add(b, c)))) == Nat.add(Nat.add(Nat.add(c, b), Nat.add(a, c)), Nat.add(Nat.add(b, a), Nat.add(c, Nat.add(a, b)))) : Nat}:\n  ?g\n"
def set_code(page, code):
    page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", code)
def widths(page):
    return page.evaluate("""() => { const w = (s) => Math.round(document.querySelector(s).getBoundingClientRect().width);
      return { edcol: w('.edcol'), panel: w('.panel'), list: w('.goals-list'), bodyScroll: document.querySelector('.goal-body').scrollWidth - document.querySelector('.goal-body').clientWidth,
               chips: [...document.querySelectorAll('.goal-head .chip')].map(c => Math.round(c.getBoundingClientRect().right)) }; }""")
with sync_playwright() as p:
    b = p.chromium.launch()
    for vp in [{"width": 1280, "height": 800}, {"width": 390, "height": 780}]:
        mob = vp["width"] < 500
        page = b.new_context(viewport=vp, locale="fr-FR", is_mobile=mob, has_touch=mob).new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict[data-state=ok]", timeout=30000)
        set_code(page, LONG); page.wait_for_selector("#verdict[data-state=goal]", timeout=30000); time.sleep(1.5)
        page.evaluate("document.querySelector('#ed-ta').blur()"); time.sleep(0.4)
        print(vp["width"], "widths:", widths(page))
        turn = page.locator(".goal-turn")
        print("   folded:", "folded" in turn.get_attribute("class"), "| fold btn:", turn.locator(".fold").inner_text() if turn.locator(".fold").count() else None)
        print("   shown:\n" + turn.locator(".goal-ty").inner_text())
        page.screenshot(path=shot(f"shot_pp_{vp['width']}.png"))
        if turn.locator(".fold").count() == 0:
            page.close(); continue
        if not mob:
            turn.hover(); time.sleep(0.4)
            print("   hover tip visible:", page.evaluate("!document.querySelector('#tip').hidden"), "| lines:", page.evaluate("document.querySelector('#tip').textContent.split('\\n').length"))
            page.screenshot(path=shot("shot_pp_hover.png"))
            page.mouse.move(5, 5)
        turn.locator(".fold").click(); time.sleep(0.4)
        print("   unfolded lines:", page.locator(".goal-turn .goal-ty").inner_text().count("\n") + 1, "| btn:", page.locator(".goal-turn .fold").inner_text(), "| widths:", widths(page))
        if mob: page.screenshot(path=shot("shot_pp_390_open.png"))
        for e in errs: print("!!", e[:200])
        page.close()
    b.close()
