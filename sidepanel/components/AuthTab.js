import { h } from '../../vendor/preact.module.js';
import { useState, useEffect } from '../../vendor/preact-hooks.module.js';
import htm from '../../vendor/htm.module.js';
import { decodeJwt, getJwtExpiry, formatExpiry } from '../../lib/jwt-decode.js';

const html = htm.bind(h);

function formatClaimValue(key, value) {
  if ((key === 'iat' || key === 'exp' || key === 'auth_time') && typeof value === 'number') {
    return new Date(value * 1000).toLocaleString();
  }
  if (typeof value === 'object' && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

export function AuthTab({ credentials }) {
  const [decoded, setDecoded] = useState(null);
  const [expiry, setExpiry] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState(null);
  const [expandedSection, setExpandedSection] = useState(null);

  useEffect(() => {
    if (credentials.jwt) {
      const d = decodeJwt(credentials.jwt);
      setDecoded(d);
      setExpiry(getJwtExpiry(credentials.jwt));
    }
  }, [credentials.jwt]);

  useEffect(() => {
    if (!credentials.jwt) return;
    const interval = setInterval(() => {
      setExpiry(getJwtExpiry(credentials.jwt));
    }, 30000);
    return () => clearInterval(interval);
  }, [credentials.jwt]);

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshResult(null);

    try {
      const res = await fetch(`${credentials.projectUrl}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
          'apikey': credentials.apikey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          refresh_token: credentials.refreshToken || ''
        })
      });

      const data = await res.json();

      if (res.ok) {
        setRefreshResult({ success: true, message: 'Token refreshed successfully', data });
        if (data.access_token) {
          const newDecoded = decodeJwt(data.access_token);
          setDecoded(newDecoded);
          setExpiry(getJwtExpiry(data.access_token));
        }
      } else {
        setRefreshResult({
          success: false,
          message: data.error_description || data.msg || `HTTP ${res.status}`
        });
      }
    } catch (err) {
      setRefreshResult({ success: false, message: err.message });
    }

    setRefreshing(false);
  }

  if (!decoded) {
    return html`<div class="empty-hint">No JWT token detected</div>`;
  }

  const { payload, header } = decoded;

  const userInfo = {
    id: payload.sub,
    email: payload.email,
    phone: payload.phone,
    role: payload.role,
    provider: payload.app_metadata?.provider,
    providers: payload.app_metadata?.providers
  };

  const userMetadata = payload.user_metadata || {};
  const appMetadata = payload.app_metadata || {};

  const mfaFactors = payload.amr?.filter(f => f.method !== 'password') || [];
  const aal = payload.aal;

  return html`
    <div class="auth-tab">
      <div class="section auth-overview">
        <div class="auth-identity">
          <span class="auth-email">${userInfo.email || userInfo.phone || userInfo.id}</span>
          ${userInfo.provider && html`
            <span class="auth-provider">via ${userInfo.provider}</span>
          `}
        </div>
        <div class="auth-role">${userInfo.role || 'unknown role'}</div>

        <${ExpiryBar} expiry=${expiry} payload=${payload} />

        <div class="auth-actions">
          <button class="btn btn-sm" onClick=${handleRefresh} disabled=${refreshing}>
            ${refreshing ? 'Refreshing...' : '\u21BB Refresh Token'}
          </button>
        </div>
        ${refreshResult && html`
          <div class="refresh-result ${refreshResult.success ? 'success' : 'error'}">
            ${refreshResult.message}
          </div>
        `}
      </div>

      ${(mfaFactors.length > 0 || aal) && html`
        <div class="section">
          <h3>MFA Status</h3>
          <div class="auth-mfa">
            ${aal && html`<div class="jwt-field">
              <span class="jwt-key">Assurance Level</span>
              <span class="jwt-value">${aal}</span>
            </div>`}
            ${mfaFactors.map(f => html`
              <div class="jwt-field">
                <span class="jwt-key">${f.method}</span>
                <span class="jwt-value">${new Date(f.timestamp * 1000).toLocaleString()}</span>
              </div>
            `)}
            ${mfaFactors.length === 0 && html`
              <div class="hint">No MFA factors enrolled</div>
            `}
          </div>
        </div>
      `}

      <${CollapsibleSection}
        title="JWT Claims"
        subtitle="${Object.keys(payload).length} fields"
        expanded=${expandedSection === 'jwt'}
        onToggle=${() => setExpandedSection(expandedSection === 'jwt' ? null : 'jwt')}
      >
        <div class="jwt-panel">
          ${Object.entries(payload).map(([key, value]) => html`
            <div class="jwt-field">
              <span class="jwt-key">${key}</span>
              <span class="jwt-value">${formatClaimValue(key, value)}</span>
            </div>
          `)}
        </div>
      </${CollapsibleSection}>

      <${CollapsibleSection}
        title="JWT Header"
        subtitle="${header.alg}"
        expanded=${expandedSection === 'header'}
        onToggle=${() => setExpandedSection(expandedSection === 'header' ? null : 'header')}
      >
        <pre class="auth-json">${JSON.stringify(header, null, 2)}</pre>
      </${CollapsibleSection}>

      ${Object.keys(userMetadata).length > 0 && html`
        <${CollapsibleSection}
          title="User Metadata"
          subtitle="${Object.keys(userMetadata).length} fields"
          expanded=${expandedSection === 'user-meta'}
          onToggle=${() => setExpandedSection(expandedSection === 'user-meta' ? null : 'user-meta')}
        >
          <pre class="auth-json">${JSON.stringify(userMetadata, null, 2)}</pre>
        </${CollapsibleSection}>
      `}

      ${Object.keys(appMetadata).length > 0 && html`
        <${CollapsibleSection}
          title="App Metadata"
          subtitle="${Object.keys(appMetadata).length} fields"
          expanded=${expandedSection === 'app-meta'}
          onToggle=${() => setExpandedSection(expandedSection === 'app-meta' ? null : 'app-meta')}
        >
          <pre class="auth-json">${JSON.stringify(appMetadata, null, 2)}</pre>
        </${CollapsibleSection}>
      `}
    </div>
  `;
}

function ExpiryBar({ expiry, payload }) {
  if (!expiry || !payload.iat || !payload.exp) return null;

  const totalDuration = (payload.exp - payload.iat) * 1000;
  const elapsed = Date.now() - (payload.iat * 1000);
  const percent = Math.min(100, Math.max(0, (elapsed / totalDuration) * 100));

  const issuedAt = new Date(payload.iat * 1000).toLocaleTimeString('en-US', { hour12: false });
  const expiresAt = new Date(payload.exp * 1000).toLocaleTimeString('en-US', { hour12: false });

  return html`
    <div class="expiry-bar-container">
      <div class="expiry-bar">
        <div class="expiry-bar-fill ${expiry.expired ? 'expired' : ''}"
             style="width: ${percent}%"></div>
        <div class="expiry-bar-marker" style="left: ${percent}%"></div>
      </div>
      <div class="expiry-labels">
        <span>${issuedAt}</span>
        <span class="expiry-remaining ${expiry.expired ? 'expired' : ''}">
          ${expiry.expired ? 'EXPIRED' : formatExpiry(expiry.expiresIn)}
        </span>
        <span>${expiresAt}</span>
      </div>
    </div>
  `;
}

function CollapsibleSection({ title, subtitle, expanded, onToggle, children }) {
  return html`
    <div class="section collapsible ${expanded ? 'expanded' : ''}">
      <div class="section-header clickable" onClick=${onToggle}>
        <span class="collapse-arrow">${expanded ? '\u25BE' : '\u25B8'}</span>
        <h3>${title}</h3>
        ${subtitle && html`<span class="section-subtitle">${subtitle}</span>`}
      </div>
      ${expanded && html`<div class="section-body">${children}</div>`}
    </div>
  `;
}
