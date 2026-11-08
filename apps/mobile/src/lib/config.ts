// API base URL for REST + WS. Override per environment with EXPO_PUBLIC_API_URL
// (Expo loads EXPO_PUBLIC_* from the shell/.env at bundle time).
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787";
