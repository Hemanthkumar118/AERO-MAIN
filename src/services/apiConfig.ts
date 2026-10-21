/**
 * Resolves the base URL for backend API calls.
 * 
 * In production or custom setups, VITE_BACKEND_URL takes precedence.
 * In a browser on desktop or mobile over LAN (e.g. http://192.168.1.39:5173),
 * returning an empty string ('') routes all /api requests through the Vite development
 * proxy (configured in vite.config.ts), avoiding hardcoded localhost failures on mobile devices.
 * If running in a Node.js SSR/testing environment where window is undefined, it defaults to http://localhost:3001.
 */
export function getBackendUrl(): string {
  if (typeof import.meta !== 'undefined') {
    const custom = import.meta.env?.VITE_BACKEND_URL || import.meta.env?.VITE_API_BASE_URL;
    if (custom) return custom.trim().replace(/\/$/, '');
  }
  if (typeof window === 'undefined') {
    const proc = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process;
    return proc?.env?.API_BASE_URL || 'http://localhost:3001';
  }
  // In the browser, relative path '' routes to the current origin
  return '';
}
