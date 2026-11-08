// Applies the persisted theme before first paint; kept as an external file so
// the CSP can stay `script-src 'self'` (no inline scripts).
(() => {
  const KEY = "openchat.theme";
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const read = () => localStorage.getItem(KEY) || "system";
  const apply = () => {
    const theme = read();
    document.documentElement.classList.toggle(
      "dark",
      theme === "dark" || (theme === "system" && mq.matches),
    );
  };
  apply();
  mq.addEventListener("change", () => {
    if (read() === "system") {
      apply();
    }
  });
})();
