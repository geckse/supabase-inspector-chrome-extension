import { h } from '../../vendor/preact.module.js';
import { useState, useEffect } from '../../vendor/preact-hooks.module.js';
import htm from '../../vendor/htm.module.js';
import { SupabaseRest } from '../../lib/supabase-rest.js';
import { extractTableNames } from '../../lib/schema-parser.js';
import { decodeJwt, getJwtExpiry, formatExpiry } from '../../lib/jwt-decode.js';

const html = htm.bind(h);

const SENSITIVE_TABLES = [
  'users', 'profiles', 'accounts', 'auth_users',
  'passwords', 'credentials', 'tokens', 'sessions',
  'payments', 'billing', 'orders', 'transactions',
  'documents', 'files', 'messages', 'emails',
  'api_keys', 'secrets', 'settings', 'configurations'
];

function classifyRisk(result) {
  const issues = result.issues.length;
  if (issues === 0) return 'safe';
  if (result.issues.some(i => i.severity === 'danger')) return 'danger';
  if (result.issues.some(i => i.severity === 'warning')) return 'warning';
  return 'safe';
}

async function checkTable(table, credentials) {
  const { projectUrl, apikey, jwt } = credentials;
  const issues = [];

  const authHeaders = {
    'apikey': apikey,
    'Content-Type': 'application/json',
  };
  if (jwt) authHeaders['Authorization'] = `Bearer ${jwt}`;

  const anonHeaders = {
    'apikey': apikey,
    'Content-Type': 'application/json',
  };

  // ── Read check (authenticated) ──
  let authReadStatus = 0;
  let authRowCount = 0;
  let authColumns = [];
  let authSample = null;
  try {
    const res = await fetch(`${projectUrl}/rest/v1/${table}?select=*&limit=30`, {
      headers: { ...authHeaders, 'Prefer': 'count=exact', 'Range': '0-29' }
    });
    authReadStatus = res.status;
    if (res.ok) {
      const data = await res.json();
      authRowCount = data.length;
      authColumns = data.length > 0 ? Object.keys(data[0]) : [];
      authSample = data[0] || null;
      const range = res.headers.get('content-range');
      if (range) {
        const total = range.split('/')[1];
        if (total !== '*') authRowCount = parseInt(total);
      }
    }
  } catch {}

  // ── Read check (anon — no Authorization header) ──
  let anonReadStatus = 0;
  let anonRowCount = 0;
  let anonColumns = [];
  try {
    const res = await fetch(`${projectUrl}/rest/v1/${table}?select=*&limit=30`, {
      headers: { ...anonHeaders, 'Prefer': 'count=exact', 'Range': '0-29' }
    });
    anonReadStatus = res.status;
    if (res.ok) {
      const data = await res.json();
      anonRowCount = data.length;
      anonColumns = data.length > 0 ? Object.keys(data[0]) : [];
      const range = res.headers.get('content-range');
      if (range) {
        const total = range.split('/')[1];
        if (total !== '*') anonRowCount = parseInt(total);
      }
    }
  } catch {}

  // ── Write check: INSERT only ──
  // Only INSERT can be reliably tested non-destructively.
  // POST with empty body {}: 401/403 = denied by GRANT/RLS, 400 = allowed (not-null violation),
  // 201 = allowed AND row created, 409 = allowed (constraint violation).
  //
  // UPDATE/DELETE CANNOT be reliably tested: PostgREST returns 200/204 for
  // "0 rows affected" regardless of whether RLS allows the operation.
  // We mark them as "untestable" instead of generating false positives.
  async function testInsert(headers) {
    try {
      const res = await fetch(`${projectUrl}/rest/v1/${table}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({})
      });

      // 401/403 = role doesn't have INSERT permission or RLS blocks
      if (res.status === 401 || res.status === 403) return 'denied';

      // 400 = INSERT is allowed but data is invalid (not-null constraint, etc.)
      if (res.status === 400) return 'allowed';

      // 409 = INSERT is allowed but constraint violation (unique, FK, etc.)
      if (res.status === 409) return 'allowed';

      // 201 = INSERT actually succeeded (empty row with defaults)
      if (res.status === 201) return 'allowed';

      // 404 = table not found for this method
      if (res.status === 404) return 'denied';

      return `http-${res.status}`;
    } catch {
      return 'error';
    }
  }

  const anonInsert = await testInsert(anonHeaders);
  const authInsert = await testInsert(authHeaders);

  // ── Build issues ──
  const isSensitive = SENSITIVE_TABLES.includes(table);

  // Anon read access
  if (anonReadStatus === 200 && anonRowCount >= 30) {
    issues.push({
      severity: 'danger',
      title: 'Unrestricted anonymous read access',
      detail: `Anonymous users can read ${anonRowCount}+ rows. RLS is likely disabled or has no SELECT policy.`
    });
  } else if (anonReadStatus === 200 && anonRowCount > 0) {
    issues.push({
      severity: isSensitive ? 'danger' : 'warning',
      title: 'Anonymous read access',
      detail: `Anonymous users can read ${anonRowCount} row(s). ${isSensitive ? 'This is a sensitive table.' : 'Verify this is intentional.'}`
    });
  }

  // Auth read — large unscoped access
  if (authReadStatus === 200 && authRowCount >= 30 && isSensitive) {
    issues.push({
      severity: 'warning',
      title: 'Broad authenticated read on sensitive table',
      detail: `Authenticated users can read ${authRowCount}+ rows. Verify RLS policies scope access to the user's own data.`
    });
  }

  // Anon INSERT
  if (anonInsert === 'allowed') {
    issues.push({
      severity: 'danger',
      title: 'Anonymous INSERT allowed',
      detail: 'Unauthenticated users can insert rows. The table accepts POST requests without authentication.'
    });
  }

  // Auth INSERT on sensitive tables
  if (isSensitive && authInsert === 'allowed') {
    issues.push({
      severity: 'warning',
      title: 'Authenticated INSERT on sensitive table',
      detail: 'Authenticated users can insert into this sensitive table. Verify the INSERT policy is scoped appropriately.'
    });
  }

  // Column exposure diff
  if (anonColumns.length > 0 && authColumns.length > 0) {
    const anonExtra = anonColumns.filter(c => !authColumns.includes(c));
    if (anonExtra.length > 0) {
      issues.push({
        severity: 'warning',
        title: 'Anon sees columns hidden from auth',
        detail: `Anonymous access exposes columns not visible to authenticated users: ${anonExtra.join(', ')}`
      });
    }
  }

  return {
    table,
    sensitive: isSensitive,
    risk: 'safe', // will be set below
    issues,
    details: {
      anon: { read: anonReadStatus, rows: anonRowCount, columns: anonColumns, insert: anonInsert },
      auth: { read: authReadStatus, rows: authRowCount, columns: authColumns, insert: authInsert },
      sampleRow: authSample
    }
  };
}

export function SecurityTab({ credentials, schema }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [jwtDecoded, setJwtDecoded] = useState(null);
  const [expandedTable, setExpandedTable] = useState(null);
  const [filterRisk, setFilterRisk] = useState('all'); // 'all' | 'danger' | 'warning' | 'safe'

  useEffect(() => {
    if (credentials.jwt) {
      setJwtDecoded(decodeJwt(credentials.jwt));
    }
  }, [credentials.jwt]);

  async function runCheck() {
    setLoading(true);
    setResults([]);

    let tables = [];
    if (schema?.tables?.length > 0) {
      tables = schema.tables.map(t => t.name);
    } else {
      const client = new SupabaseRest(credentials);
      const spec = await client.getOpenApiSpec();
      tables = extractTableNames(spec);
    }

    if (tables.length === 0) {
      setLoading(false);
      return;
    }

    setProgress({ current: 0, total: tables.length });
    const allResults = [];

    // Run sequentially to avoid overwhelming the API
    for (let i = 0; i < tables.length; i++) {
      setProgress({ current: i + 1, total: tables.length });
      const result = await checkTable(tables[i], credentials);
      result.risk = classifyRisk(result);
      allResults.push(result);
      setResults([...allResults]);
    }

    // Sort: danger first, then warning, then safe. Sensitive tables float up.
    allResults.sort((a, b) => {
      if (a.sensitive !== b.sensitive) return a.sensitive ? -1 : 1;
      const riskOrder = { danger: 0, warning: 1, safe: 2 };
      return (riskOrder[a.risk] || 2) - (riskOrder[b.risk] || 2);
    });

    setResults(allResults);
    setLoading(false);
  }

  const hasSchema = schema?.tables?.length > 0;

  const counts = {
    danger: results.filter(r => r.risk === 'danger').length,
    warning: results.filter(r => r.risk === 'warning').length,
    safe: results.filter(r => r.risk === 'safe').length
  };

  const filtered = filterRisk === 'all' ? results : results.filter(r => r.risk === filterRisk);
  const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
  const [copied, setCopied] = useState(null); // 'md' | 'html' | null

  function generateMarkdown() {
    const riskIcon = { danger: '\u274C', warning: '\u26A0\uFE0F', safe: '\u2705' };
    const riskLabel = { danger: 'EXPOSED', warning: 'REVIEW', safe: 'SAFE' };
    const projectUrl = credentials?.projectUrl?.replace('https://', '') || 'unknown';
    const date = new Date().toISOString().split('T')[0];

    let md = `# RLS Security Report\n\n`;
    md += `**Project:** ${projectUrl}\n`;
    md += `**Date:** ${date}\n`;
    md += `**Tables scanned:** ${results.length}\n`;
    md += `**Issues found:** ${totalIssues}\n\n`;

    md += `## Summary\n\n`;
    md += `| Status | Count |\n|---|---|\n`;
    md += `| ${riskIcon.danger} Exposed | ${counts.danger} |\n`;
    md += `| ${riskIcon.warning} Review | ${counts.warning} |\n`;
    md += `| ${riskIcon.safe} Safe | ${counts.safe} |\n\n`;

    md += `## Details\n\n`;
    md += `| Table | Risk | Anon Read | Auth Read | Anon Rows | Auth Rows | Anon INSERT | Auth INSERT | Issues |\n`;
    md += `|---|---|---|---|---|---|---|---|---|\n`;
    for (const r of results) {
      md += `| ${r.sensitive ? '**' + r.table + '**' : r.table} | ${riskIcon[r.risk]} ${riskLabel[r.risk]} | ${r.details.anon.read} | ${r.details.auth.read} | ${r.details.anon.rows} | ${r.details.auth.rows} | ${r.details.anon.insert} | ${r.details.auth.insert} | ${r.issues.length} |\n`;
    }

    // Detailed issues per table
    const tablesWithIssues = results.filter(r => r.issues.length > 0);
    if (tablesWithIssues.length > 0) {
      md += `\n## Issues by Table\n\n`;
      for (const r of tablesWithIssues) {
        md += `### ${r.table}${r.sensitive ? ' (sensitive)' : ''}\n\n`;

        md += `**Access Matrix:**\n\n`;
        md += `|  | Read | Rows | INSERT |\n|---|---|---|---|\n`;
        md += `| Anon | ${r.details.anon.read} | ${r.details.anon.rows} | ${r.details.anon.insert} |\n`;
        md += `| Auth | ${r.details.auth.read} | ${r.details.auth.rows} | ${r.details.auth.insert} |\n\n`;
        md += `> *Note: UPDATE/DELETE cannot be reliably tested via HTTP without side effects.*\n\n`;

        if (r.details.anon.columns.length > 0) {
          md += `**Anon visible columns:** \`${r.details.anon.columns.join('`, `')}\`\n\n`;
        }
        if (r.details.auth.columns.length > 0) {
          md += `**Auth visible columns:** \`${r.details.auth.columns.join('`, `')}\`\n\n`;
        }

        for (const issue of r.issues) {
          md += `- ${issue.severity === 'danger' ? riskIcon.danger : riskIcon.warning} **${issue.title}** — ${issue.detail}\n`;
        }
        md += `\n`;
      }
    }

    md += `---\n*Generated by Supabase Inspector*\n`;
    return md;
  }

  function generateHTML() {
    const riskColor = { danger: '#e5484d', warning: '#f0c75e', safe: '#3ecf8e' };
    const riskLabel = { danger: 'EXPOSED', warning: 'REVIEW', safe: 'SAFE' };
    const projectUrl = credentials?.projectUrl?.replace('https://', '') || 'unknown';
    const date = new Date().toISOString().split('T')[0];

    let h = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>RLS Security Report - ${projectUrl}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#1a1a1a;line-height:1.5}
h1{border-bottom:2px solid #3ecf8e;padding-bottom:8px}
h2{margin-top:32px;color:#333}
h3{margin-top:24px;color:#444}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}
th{background:#f5f5f5;text-align:left;padding:8px 10px;border:1px solid #ddd;font-weight:600}
td{padding:6px 10px;border:1px solid #ddd}
tr:nth-child(even){background:#fafafa}
.badge{display:inline-block;padding:2px 8px;border-radius:3px;font-size:11px;font-weight:600;color:white}
.danger{background:#e5484d}
.warning{background:#f0c75e;color:#1a1a1a}
.safe{background:#3ecf8e;color:#1a1a1a}
.issue{padding:8px 12px;margin:4px 0;border-radius:4px;font-size:13px}
.issue-danger{background:#fef2f2;border-left:3px solid #e5484d}
.issue-warning{background:#fefce8;border-left:3px solid #f0c75e}
.issue strong{display:block;margin-bottom:2px}
code{background:#f0f0f0;padding:1px 4px;border-radius:2px;font-size:12px}
.meta{color:#666;font-size:13px;margin-bottom:24px}
.summary-grid{display:flex;gap:16px;margin:16px 0}
.summary-card{padding:12px 20px;border-radius:6px;text-align:center;flex:1}
.summary-card .count{font-size:28px;font-weight:700}
.summary-card .label{font-size:12px;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px}
</style></head><body>
<h1>RLS Security Report</h1>
<div class="meta">
<strong>Project:</strong> ${projectUrl}<br>
<strong>Date:</strong> ${date}<br>
<strong>Tables scanned:</strong> ${results.length}<br>
<strong>Issues found:</strong> ${totalIssues}
</div>

<h2>Summary</h2>
<div class="summary-grid">
<div class="summary-card" style="background:#fef2f2"><div class="count" style="color:#e5484d">${counts.danger}</div><div class="label">Exposed</div></div>
<div class="summary-card" style="background:#fefce8"><div class="count" style="color:#a16207">${counts.warning}</div><div class="label">Review</div></div>
<div class="summary-card" style="background:#f0fdf4"><div class="count" style="color:#16a34a">${counts.safe}</div><div class="label">Safe</div></div>
</div>

<h2>All Tables</h2>
<table>
<tr><th>Table</th><th>Risk</th><th>Anon Read</th><th>Auth Read</th><th>Anon Rows</th><th>Auth Rows</th><th>Issues</th></tr>`;

    for (const r of results) {
      h += `<tr>
<td>${r.sensitive ? '<strong>' + r.table + '</strong> <code>sensitive</code>' : r.table}</td>
<td><span class="badge ${r.risk}">${riskLabel[r.risk]}</span></td>
<td>${r.details.anon.read}</td>
<td>${r.details.auth.read}</td>
<td>${r.details.anon.rows}</td>
<td>${r.details.auth.rows}</td>
<td>${r.issues.length}</td>
</tr>`;
    }
    h += `</table>`;

    const tablesWithIssues = results.filter(r => r.issues.length > 0);
    if (tablesWithIssues.length > 0) {
      h += `<h2>Issues by Table</h2>`;
      for (const r of tablesWithIssues) {
        h += `<h3>${r.table}${r.sensitive ? ' <code>sensitive</code>' : ''}</h3>`;

        h += `<table>
<tr><th></th><th>Read</th><th>Rows</th><th>INSERT</th></tr>
<tr><td><strong>Anon</strong></td><td>${r.details.anon.read}</td><td>${r.details.anon.rows}</td><td>${r.details.anon.insert}</td></tr>
<tr><td><strong>Auth</strong></td><td>${r.details.auth.read}</td><td>${r.details.auth.rows}</td><td>${r.details.auth.insert}</td></tr>
</table>
<p style="color:#999;font-size:11px"><em>UPDATE/DELETE cannot be reliably tested via HTTP without side effects.</em></p>`;

        if (r.details.anon.columns.length > 0) {
          h += `<p><strong>Anon visible columns:</strong> ${r.details.anon.columns.map(c => '<code>' + c + '</code>').join(', ')}</p>`;
        }
        if (r.details.auth.columns.length > 0) {
          h += `<p><strong>Auth visible columns:</strong> ${r.details.auth.columns.map(c => '<code>' + c + '</code>').join(', ')}</p>`;
        }

        for (const issue of r.issues) {
          h += `<div class="issue issue-${issue.severity}"><strong>${issue.title}</strong>${issue.detail}</div>`;
        }
      }
    }

    h += `<hr><p style="color:#999;font-size:12px">Generated by Supabase Inspector</p></body></html>`;
    return h;
  }

  function copyReport(format) {
    const text = format === 'md' ? generateMarkdown() : generateHTML();
    navigator.clipboard.writeText(text);
    setCopied(format);
    setTimeout(() => setCopied(null), 2000);
  }

  function downloadReport(format) {
    const text = format === 'md' ? generateMarkdown() : generateHTML();
    const ext = format === 'md' ? 'md' : 'html';
    const mime = format === 'md' ? 'text/markdown' : 'text/html';
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rls-report-${new Date().toISOString().split('T')[0]}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return html`
    <div class="security-tab">
      <div class="section">
        <div class="section-header">
          <h3>RLS Risk Dashboard</h3>
          <button class="btn btn-sm" onClick=${runCheck} disabled=${loading || !hasSchema}>
            ${loading ? 'Checking...' : 'Run Check'}
          </button>
        </div>

        ${loading && html`
          <div class="diff-progress">
            <div class="diff-progress-bar">
              <div class="diff-progress-fill" style="width: ${(progress.current / progress.total) * 100}%"></div>
            </div>
            <span class="diff-progress-text">${progress.current} / ${progress.total} tables</span>
          </div>
        `}

        ${results.length > 0 && !loading && html`
          <div class="rls-summary">
            <span class="rls-summary-total">${totalIssues} issue${totalIssues !== 1 ? 's' : ''} across ${results.length} tables</span>
            <div class="rls-filters">
              <button class="btn btn-sm ${filterRisk === 'all' ? 'btn-active' : ''}"
                      onClick=${() => setFilterRisk('all')}>All (${results.length})</button>
              ${counts.danger > 0 && html`
                <button class="btn btn-sm rls-filter-danger ${filterRisk === 'danger' ? 'btn-active' : ''}"
                        onClick=${() => setFilterRisk('danger')}>Exposed (${counts.danger})</button>
              `}
              ${counts.warning > 0 && html`
                <button class="btn btn-sm rls-filter-warning ${filterRisk === 'warning' ? 'btn-active' : ''}"
                        onClick=${() => setFilterRisk('warning')}>Review (${counts.warning})</button>
              `}
              <button class="btn btn-sm rls-filter-safe ${filterRisk === 'safe' ? 'btn-active' : ''}"
                      onClick=${() => setFilterRisk('safe')}>Safe (${counts.safe})</button>
            </div>
          </div>
          <div class="rls-export">
            <span class="rls-export-label">Export report:</span>
            <button class="btn btn-sm" onClick=${() => copyReport('md')}>
              ${copied === 'md' ? 'Copied!' : 'Copy Markdown'}
            </button>
            <button class="btn btn-sm" onClick=${() => copyReport('html')}>
              ${copied === 'html' ? 'Copied!' : 'Copy HTML'}
            </button>
            <button class="btn btn-sm" onClick=${() => downloadReport('md')}>
              \u2193 .md
            </button>
            <button class="btn btn-sm" onClick=${() => downloadReport('html')}>
              \u2193 .html
            </button>
          </div>
        `}

        ${filtered.length > 0 && html`
          <div class="risk-list">
            ${filtered.map(r => html`
              <${RiskRow}
                key=${r.table}
                result=${r}
                expanded=${expandedTable === r.table}
                onToggle=${() => setExpandedTable(expandedTable === r.table ? null : r.table)}
              />
            `)}
          </div>
        `}

        ${results.length === 0 && !loading && hasSchema && html`
          <p class="hint">Click "Run Check" to deep-scan ${schema.tables.length} tables for RLS issues.</p>
        `}
        ${!hasSchema && !loading && html`
          <p class="hint">Waiting for schema to load. Navigate the site to discover tables.</p>
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

function RiskRow({ result, expanded, onToggle }) {
  const { table, risk, sensitive, issues, details } = result;
  const colors = { safe: 'var(--safe)', warning: 'var(--warning)', danger: 'var(--danger)' };
  const labels = { safe: 'Safe', warning: 'Review', danger: 'Exposed' };

  return html`
    <div class="risk-row-wrap">
      <div class="risk-row ${expanded ? 'expanded' : ''}" onClick=${onToggle}>
        <span class="risk-dot" style="background: ${colors[risk]}"></span>
        <span class="risk-table ${sensitive ? 'sensitive' : ''}">
          ${table}
          ${sensitive && html`<span class="sensitive-badge">sensitive</span>`}
        </span>
        <span class="risk-issue-count">
          ${issues.length > 0 ? `${issues.length} issue${issues.length > 1 ? 's' : ''}` : ''}
        </span>
        <span class="risk-label" style="color: ${colors[risk]}">${labels[risk]}</span>
        <span class="risk-chevron">${expanded ? '\u25BE' : '\u25B8'}</span>
      </div>
      ${expanded && html`
        <div class="risk-detail-panel">
          <!-- Access overview -->
          <div class="risk-access-grid-3col">
            <div class="risk-access-header"></div>
            <div class="risk-access-header">Read</div>
            <div class="risk-access-header">Rows</div>
            <div class="risk-access-header">INSERT</div>

            <div class="risk-access-label">Anon</div>
            <${AccessBadge} value=${details.anon.read} type="status" />
            <div class="risk-access-cell">${details.anon.rows}</div>
            <${AccessBadge} value=${details.anon.insert} type="write" />

            <div class="risk-access-label">Auth</div>
            <${AccessBadge} value=${details.auth.read} type="status" />
            <div class="risk-access-cell">${details.auth.rows}</div>
            <${AccessBadge} value=${details.auth.insert} type="write" />
          </div>
          <div class="risk-access-note">
            UPDATE/DELETE cannot be reliably tested via HTTP without side effects.
          </div>

          <!-- Columns visible -->
          ${details.anon.columns.length > 0 && html`
            <div class="risk-detail-section">
              <strong>Anon visible columns (${details.anon.columns.length})</strong>
              <div class="risk-columns">${details.anon.columns.join(', ')}</div>
            </div>
          `}
          ${details.auth.columns.length > 0 && html`
            <div class="risk-detail-section">
              <strong>Auth visible columns (${details.auth.columns.length})</strong>
              <div class="risk-columns">${details.auth.columns.join(', ')}</div>
            </div>
          `}

          <!-- Issues -->
          ${issues.length > 0 && html`
            <div class="risk-issues">
              ${issues.map(issue => html`
                <div class="risk-issue risk-issue-${issue.severity}">
                  <span class="risk-issue-icon">
                    ${issue.severity === 'danger' ? '\u2715' : '\u26A0'}
                  </span>
                  <div>
                    <div class="risk-issue-title">${issue.title}</div>
                    <div class="risk-issue-detail">${issue.detail}</div>
                  </div>
                </div>
              `)}
            </div>
          `}
          ${issues.length === 0 && html`
            <div class="risk-no-issues">No issues detected. Access appears properly restricted.</div>
          `}
        </div>
      `}
    </div>
  `;
}

function AccessBadge({ value, type }) {
  if (type === 'status') {
    if (value === 200) return html`<div class="risk-access-cell"><span class="badge badge-warn">200</span></div>`;
    if (value === 401 || value === 403) return html`<div class="risk-access-cell"><span class="badge badge-ok">${value}</span></div>`;
    return html`<div class="risk-access-cell"><span class="badge badge-other">${value || '?'}</span></div>`;
  }
  if (value === 'allowed') return html`<div class="risk-access-cell"><span class="badge badge-warn">yes</span></div>`;
  if (value === 'denied') return html`<div class="risk-access-cell"><span class="badge badge-ok">no</span></div>`;
  return html`<div class="risk-access-cell"><span class="badge badge-other">${value}</span></div>`;
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
