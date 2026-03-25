import { h } from '../../vendor/preact.module.js';
import { useState } from '../../vendor/preact-hooks.module.js';
import htm from '../../vendor/htm.module.js';

const html = htm.bind(h);

async function safeFetch(url, headers) {
  try {
    const res = await fetch(url, { headers: { ...headers, 'Range': '0-0' } });
    if (res.ok) {
      const data = await res.json();
      const columns = data.length > 0 ? Object.keys(data[0]) : [];
      return { status: res.status, columns };
    }
    return { status: res.status, columns: [] };
  } catch {
    return { status: 0, columns: [] };
  }
}

async function safeFetchCount(url, headers) {
  try {
    const res = await fetch(url, {
      headers: { ...headers, 'Prefer': 'count=exact', 'Range': '0-0' }
    });
    const range = res.headers.get('content-range');
    if (range) {
      const total = range.split('/')[1];
      return total === '*' ? null : parseInt(total);
    }
    return res.ok ? 0 : null;
  } catch {
    return null;
  }
}

async function safeWriteTest(url, headers) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'return=minimal', 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    if (res.status === 201) return 'writable';
    if (res.status === 400 || res.status === 409) return 'writable';
    if (res.status === 401 || res.status === 403) return 'denied';
    return `http-${res.status}`;
  } catch {
    return 'error';
  }
}

function classifyDiff(anonRes, authRes, anonCount, authCount) {
  if (anonRes.status >= 400 && authRes.status >= 400) return 'expected';
  if (anonRes.status === 200 && authRes.status >= 400) return 'review';
  if (anonRes.status === 200 && authRes.status === 200) {
    if (anonCount !== null && authCount !== null && anonCount > authCount) return 'misconfigured';
    if (anonCount !== null && anonCount >= 30) return 'review';
    if (authCount !== null && anonCount !== null && authCount > anonCount) return 'expected';
    if (anonCount === authCount && anonCount > 0) return 'review';
  }
  if (authRes.status === 200 && anonRes.status >= 400) return 'expected';
  return 'expected';
}

async function diffTable(table, credentials) {
  const { projectUrl, apikey, jwt } = credentials;

  const anonHeaders = { 'apikey': apikey, 'Content-Type': 'application/json', 'Prefer': 'count=exact' };
  const authHeaders = { ...anonHeaders, 'Authorization': `Bearer ${jwt}` };

  const url = `${projectUrl}/rest/v1/${table}?select=*&limit=1`;

  const [anonRes, authRes] = await Promise.all([
    safeFetch(url, anonHeaders),
    safeFetch(url, authHeaders)
  ]);

  const [anonCount, authCount] = await Promise.all([
    safeFetchCount(`${projectUrl}/rest/v1/${table}?select=*&limit=0`, anonHeaders),
    safeFetchCount(`${projectUrl}/rest/v1/${table}?select=*&limit=0`, authHeaders)
  ]);

  const [anonWrite, authWrite] = await Promise.all([
    safeWriteTest(`${projectUrl}/rest/v1/${table}`, anonHeaders),
    safeWriteTest(`${projectUrl}/rest/v1/${table}`, authHeaders)
  ]);

  return {
    table,
    anon: {
      readStatus: anonRes.status,
      rowCount: anonCount,
      columns: anonRes.columns,
      writeStatus: anonWrite
    },
    auth: {
      readStatus: authRes.status,
      rowCount: authCount,
      columns: authRes.columns,
      writeStatus: authWrite
    },
    flag: classifyDiff(anonRes, authRes, anonCount, authCount)
  };
}

export function PermissionDiffTab({ credentials, schema }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [expandedTable, setExpandedTable] = useState(null);

  const tables = schema?.tables || [];

  async function runDiff() {
    setLoading(true);
    setResults([]);
    setProgress({ current: 0, total: tables.length });

    const allResults = [];

    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      setProgress({ current: i + 1, total: tables.length });

      const result = await diffTable(table.name, credentials);
      allResults.push(result);
      setResults([...allResults]);
    }

    allResults.sort((a, b) => {
      const order = { misconfigured: 0, review: 1, expected: 2 };
      return (order[a.flag] || 2) - (order[b.flag] || 2);
    });

    setResults(allResults);
    setLoading(false);
  }

  const flagCounts = {
    expected: results.filter(r => r.flag === 'expected').length,
    review: results.filter(r => r.flag === 'review').length,
    misconfigured: results.filter(r => r.flag === 'misconfigured').length
  };

  return html`
    <div class="diff-tab">
      <div class="diff-toolbar">
        <button class="btn btn-primary" onClick=${runDiff} disabled=${loading}>
          ${loading ? 'Running...' : 'Run Diff'}
        </button>

        ${loading && html`
          <div class="diff-progress">
            <div class="diff-progress-bar">
              <div class="diff-progress-fill"
                   style="width: ${(progress.current / progress.total) * 100}%"></div>
            </div>
            <span class="diff-progress-text">
              ${progress.current} / ${progress.total} tables
            </span>
          </div>
        `}

        ${results.length > 0 && !loading && html`
          <div class="diff-summary">
            <span class="diff-count expected">\u2713 ${flagCounts.expected}</span>
            <span class="diff-count review">\u26A0 ${flagCounts.review}</span>
            <span class="diff-count misconfigured">\u2715 ${flagCounts.misconfigured}</span>
          </div>
        `}
      </div>

      ${results.length === 0 && !loading && html`
        <div class="empty-hint">
          Click "Run Diff" to compare anon vs. authenticated access across all tables.
        </div>
      `}

      ${results.length > 0 && html`
        <div class="diff-results">
          <table class="diff-grid">
            <thead>
              <tr>
                <th>Table</th>
                <th>Anon Read</th>
                <th>Auth Read</th>
                <th>Anon Rows</th>
                <th>Auth Rows</th>
                <th>Anon Write</th>
                <th>Auth Write</th>
                <th>Flag</th>
              </tr>
            </thead>
            <tbody>
              ${results.map(r => html`
                <tr class="diff-row flag-${r.flag}"
                    onClick=${() => setExpandedTable(expandedTable === r.table ? null : r.table)}>
                  <td class="diff-table-name">${r.table}</td>
                  <td><${StatusBadge} status=${r.anon.readStatus} /></td>
                  <td><${StatusBadge} status=${r.auth.readStatus} /></td>
                  <td class="diff-count-cell">${r.anon.rowCount ?? '\u2014'}</td>
                  <td class="diff-count-cell">${r.auth.rowCount ?? '\u2014'}</td>
                  <td><${WriteBadge} status=${r.anon.writeStatus} /></td>
                  <td><${WriteBadge} status=${r.auth.writeStatus} /></td>
                  <td><${FlagBadge} flag=${r.flag} /></td>
                </tr>

                ${expandedTable === r.table && html`
                  <tr class="diff-detail-row">
                    <td colspan="8">
                      <${DiffDetail} result=${r} />
                    </td>
                  </tr>
                `}
              `)}
            </tbody>
          </table>
        </div>
      `}
    </div>
  `;
}

function StatusBadge({ status }) {
  if (status === 200) return html`<span class="badge badge-ok">200</span>`;
  if (status === 401) return html`<span class="badge badge-denied">401</span>`;
  if (status === 403) return html`<span class="badge badge-denied">403</span>`;
  return html`<span class="badge badge-other">${status || '?'}</span>`;
}

function WriteBadge({ status }) {
  if (status === 'writable') return html`<span class="badge badge-warn">yes</span>`;
  if (status === 'denied') return html`<span class="badge badge-ok">no</span>`;
  return html`<span class="badge badge-other">${status}</span>`;
}

function FlagBadge({ flag }) {
  const config = {
    expected: { text: '\u2713', cls: 'flag-expected' },
    review: { text: '\u26A0', cls: 'flag-review' },
    misconfigured: { text: '\u2715', cls: 'flag-danger' }
  };
  const c = config[flag] || config.expected;
  return html`<span class="flag-badge ${c.cls}">${c.text}</span>`;
}

function DiffDetail({ result }) {
  const { anon, auth } = result;

  return html`
    <div class="diff-detail">
      <div class="diff-detail-section">
        <strong>Anon columns (${anon.columns.length}):</strong>
        <span class="diff-columns">${anon.columns.join(', ') || 'none'}</span>
      </div>
      <div class="diff-detail-section">
        <strong>Auth columns (${auth.columns.length}):</strong>
        <span class="diff-columns">${auth.columns.join(', ') || 'none'}</span>
      </div>
      ${anon.columns.length > 0 && auth.columns.length > 0 && html`
        <div class="diff-detail-section">
          <strong>Column diff:</strong>
          <span class="diff-columns">
            ${(() => {
              const anonSet = new Set(anon.columns);
              const authSet = new Set(auth.columns);
              const onlyAnon = anon.columns.filter(c => !authSet.has(c));
              const onlyAuth = auth.columns.filter(c => !anonSet.has(c));
              const parts = [];
              if (onlyAnon.length > 0) parts.push(`Anon only: ${onlyAnon.join(', ')}`);
              if (onlyAuth.length > 0) parts.push(`Auth only: ${onlyAuth.join(', ')}`);
              return parts.length > 0 ? parts.join(' | ') : 'Same columns';
            })()}
          </span>
        </div>
      `}
    </div>
  `;
}
