// Assembles the single-file page: styles, the guide (rendered from GUIDE.md),
// the examples, the runner prelude, the compiler bundle and the app script.
import fs from "node:fs";
import zlib from "node:zlib";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const REPO = "https://github.com/bendlang/bend/blob/main/";

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000"; });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => {
    const href = /^https?:/.test(u) ? u : REPO + u.replace(/^\.\.\//, "");
    return `<a href="${href}" target="_blank" rel="noopener">${t}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => "<code>" + esc(codes[+i]) + "</code>");
}

function markdown(md) {
  const lines = md.split("\n");
  let out = "";
  let i = 0;
  const para = [];
  const flush = () => { if (para.length) { out += "<p>" + inline(para.join(" ")) + "</p>\n"; para.length = 0; } };
  while (i < lines.length) {
    const l = lines[i];
    const fence = /^```(\w*)\s*$/.exec(l);
    if (fence) {
      flush();
      const body = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) body.push(lines[i]);
      i++;
      const text = body.join("\n");
      const bend = fence[1] === "python";
      const runs = bend && /^def main\(/m.test(text) && !/^import \.\//m.test(text);
      out += `<div class="snip"><pre><code${bend ? ' class="bend"' : ""}>${esc(text)}</code></pre>`
        + (runs ? `<button class="try" type="button" data-i18n="try"></button>` : "") + "</div>\n";
      continue;
    }
    const h = /^(#{1,3}) (.*)$/.exec(l);
    if (h) { flush(); out += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>\n`; i++; continue; }
    if (/^> ?/.test(l)) {
      flush();
      const q = [];
      for (; i < lines.length && /^> ?/.test(lines[i]); i++) q.push(lines[i].replace(/^> ?/, ""));
      out += "<blockquote><p>" + inline(q.join(" ")) + "</p></blockquote>\n";
      continue;
    }
    const li = /^(\s*)([-*]|\d+\.) (.*)$/.exec(l);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]);
      const items = [];
      for (; i < lines.length; i++) {
        const m = /^\s*([-*]|\d+\.) (.*)$/.exec(lines[i]);
        if (m) items.push(m[2]);
        else if (lines[i].trim() === "" && /^\s*([-*]|\d+\.) /.test(lines[i + 1] ?? "")) continue;
        else if (/^\s+\S/.test(lines[i]) && items.length) items[items.length - 1] += " " + lines[i].trim();
        else break;
      }
      out += (ordered ? "<ol>" : "<ul>") + items.map((t) => "<li>" + inline(t) + "</li>").join("") + (ordered ? "</ol>\n" : "</ul>\n");
      continue;
    }
    if (l.trim() === "") { flush(); i++; continue; }
    para.push(l.trim());
    i++;
  }
  flush();
  return out;
}

const read = (p) => fs.readFileSync(p, "utf8");
const assets = read("gen/assets.ts");
const version = /VERSION = "([^"]+)"/.exec(assets)[1];
const commit = /COMMIT = "([^"]*)"/.exec(assets)[1];
const core = read("dist/bend-core.js");
if (/<\/script/i.test(core)) throw new Error("the bundle holds a closing script tag");
const prelude = read("src/runner-prelude.js");
if (/<\/script/i.test(prelude)) throw new Error("prelude holds a closing script tag");
const examples = read("gen/examples.json").replace(/</g, "\\u003c");
const guide = markdown(read("../bend/guide/GUIDE.md"));

const cfx = zlib.deflateRawSync(Buffer.from(read("gen/c_effects.json")), { level: 9 }).toString("base64");
const fill = { STYLE: read("src/style.css"), GUIDE: guide, EXAMPLES: examples, PRELUDE: prelude, CEFFS: cfx,
  I18N: read("src/i18n.js"), GUIDEMD: read("../bend/guide/GUIDE.md").replace(/<\/script/gi, "<\\/script"),
  RUNTAIL: read("src/runner-tail.js"),
  CORE: core, APP: read("src/app.js").replace("/*__OPCALL__*/", () => read("src/opcall.js"))
    .replace("/*__AGENT__*/", () => read("src/agent.js")) };
let html = read("src/index.template.html");
for (const [k, v] of Object.entries(fill)) {
  html = html.replace("/*__" + k + "__*/", () => v);
}
html = html.replace(/__VERSION__/g, version).replace(/__COMMIT__/g, commit);
const out = process.argv[2] ?? "dist/index.html";
fs.writeFileSync(out, html);
console.log(out, (html.length / 1024).toFixed(0) + " KB");
