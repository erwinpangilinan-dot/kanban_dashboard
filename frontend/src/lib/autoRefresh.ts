const STORAGE_KEY = 'mc_auto_refresh';
export const AUTO_REFRESH_MS = 30_000;

export function getAutoRefreshEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) === '1';
}

export function setAutoRefreshEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
}
