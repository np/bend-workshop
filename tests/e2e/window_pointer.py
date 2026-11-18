# Pointer events as Bend 2.0.40 names them: a Press and a Move with an id,
# a Tool, F32 positions and a time. The mouse is id 0; a finger takes the
# least free id (1, 2 at once), freed when it lifts; a pen hovers and
# leaves; a Press up of nothing down is dropped; the wheel is a Scroll
# toward the top; the focus comes and goes. In a worker, then on the page.
import time
from playwright.sync_api import sync_playwright
from serve import serve, shot
serve("dist", 8123)
PROG = """import Base

def tool(t: Tool) -> String:
  match t:
    case Tool.Mouse{}: "mouse"
    case Tool.Finger{f, w, h}: "finger"
    case Tool.Pen{f, ta, tx, ty, tw}: "pen"

def ud(x: Bool) -> String:
  match x:
    case True{}: "down"
    case False{}: "up"

def desc(e: Event) -> String:
  match e:
    case Press{id, t, x, y, time, button, d}: "press " ++ U32.show(id) ++ " " ++ tool(t) ++ " " ++ U32.show(button) ++ " " ++ ud(d)
    case Move{id, t, x, y, time}: "move " ++ U32.show(id) ++ " " ++ tool(t)
    case Leave{id}: "leave " ++ U32.show(id)
    case Lost{id}: "lost " ++ U32.show(id)
    case Scroll{x, y, dx, dy}: "scroll " ++ F32.show(dy)
    case Focus{on}: "focus " ++ ud(on)
    case Key{c, d}: "key"
    case Text{t}: "text"
    case Look{dx, dy}: "look"
    case Close{}: "close"

def say(evs: List<Event>) -> IO(Unit):
  match evs:
    case []:
      IO.pure(Unit, Unit{})
    case e <> rest:
      do IO<Unit>:
        IO.print(desc(e))
        say(rest)

def P.view(s: U32) -> U32 & Image:
  (s, Pix{255})

def P.tick(evs: List<Event>, s: U32) -> IO(Maybe<U32>):
  do IO<Maybe<U32>>:
    say(evs)
    IO.pure(Maybe<U32>, Some{s})

def main() -> IO(Unit):
  App.run(~U32, ~App{P.view, P.tick}, "Pointers", 64, 64, 0)
"""
FIRE = """([type, init]) => { const c = document.querySelector('#screen'); const r = c.getBoundingClientRect();
  const ev = type === 'wheel' ? new WheelEvent('wheel', Object.assign({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }, init))
    : new PointerEvent(type, Object.assign({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true, isPrimary: false }, init));
  c.dispatchEvent(ev); }"""
def check(label, ok, *more):
    print(("ok   " if ok else "!! FAIL ") + label, *[str(m)[:300] for m in more])
with sync_playwright() as p:
    b = p.chromium.launch()
    for label, init in [("worker", None), ("page", "delete window.Worker;")]:
        page = b.new_context(viewport={"width": 1280, "height": 800}, locale="en-US").new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        if init: page.add_init_script(init)
        page.goto("http://localhost:8123/index.html"); page.wait_for_selector("#verdict", timeout=30000)
        page.evaluate("""(code) => { const ta = document.querySelector('#ed-ta'); ta.focus(); ta.select(); document.execCommand('insertText', false, code); }""", PROG)
        time.sleep(1.5)
        page.click("#run")
        page.wait_for_selector(".tab[data-tab=screen]:not([hidden])", timeout=60000); time.sleep(1.0)
        def fire(type, **kw): page.evaluate(FIRE, [type, kw]); time.sleep(0.08)
        def log():
            return [l for l in page.locator("#log").inner_text().split("\n") if l.split(" ")[0] in ("press", "move", "leave", "lost", "scroll", "focus")]
        # the mouse: a real click (a move, a press, a release), focusing the canvas
        box = page.locator("#screen").bounding_box()
        page.mouse.move(box["x"] + 10, box["y"] + 10); page.mouse.down(); page.mouse.up(); time.sleep(0.3)
        # a press up of nothing down: dropped
        fire("pointerup", pointerId=1, pointerType="mouse", button=2, buttons=0)
        # two fingers at once, then lifted; a third finger after takes id 1 again
        fire("pointerdown", pointerId=11, pointerType="touch", button=0, buttons=1, pressure=0.5, width=20, height=20)
        fire("pointerdown", pointerId=12, pointerType="touch", button=0, buttons=1, pressure=0.5)
        fire("pointerup", pointerId=11, pointerType="touch", button=0, buttons=0)
        fire("pointerup", pointerId=12, pointerType="touch", button=0, buttons=0)
        fire("pointerdown", pointerId=13, pointerType="touch", button=0, buttons=1)
        fire("pointercancel", pointerId=13, pointerType="touch", button=-1, buttons=0)
        # a pen hovering, then leaving
        fire("pointermove", pointerId=20, pointerType="pen", button=-1, buttons=0, tiltX=30)
        fire("pointerleave", pointerId=20, pointerType="pen", button=-1, buttons=0)
        # the wheel, one notch down: toward the bottom, so a negative dy
        fire("wheel", deltaY=100, deltaMode=0)
        page.evaluate("document.querySelector('#screen').blur()"); time.sleep(0.6)
        got = log()
        print(label, got)
        want_mouse = ["press 0 mouse 0 down", "press 0 mouse 0 up"]
        check(label + ": the mouse is id 0, button 0 down then up", [x for x in got if x.startswith("press 0")] == want_mouse and "move 0 mouse" in got)
        check(label + ": a press up of nothing down is dropped", "press 0 mouse 2 up" not in got)
        fingers = [x for x in got if "finger" in x and x.startswith("press")]
        check(label + ": two fingers 1 and 2, freed, the next one 1 again",
              fingers == ["press 1 finger 0 down", "press 2 finger 0 down", "press 1 finger 0 up", "press 2 finger 0 up", "press 1 finger 0 down"], fingers)
        check(label + ": a finger cancelled is lost", "lost 1" in got)
        check(label + ": a pen hovers and leaves", "move 1 pen" in got and "leave 1" in got)
        check(label + ": the wheel scrolls", any(x.startswith("scroll -1") for x in got), [x for x in got if x.startswith("scroll")])
        check(label + ": the focus comes and goes", got.count("focus down") == 1 and got[-1] == "focus up", [x for x in got if x.startswith("focus")])
        for e in errs: print("!!", e[:200])
        page.close()
    b.close()
