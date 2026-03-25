import { h } from '../../vendor/preact.module.js';
import { useState } from '../../vendor/preact-hooks.module.js';
import htm from '../../vendor/htm.module.js';

const html = htm.bind(h);

function filterEntries(entries, { table, method, statusGroup }) {
  return entries.filter(entry => {
    if (table && !entry.table?.toLowerCase().includes(table.toLowerCase())) return false;
    if (method && entry.method !== method) return false;
    if (statusGroup && entry.response) {
      const s = entry.response.status;
      if (statusGroup === '2xx' && (s < 200 || s >= 300)) return false;
      if (statusGroup === '4xx' && (s < 400 || s >= 500)) return false;
      if (statusGroup === '5xx' && s < 500) return false;
    }
    return true;
  });
}

function formatResponseBody(body) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body || '(empty)';
  }
}

export function LoggerTab({ entries, onClear }) {
  const [enabled, setEnabled] = useState(true);
  const [paused, setPaused] = useState(false);
  const [filters, setFilters] = useState({ table: '', method: '', statusGroup: '' });
  const [expandedId, setExpandedId] = useState(null);

  const filtered = filterEntries(entries, filters);

  function handleExport() {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `supabase-log-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return html`
    <div class="logger-tab">
      <div class="logger-toolbar">
        <button class="btn btn-sm ${enabled ? 'btn-active' : ''}"
                onClick=${() => setEnabled(!enabled)}>
          ${enabled ? 'On' : 'Off'}
        </button>
        <button class="btn btn-sm" onClick=${() => setPaused(!paused)} disabled=${!enabled}>
          ${paused ? 'Resume' : 'Pause'}
        </button>
        <button class="btn btn-sm" onClick=${onClear}>Clear</button>
        <button class="btn btn-sm" onClick=${handleExport}>Export</button>
        <span class="logger-count">${filtered.length} entries</span>
      </div>

      <${LoggerFilters} filters=${filters} onChange=${setFilters} />

      <div class="logger-list">
        ${filtered.map(entry => html`
          <${LogEntry}
            key=${entry.id}
            entry=${entry}
            expanded=${expandedId === entry.id}
            onToggle=${() => setExpandedId(expandedId === entry.id ? null : entry.id)}
          />
        `)}
        ${filtered.length === 0 && html`
          <div class="logger-empty">No entries${entries.length > 0 ? ' matching filters' : ' yet'}</div>
        `}
      </div>
    </div>
  `;
}

function LoggerFilters({ filters, onChange }) {
  return html`
    <div class="logger-filters">
      <input
        type="text"
        class="filter-input"
        placeholder="Filter by table..."
        value=${filters.table}
        onInput=${e => onChange({ ...filters, table: e.target.value })}
      />
      <select class="filter-select"
              value=${filters.method}
              onChange=${e => onChange({ ...filters, method: e.target.value })}>
        <option value="">All methods</option>
        <option value="SELECT">SELECT</option>
        <option value="INSERT">INSERT</option>
        <option value="UPDATE">UPDATE</option>
        <option value="DELETE">DELETE</option>
      </select>
      <select class="filter-select"
              value=${filters.statusGroup}
              onChange=${e => onChange({ ...filters, statusGroup: e.target.value })}>
        <option value="">All status</option>
        <option value="2xx">2xx</option>
        <option value="4xx">4xx</option>
        <option value="5xx">5xx</option>
      </select>
    </div>
  `;
}

function LogEntry({ entry, expanded, onToggle }) {
  const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false });
  const status = entry.response?.status;
  const statusColor = !status ? 'var(--text-muted)'
    : status < 300 ? 'var(--safe)'
    : status < 500 ? 'var(--warning)'
    : 'var(--danger)';

  return html`
    <div class="log-entry ${expanded ? 'expanded' : ''}" onClick=${onToggle}>
      <div class="log-entry-summary">
        <span class="log-time">${time}</span>
        <span class="log-method method-${entry.method?.toLowerCase()}">${entry.method}</span>
        <span class="log-table">${entry.table || '\u2014'}</span>
        <span class="log-status" style="color: ${statusColor}">
          ${status || '...'}
        </span>
        ${entry.duration != null && html`
          <span class="log-duration">${entry.duration}ms</span>
        `}
      </div>
      ${expanded && html`
        <div class="log-entry-detail">
          <div class="detail-section">
            <strong>URL</strong>
            <code>${entry.url}</code>
          </div>
          ${entry.queryParams && html`
            <div class="detail-section">
              <strong>Query Params</strong>
              <pre>${JSON.stringify(entry.queryParams, null, 2)}</pre>
            </div>
          `}
          ${entry.requestBody && html`
            <div class="detail-section">
              <strong>Request Body</strong>
              <pre>${JSON.stringify(entry.requestBody, null, 2)}</pre>
            </div>
          `}
          ${entry.response && html`
            <div class="detail-section">
              <strong>Response (${entry.response.status})</strong>
              <pre>${formatResponseBody(entry.response.body)}</pre>
            </div>
          `}
        </div>
      `}
    </div>
  `;
}
