// The node globals bend.ts touches at load time, or on the hub path.
export const process = {
  env: {} as Record<string, string | undefined>,
  execPath: "/bend/bin/bend",
  platform: "browser",
  arch: "js",
  argv: ["bend", "main.bend"],
};

export const Buffer = {
  from(x: ArrayBuffer | Uint8Array | string) {
    const b = typeof x === "string" ? new TextEncoder().encode(x)
      : x instanceof Uint8Array ? x : new Uint8Array(x);
    return {
      toString(enc?: string): string {
        return enc === "hex"
          ? [...b].map((v) => v.toString(16).padStart(2, "0")).join("")
          : new TextDecoder().decode(b);
      },
    };
  },
  byteLength(s: string): number { return new TextEncoder().encode(s).length; },
};
