"""Runs the end-to-end scripts that matter, each in its own process with a
deadline, from the repository root after `npm run build`, with ../bend
cloned. A script passes when it neither raises nor reports a page error
(lines starting with "!! " other than console noise). Usage:

    python3 tests/e2e/run_all.py            # all but the slow ones
    python3 tests/e2e/run_all.py --slow     # all of them
    python3 tests/e2e/run_all.py hub lemma  # some, by name
"""
import os, re, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
TESTS = [
    "errors_goals_persist", "themes_csp", "iframe_sandbox", "settings_files_base", "typing_guide_effect_hub",
    "goals_signatures", "kept_goals_tooltip", "heavy_demos", ("window_demos", "app_triangle_2d"), "window_mobile",
    "window_iframe_csp", "window_no_worker", "window_page_mode_mobile", "projects_zip", "export_viewer", "no_storage",
    "languages", "sigs_marks_lawdef_ai", "split", "constructors", "solve_lazy", "verdict_bendtt", "split_narrow",
    "split_disabled", "long_goals", "lemma", "lemma_mobile", "lemma_pong", "lawdef_pong", "network_audit", "fonts_off",
    "hub", "operators", "ai_profiles", "agent_claude", "agent_apis", "agent_no_worker", "agent_holes_export",
    "agent_tools", "agent_trace", "agent_resume", "about_versions", "portuguese", "opcalls", "timers_busy", "compiler_outputs",
]


SLOW = {"heavy_demos"}   # minutes: the ray tracer and the parallel sort, frame by frame


def main():
    slow = "--slow" in sys.argv
    pick = [a for a in sys.argv[1:] if a != "--slow"]
    todo = [t if isinstance(t, tuple) else (t,) for t in TESTS]
    todo = [t for t in todo if (t[0] in pick) if pick] or [t for t in todo if not pick and (slow or t[0] not in SLOW)]
    subprocess.run([sys.executable, os.path.join(HERE, "fixtures", "make_fakehub.py")], check=True,
                   stdout=subprocess.DEVNULL)
    bad = []
    for t in todo:
        path = os.path.join(HERE, t[0] + ".py")
        if not os.path.exists(path):
            continue
        t0 = time.time()
        try:
            got = subprocess.run([sys.executable, path, *t[1:]], capture_output=True, timeout=240)
            out = (got.stdout + got.stderr).decode("utf-8", "replace")
            fail = "Traceback" in out or re.search(r"^!! (?!console)", out, re.M) is not None
        except subprocess.TimeoutExpired:
            out, fail = "timed out", True
        print(("FAIL " if fail else "ok   ") + t[0].ljust(26) + " %5.1f s" % (time.time() - t0), flush=True)
        if fail:
            bad.append((t[0], out))
    for name, out in bad:
        print("\n== " + name + "\n" + out[-1500:])
    print("\n%d/%d passed" % (len(todo) - len(bad), len(todo)))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
