import { h } from '../../vendor/preact.module.js';
import htm from '../../vendor/htm.module.js';
import { decodeJwt, getJwtExpiry, formatExpiry } from '../../lib/jwt-decode.js';

const html = htm.bind(h);

export function Header({ credentials }) {
  const connected = !!credentials?.projectUrl;
  const decoded = credentials?.jwt ? decodeJwt(credentials.jwt) : null;
  const expiry = credentials?.jwt ? getJwtExpiry(credentials.jwt) : null;

  const email = decoded?.payload?.email || null;
  const role = decoded?.payload?.role || null;

  return html`
    <header class="header">
      <div class="header-top">
        <span class="header-title">Supabase Inspector</span>
      </div>
      <div class="header-status">
        <span class="status-dot ${connected ? 'connected' : 'disconnected'}"></span>
        <span class="status-text">
          ${connected
            ? credentials.projectUrl.replace('https://', '')
            : 'Not connected'}
        </span>
        ${expiry && !expiry.expired && html`
          <span class="expiry-badge">
            exp: ${formatExpiry(expiry.expiresIn)}
          </span>
        `}
        ${expiry?.expired && html`
          <span class="expiry-badge expired">expired</span>
        `}
      </div>
      ${email && html`
        <div class="header-user">
          User: ${email}${role ? ` | ${role}` : ''}
        </div>
      `}
    </header>
  `;
}
