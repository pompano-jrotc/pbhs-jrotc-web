// src/hooks/useIdleLogout.js
//
// Soft-locks the session after inactivity instead of fully signing out.
// Calling signOut() on every idle forces users through the full email+password
// + SMS 2FA flow each time — expensive (hits Firebase SMS quota) and annoying.
//
// Instead we:
//   1. Set sessionStorage.sessionLocked = '1'
//   2. Dispatch a 'idle-session-lock' event that AdminLayout listens to
//   3. AdminLayout renders SessionLockScreen on top of the current page
//   4. The lock screen re-authenticates with password only (reauthenticateWithCredential
//      does NOT trigger MFA), then clears the lock.
//
// Trusted devices: after completing MFA the user can check "Remember this device
// for 30 days". If the localStorage trust token is valid for the current user,
// the idle window is extended to 30 days so the soft-lock essentially never
// fires during normal daily use — further reducing SMS consumption.

import { useEffect, useRef } from 'react';

// Default idle period for non-trusted devices.
const IDLE_LIMIT_MS = 30 * 60 * 1000;             // 30 minutes

// Idle period for explicitly trusted devices.
// NOTE: browsers store the setTimeout delay as a 32-bit signed integer
// (max = 2,147,483,647 ms ≈ 24.8 days). Values larger than that overflow
// to a *negative* number and fire the callback *immediately* — which is why
// 30 days (2,592,000,000 ms) caused the lock screen to flash right after
// sign-in. 7 days is safely inside the limit and still long enough that a
// trusted device will never be auto-locked during any real-world session.
const TRUSTED_IDLE_LIMIT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (604,800,000 ms)

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];

export const TRUST_KEY = 'jrotc_trusted_device';

/** Returns true if the device has a valid trust token for this uid. */
export function isDeviceTrusted(uid) {
  if (!uid) return false;
  try {
    const raw = localStorage.getItem(TRUST_KEY);
    if (!raw) return false;
    const { uid: storedUid, trustedUntil } = JSON.parse(raw);
    return storedUid === uid && new Date(trustedUntil) > new Date();
  } catch {
    return false;
  }
}

/** Store a 30-day trust token for this uid on this device. */
export function trustDevice(uid) {
  const trustedUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  localStorage.setItem(TRUST_KEY, JSON.stringify({ uid, trustedUntil }));
}

/** Clear the trust token (called on manual sign-out). */
export function clearDeviceTrust() {
  localStorage.removeItem(TRUST_KEY);
}

/**
 * @param {boolean} isLoggedIn
 * @param {string|null} uid  — current user's Firebase UID
 */
export const useIdleLogout = (isLoggedIn, uid) => {
  const timerRef = useRef(null);

  useEffect(() => {
    if (!isLoggedIn) return;

    const trusted = isDeviceTrusted(uid);
    const limit   = trusted ? TRUSTED_IDLE_LIMIT_MS : IDLE_LIMIT_MS;

    const lockSession = () => {
      sessionStorage.setItem('sessionLocked', '1');
      window.dispatchEvent(new CustomEvent('idle-session-lock'));
      // Broadcast to all other tabs at the same origin so they lock too (S-03).
      try {
        const bc = new BroadcastChannel('jrotc-session-lock');
        bc.postMessage({ type: 'idle-session-lock' });
        bc.close();
      } catch {}
    };

    const resetTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(lockSession, limit);
    };

    resetTimer();
    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, resetTimer));

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, resetTimer));
    };
  }, [isLoggedIn, uid]);
};
