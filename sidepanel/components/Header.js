import { h } from '../../vendor/preact.module.js';
import htm from '../../vendor/htm.module.js';
import { decodeJwt, getJwtExpiry, formatExpiry } from '../../lib/jwt-decode.js';

const html = htm.bind(h);

export function Header({ credentials, schemaStatus, onClearCache }) {
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
      ${connected && html`
        <div class="header-debug">
          <span class="debug-pill ${credentials.apikey ? 'ok' : 'missing'}">
            apikey: ${credentials.apikey ? 'captured' : 'missing'}
          </span>
          <span class="debug-pill ${credentials.jwt ? 'ok' : 'missing'}">
            jwt: ${credentials.jwt ? 'captured' : 'missing'}
          </span>
          <span class="debug-pill ${
            schemaStatus === 'loaded' ? 'ok' :
            schemaStatus === 'loading' || schemaStatus === 'probing' ? 'loading' :
            schemaStatus === 'error' ? 'error' : 'missing'
          }">
            schema: ${schemaStatus || 'pending'}
          </span>
          ${schemaStatus === 'loaded' && onClearCache && html`
            <button class="debug-pill-btn" onClick=${onClearCache} title="Clear cached schema and reload">
              \u21BB
            </button>
          `}
        </div>
      `}
      ${schemaStatus === 'error' && html`
        <div class="header-error">
          Schema endpoint blocked (401). Navigate the site to trigger Supabase requests \u2014 tables will be discovered from intercepted traffic.
        </div>
      `}
      ${schemaStatus === 'probing' && html`
        <div class="header-info">
          OpenAPI spec unavailable. Discovering tables from intercepted requests...
        </div>
      `}
    </header>
  `;
}
