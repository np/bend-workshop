// Every language has every key English has, of the same kind (text or
// function), and every function answers a non-empty text for sample
// arguments. A text left the same as English is listed, for a look.
import fs from "node:fs";
import vm from "node:vm";

const ctx = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync("src/i18n.js", "utf8"), ctx);
const L = ctx.window.BEND_LANGS;
const en = L.en;
const SAME_OK = new Set(["guide", "editor", "tab_base", "tab_guide", "base_ph", "todos", "copy_suffix", "match", "kb",
  "conv_prompt", "pad_enter", "agent_files", "prov_claude", "ses_mode_conversation", "ses_mode_journal", "tab_agent",
  "snap_manual", "ai_title", "decimal", "locale", "ai_profile_name", "import_name"]);
let bad = 0;
const args = [2, "x", 3, 4];
for (const code of Object.keys(L).filter((k) => k !== "en")) {
  const lg = L[code];
  const same = [];
  for (const k of Object.keys(en)) {
    if (!(k in lg)) {
      console.log(code, "missing", k);
      bad += 1;
      continue;
    }
    if (typeof en[k] !== typeof lg[k]) {
      console.log(code, k, "is a", typeof lg[k], "where English has a", typeof en[k]);
      bad += 1;
      continue;
    }
    if (typeof lg[k] === "function") {
      try {
        const got = lg[k](...args.slice(0, Math.max(lg[k].length, 1)));
        if (typeof got !== "string" || got === "" || /undefined|NaN/.test(got)) {
          console.log(code, k, "answers", JSON.stringify(got));
          bad += 1;
        }
      } catch (e) {
        console.log(code, k, "throws", e.message);
        bad += 1;
      }
    } else if (lg[k] === en[k] && !SAME_OK.has(k)) {
      same.push(k);
    }
  }
  for (const k of Object.keys(lg)) {
    if (!(k in en)) {
      console.log(code, "has", k, "which English lacks");
      bad += 1;
    }
  }
  console.log(code + ": " + Object.keys(lg).length + " keys" + (same.length ? "; same as English: " + same.join(", ") : ""));
}
console.log(bad === 0 ? "languages ok" : bad + " problems");
process.exit(bad === 0 ? 0 : 1);
