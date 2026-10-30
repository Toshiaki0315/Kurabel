import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Node 25 の組み込み localStorage (--localstorage-file 未指定) が jsdom のものを隠すため、メモリ実装に置き換える
if (typeof localStorage === "undefined" || typeof localStorage.clear !== "function") {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
    },
  });
}

afterEach(cleanup);
