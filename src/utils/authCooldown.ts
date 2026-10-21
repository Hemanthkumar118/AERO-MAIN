/**
 * AERO Emergency Platform — Authentication Cooldown & Anti-Abuse Utility
 *
 * Persists action cooldown timers in sessionStorage so client-side state is preserved
 * across mobile page reloads, tab switches, and network reconnects.
 */

const STORAGE_PREFIX = 'aero_auth_cooldown_';
const DEFAULT_COOLDOWN_SECONDS = 60;

export function getRemainingCooldown(action: string): number {
  try {
    const rawExpiry = sessionStorage.getItem(`${STORAGE_PREFIX}${action}`);
    if (!rawExpiry) return 0;
    const expiryMs = parseInt(rawExpiry, 10);
    const nowMs = Date.now();
    if (isNaN(expiryMs) || nowMs >= expiryMs) {
      sessionStorage.removeItem(`${STORAGE_PREFIX}${action}`);
      return 0;
    }
    return Math.ceil((expiryMs - nowMs) / 1000);
  } catch {
    return 0;
  }
}

export function setCooldown(action: string, seconds: number = DEFAULT_COOLDOWN_SECONDS): void {
  try {
    const expiryMs = Date.now() + seconds * 1000;
    sessionStorage.setItem(`${STORAGE_PREFIX}${action}`, expiryMs.toString());
  } catch {
    // Ignore storage quota or disabled storage in incognito
  }
}

export function clearCooldown(action: string): void {
  try {
    sessionStorage.removeItem(`${STORAGE_PREFIX}${action}`);
  } catch {
    // Ignore
  }
}
