// The root aggregate runner loads this file for every suite it runs, including
// plain-node ones (packages/*) where there is no DOM — keep the DOM-only
// imports behind the guard so they stay out of those environments.
if (typeof window !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  await import("@/i18n");
}

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
