import { h } from '../../vendor/preact.module.js';
import { useState, useEffect } from '../../vendor/preact-hooks.module.js';
import htm from '../../vendor/htm.module.js';
import { SupabaseRest } from '../../lib/supabase-rest.js';
import { decodeJwt, getJwtExpiry, formatExpiry } from '../../lib/jwt-decode.js';

const html = htm.bind(h);

const SENSITIVE_TABLES = [
  'users', 'profiles', 'accounts', 'auth_users',
  'passwords', 'credentials', 'tokens', 'sessions',
  'payments', 'billing', 'orders', 'transactions',
  'documents', 'files', 'messages', 'emails',
  'api_keys', 'secrets', 'settings', 'configurations'
];

function classifyRisk(status, rowCount) {
  if (status === 401 || status === 403) return 'safe';
  if (status !== 200) return 'safe';
  if (rowCount >= 30) return 'danger';
  if (rowCount > 0) return 'warning';
  return 'safe';
}

function extractTableNames(spec) {
  if (!spec?.paths) return [];
  return Object.keys(spec.paths)
    .map(path => path.replace(/^\//, ''))
    .filter(name => name && !name.startsWith('rpc/'));
}

export function SecurityTab({ credentials }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [jwtDecoded, setJwtDecoded] = useState(null);

  useEffect(() => {
    if (credentials.jwt) {
      setJwtDecoded(decodeJwt(credentials.jwt));
    }
  }, [credentials.jwt]);

  async function runCheck() {
    setLoading(true);
    const client = new SupabaseRest(credentials);

    const spec = await client.getOpenApiSpec();
    const tables = extractTableNames(spec);

    const checks = await Promise.all(
      tables.map(async (table) => {
        const { data, status } = await client.select(table, { limit: 30 });
        return {
          table,
          status,
          rowCount: data.length,
          risk: classifyRisk(status, data.length),
          sensitive: SENSITIVE_TABLES.includes(table)
        };
      })
    );

    checks.sort((a, b) => {
      if (a.sensitive !== b.sensitive) return a.sensitive ? -1 : 1;
      const riskOrder = { danger: 0, warning: 1, safe: 2 };
      return (riskOrder[a.risk] || 2) - (riskOrder[b.risk] || 2);
    });

    setResults(checks);
    setLoading(false);
  }

  return html`
    <div class="security-tab">
      <div class="section">
        <div class="section-header">
          <h3>RLS Risk Dashboard</h3>
          <button class="btn btn-sm" onClick=${runCheck} disabled=${loading}>
            ${loading ? 'Checking...' : 'Run Check'}
          </button>
        </div>
        ${results.length > 0 && html`
          <div class="risk-list">
            ${results.map(r => html`
              <${RiskRow} ...${r} />
            `)}
          </div>
        `}
        ${results.length === 0 && !loading && html`
          <p class="hint">Click "Run Check" to scan tables for RLS issues.</p>
        `}
      </div>

      ${jwtDecoded && html`
        <div class="section">
          <h3>JWT Claims</h3>
          <${JwtPanel} decoded=${jwtDecoded} />
        </div>
      `}
    </div>
  `;
}

function RiskRow({ table, risk, rowCount, status, sensitive }) {
  const colors = { safe: 'var(--safe)', warning: 'var(--warning)', danger: 'var(--danger)' };
  const labels = { safe: 'Safe', warning: 'Review', danger: 'Exposed' };

  return html`
    <div class="risk-row">
      <span class="risk-dot" style="background: ${colors[risk]}"></span>
      <span class="risk-table ${sensitive ? 'sensitive' : ''}">
        ${table}
        ${sensitive && html`<span class="sensitive-badge">sensitive</span>`}
      </span>
      <span class="risk-detail">
        ${status === 200 ? `${rowCount} rows` : `HTTP ${status}`}
      </span>
      <span class="risk-label" style="color: ${colors[risk]}">${labels[risk]}</span>
    </div>
  `;
}

function JwtPanel({ decoded }) {
  const { payload } = decoded;
  const expiry = getJwtExpiry(decoded);

  const fields = [
    { key: 'sub', label: 'Subject (user ID)' },
    { key: 'email', label: 'Email' },
    { key: 'role', label: 'Role' },
    { key: 'aud', label: 'Audience' },
    { key: 'iss', label: 'Issuer' },
    { key: 'iat', label: 'Issued At', format: v => new Date(v * 1000).toLocaleString() },
    { key: 'exp', label: 'Expires', format: v => new Date(v * 1000).toLocaleString() },
  ];

  return html`
    <div class="jwt-panel">
      ${fields.map(f => payload[f.key] != null && html`
        <div class="jwt-field">
          <span class="jwt-key">${f.label}</span>
          <span class="jwt-value">${f.format ? f.format(payload[f.key]) : payload[f.key]}</span>
        </div>
      `)}
      ${expiry && html`
        <div class="jwt-field">
          <span class="jwt-key">Time Remaining</span>
          <span class="jwt-value ${expiry.expired ? 'expired' : ''}">
            ${formatExpiry(expiry.expiresIn)}
          </span>
        </div>
      `}
    </div>
  `;
}
