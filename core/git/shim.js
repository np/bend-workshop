// isomorphic-git reads a global Buffer, as in Node: the browser has none.
import { Buffer } from "buffer";

if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = Buffer;
}
