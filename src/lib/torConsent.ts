/**
 * Session-scoped clearnet consent: granted by the onboarding wizard's
 * "continue without tor" and honored by every TorGate afterwards, so the
 * user consents once per tab-session instead of once per surface. Never
 * persisted — a fresh tab re-asks.
 */
const CONSENT_KEY = 'nostr:clearnet-consent';

export const grantClearnetConsent = (): void => {
  try {
    sessionStorage.setItem(CONSENT_KEY, '1');
  } catch {
    // storage unavailable — consent simply won't carry
  }
};

export const hasClearnetConsent = (): boolean => {
  try {
    return sessionStorage.getItem(CONSENT_KEY) === '1';
  } catch {
    return false;
  }
};
