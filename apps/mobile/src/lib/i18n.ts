import { create } from "zustand";
import * as SecureStore from "expo-secure-store";

export type Language = "zh" | "en";

const STORAGE_KEY = "openchat.lang";

const DICTS = {
  zh: {
    loginTitle: "登录 openchat",
    loginHint: "使用邮箱和密码进入工作区",
    email: "邮箱",
    password: "密码",
    login: "登录",
    loginFailed: "登录失败",
    channels: "频道",
    notifications: "通知",
    settings: "设置",
    search: "搜索",
    close: "关闭",
    send: "发送",
    sending: "发送中…",
    composer: "输入消息…",
    loadOlder: "加载更早的消息",
    loading: "加载中…",
    noMessages: "暂无消息",
    noChannels: "尚未加入任何频道",
    searchHint: "输入关键词搜索",
    searching: "搜索中…",
    noResults: "无结果",
    noNotifications: "暂无通知",
    reply: "回复",
    thread: "线程",
    noReplies: "暂无回复",
    threadPlaceholder: "回复线程…",
    pushNotifications: "推送通知",
    language: "语言",
    theme: "主题",
    themeLight: "浅色",
    themeDark: "深色",
    themeSystem: "跟随系统",
    searchPlaceholder: "搜索本频道…",
    loadFailed: "加载失败",
    kindMention: "提及",
    kindReply: "回复",
    kindDm: "私信",
  },
  en: {
    loginTitle: "Sign in to openchat",
    loginHint: "Enter your email and password to access your workspace",
    email: "Email",
    password: "Password",
    login: "Sign in",
    loginFailed: "Sign-in failed",
    channels: "Channels",
    notifications: "Notifications",
    settings: "Settings",
    search: "Search",
    close: "Close",
    send: "Send",
    sending: "Sending…",
    composer: "Message…",
    loadOlder: "Load older messages",
    loading: "Loading…",
    noMessages: "No messages yet",
    noChannels: "You have not joined any channels yet",
    searchHint: "Type a keyword",
    searching: "Searching…",
    noResults: "No results",
    noNotifications: "No notifications",
    reply: "Reply",
    thread: "Thread",
    noReplies: "No replies yet",
    threadPlaceholder: "Reply to thread…",
    pushNotifications: "Push notifications",
    language: "Language",
    theme: "Theme",
    themeLight: "Light",
    themeDark: "Dark",
    themeSystem: "System",
    searchPlaceholder: "Search this channel…",
    loadFailed: "Failed to load",
    kindMention: "Mention",
    kindReply: "Reply",
    kindDm: "Direct message",
  },
} as const;

export type TranslationKey = keyof (typeof DICTS)["zh"];

export const translationKeys = Object.keys(DICTS.zh) as TranslationKey[];

/** Pure lookup used by the store hook and by tests. */
export function translate(lang: Language, key: TranslationKey): string {
  return DICTS[lang][key] ?? DICTS.zh[key] ?? key;
}

export const useLanguageStore = create<{
  lang: Language;
  setLang: (lang: Language) => void;
}>((set) => ({
  lang: "zh",
  setLang(lang) {
    set({ lang });
    void SecureStore.setItemAsync(STORAGE_KEY, lang).catch(() => {});
  },
}));

/** Restores the persisted language on app start. */
export async function loadLanguage(): Promise<void> {
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEY);
    if (stored === "zh" || stored === "en") {
      useLanguageStore.setState({ lang: stored });
    }
  } catch {
    // storage unavailable: keep the default
  }
}

/** Re-renders the caller when the language changes. */
export function useT(): (key: TranslationKey) => string {
  const lang = useLanguageStore((state) => state.lang);
  return (key) => translate(lang, key);
}
