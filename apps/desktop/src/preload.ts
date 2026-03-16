import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "@t3tools/contracts";

const PICK_FOLDER_CHANNEL = "desktop:pick-folder";
const CONFIRM_CHANNEL = "desktop:confirm";
const SET_THEME_CHANNEL = "desktop:set-theme";
const SET_DISPLAY_SLEEP_BLOCKED_CHANNEL = "desktop:set-display-sleep-blocked";
const CONTEXT_MENU_CHANNEL = "desktop:context-menu";
const OPEN_EXTERNAL_CHANNEL = "desktop:open-external";
const MENU_ACTION_CHANNEL = "desktop:menu-action";
const GET_WS_URL_CHANNEL = "desktop:get-ws-url";
const GET_SERVER_CONNECTION_DETAILS_CHANNEL = "desktop:get-server-connection-details";
const SET_SERVER_AUTH_TOKEN_CHANNEL = "desktop:set-server-auth-token";
const REGENERATE_SERVER_AUTH_TOKEN_CHANNEL = "desktop:regenerate-server-auth-token";
const SET_REMOTE_ACCESS_ENABLED_CHANNEL = "desktop:set-remote-access-enabled";
const RETRY_REMOTE_ACCESS_PROBE_CHANNEL = "desktop:retry-remote-access-probe";
const UPDATE_STATE_CHANNEL = "desktop:update-state";
const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
const UPDATE_INSTALL_CHANNEL = "desktop:update-install";

contextBridge.exposeInMainWorld("desktopBridge", {
  getWsUrl: () => ipcRenderer.sendSync(GET_WS_URL_CHANNEL),
  getServerConnectionDetails: () => ipcRenderer.invoke(GET_SERVER_CONNECTION_DETAILS_CHANNEL),
  setServerAuthToken: (token: string) => ipcRenderer.invoke(SET_SERVER_AUTH_TOKEN_CHANNEL, token),
  regenerateServerAuthToken: () => ipcRenderer.invoke(REGENERATE_SERVER_AUTH_TOKEN_CHANNEL),
  setRemoteAccessEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(SET_REMOTE_ACCESS_ENABLED_CHANNEL, enabled),
  retryRemoteAccessProbe: () => ipcRenderer.invoke(RETRY_REMOTE_ACCESS_PROBE_CHANNEL),
  pickFolder: () => ipcRenderer.invoke(PICK_FOLDER_CHANNEL),
  confirm: (message) => ipcRenderer.invoke(CONFIRM_CHANNEL, message),
  setTheme: (theme) => ipcRenderer.invoke(SET_THEME_CHANNEL, theme),
  setDisplaySleepBlocked: (blocked) =>
    ipcRenderer.invoke(SET_DISPLAY_SLEEP_BLOCKED_CHANNEL, blocked),
  showContextMenu: (items, position) => ipcRenderer.invoke(CONTEXT_MENU_CHANNEL, items, position),
  openExternal: (url: string) => ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url),
  onMenuAction: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action !== "string") return;
      listener(action);
    };

    ipcRenderer.on(MENU_ACTION_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(MENU_ACTION_CHANNEL, wrappedListener);
    };
  },
  getUpdateState: () => ipcRenderer.invoke(UPDATE_GET_STATE_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL),
  onUpdateState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(UPDATE_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, wrappedListener);
    };
  },
} satisfies DesktopBridge);
