import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

const STORAGE_KEY = "openchat.lang";

function initialLanguage(): "en" | "zh" {
  if (typeof localStorage === "undefined") return "en";
  return localStorage.getItem(STORAGE_KEY) === "zh" ? "zh" : "en";
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: initialLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  initImmediate: false,
});

export function setLanguage(lang: "en" | "zh"): void {
  void i18n.changeLanguage(lang);
  if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, lang);
}

export default i18n;
