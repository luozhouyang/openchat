// The root aggregate runner loads this file for every suite it runs, including
// plain-node ones (packages/*) where there is no DOM — keep the DOM-only
// imports behind the guard so they stay out of those environments.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// jsdom 30 throws "localStorage is not available for opaque origins" — the
// shared vitest jsdom environment evaluates origin availability before tests
// replace `window.location`, so suite-local Storage mocks alone are not enough.
// Provide a spec-shaped in-memory fallback identical to the old jsdom behavior
// (per-instance Map, cleared per test file/environment).
//
// Order matters: this MUST run before `await import("@/i18n")` — the i18n
// bootstrap reads localStorage to restore the persisted language.
if (typeof window !== "undefined" && typeof window.localStorage === "undefined") {
  const entries = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: (key: string) => (entries.has(key) ? (entries.get(key) as string) : null),
      setItem: (key: string, value: string) => void entries.set(key, String(value)),
      removeItem: (key: string) => void entries.delete(key),
      clear: () => entries.clear(),
      key: (index: number) => [...entries.keys()][index] ?? null,
      get length() {
        return entries.size;
      },
    },
    configurable: true,
  });
}

if (typeof window !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  await import("@/i18n");
}
