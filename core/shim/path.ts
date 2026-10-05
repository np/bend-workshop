// POSIX path, the subset bend uses.
export const delimiter = ":";
export const sep = "/";

export function normalize(p: string): string {
  const abs = p.startsWith("/");
  const trail = p.endsWith("/") && p.length > 1;
  const out: string[] = [];
  for (const s of p.split("/")) {
    if (s === "" || s === ".") {
      continue;
    }
    if (s === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") {
        out.pop();
      } else if (!abs) {
        out.push("..");
      }
    } else {
      out.push(s);
    }
  }
  let r = (abs ? "/" : "") + out.join("/");
  if (r === "") {
    r = abs ? "/" : ".";
  }
  return trail && r !== "/" ? r + "/" : r;
}

export function join(...ps: string[]): string {
  const xs = ps.filter((p) => p !== "");
  return xs.length === 0 ? "." : normalize(xs.join("/"));
}

export function resolve(...ps: string[]): string {
  let r = "";
  for (let i = ps.length - 1; i >= 0 && !r.startsWith("/"); i--) {
    if (ps[i] !== "") {
      r = ps[i] + (r === "" ? "" : "/" + r);
    }
  }
  if (!r.startsWith("/")) {
    r = "/work/" + r;
  }
  const n = normalize(r);
  return n.length > 1 && n.endsWith("/") ? n.slice(0, -1) : n;
}

export function dirname(p: string): string {
  const s = p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
  const i = s.lastIndexOf("/");
  return i < 0 ? "." : i === 0 ? "/" : s.slice(0, i);
}

export function basename(p: string, ext?: string): string {
  const s = p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
  const b = s.slice(s.lastIndexOf("/") + 1);
  return ext !== undefined && b.endsWith(ext) && b !== ext ? b.slice(0, -ext.length) : b;
}

export function isAbsolute(p: string): boolean {
  return p.startsWith("/");
}

export function relative(from: string, to: string): string {
  const a = resolve(from).split("/").filter((x) => x !== "");
  const b = resolve(to).split("/").filter((x) => x !== "");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) {
    i++;
  }
  return a.slice(i).map(() => "..").concat(b.slice(i)).join("/");
}

export const posix = { normalize, join, resolve, dirname, basename, relative, isAbsolute, delimiter, sep };
export default posix;
