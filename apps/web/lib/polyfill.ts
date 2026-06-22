/** @solana/web3.js expects a Buffer global in the browser. Import this BEFORE web3. */
import { Buffer } from "buffer";

if (typeof globalThis.Buffer === "undefined") {
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}
