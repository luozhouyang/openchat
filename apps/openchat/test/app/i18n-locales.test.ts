// @vitest-environment jsdom
import { describe, expect, it } from "vite-plus/test";
import en from "@/i18n/locales/en.json";
import zh from "@/i18n/locales/zh.json";

function collectKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null
      ? collectKeys(v as Record<string, unknown>, prefix ? `${prefix}.${k}` : k)
      : [prefix ? `${prefix}.${k}` : k],
  );
}

describe("i18n locales", () => {
  it("en and zh have identical key sets", () => {
    const enKeys = collectKeys(en).sort();
    const zhKeys = collectKeys(zh).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it("exposes workspace, teams and admin namespaces", () => {
    expect(en.workspace.channels).toBeTruthy();
    expect(en.teams.createTab).toBeTruthy();
    expect(en.admin.roles).toBeTruthy();
  });
});
