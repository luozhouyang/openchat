import { createApi } from "protocol";
import { desktopFileMode, desktopServerUrl, getDesktopToken } from "./desktop-mode";

// One REST surface for both web modes: cookies + relative paths in the
// browser, bearer + injected origin in the Electron file:// shell (cookie
// credentials are omitted there so anonymous CORS responses are accepted).
export const api = desktopFileMode
  ? createApi({
      baseUrl: desktopServerUrl,
      getToken: getDesktopToken,
      credentials: "omit",
    })
  : createApi();
export { apiFetch, ApiError } from "protocol";
export type { WorkspaceResponse } from "protocol";
