/**
 * Decode a JWT token string into { header, payload }.
 * Returns null if the token is malformed.
 */
export function decodeJwt(token) {
  if (!token) return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    return {
      header: JSON.parse(base64UrlDecode(parts[0])),
      payload: JSON.parse(base64UrlDecode(parts[1]))
    };
  } catch {
    return null;
  }
}

/**
 * Check if a JWT is expired.
 * Returns { expired: boolean, expiresIn: number (ms), expiresAt: Date }
 */
export function getJwtExpiry(token) {
  const decoded = typeof token === 'string' ? decodeJwt(token) : token;
  if (!decoded?.payload?.exp) return null;

  const expiresAt = new Date(decoded.payload.exp * 1000);
  const now = Date.now();
  const expiresIn = expiresAt.getTime() - now;

  return {
    expired: expiresIn <= 0,
    expiresIn,
    expiresAt
  };
}

/**
 * Format milliseconds remaining as a human-readable string.
 * e.g., 7380000 -> "2h 3m"
 */
export function formatExpiry(ms) {
  if (ms <= 0) return 'expired';

  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return '< 1m';
}

// --- internal ---

function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return atob(base64);
}
