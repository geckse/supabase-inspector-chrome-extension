import { h } from '../../vendor/preact.module.js';
import { useState, useEffect } from '../../vendor/preact-hooks.module.js';
import htm from '../../vendor/htm.module.js';

const html = htm.bind(h);

function formatCellValue(value) {
  if (value === null) return html`<span class="null-value">NULL</span>`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function QueryTab({ credentials, schema }) {
  const [selectedTable, setSelectedTable] = useState('');
  const [selectedColumns, setSelectedColumns] = useState(new Set());
  const [filters, setFilters] = useState([]);
  const [orderBy, setOrderBy] = useState(null);
  const [embeds, setEmbeds] = useState([]);
  const [limit, setLimit] = useState(50);
  const [rawMode, setRawMode] = useState(false);
  const [rawQuery, setRawQuery] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const tables = schema?.tables || [];
  const tableInfo = tables.find(t => t.name === selectedTable);
  const columns = tableInfo?.columns || [];

  useEffect(() => {
    setSelectedColumns(new Set());
    setFilters([]);
    setOrderBy(null);
    setEmbeds([]);
    setResult(null);
    setError(null);
  }, [selectedTable]);

  function buildQueryString() {
    if (!selectedTable) return '';

    const params = new URLSearchParams();

    let selectParts = [];
    if (selectedColumns.size > 0) {
      selectParts = [...selectedColumns];
    } else {
      selectParts = ['*'];
    }

    for (const embed of embeds) {
      const embedCols = embed.columns.length > 0 ? embed.columns.join(',') : '*';
      selectParts.push(`${embed.table}(${embedCols})`);
    }

    params.set('select', selectParts.join(','));

    for (const f of filters) {
      if (f.column && f.operator && f.value !== '') {
        params.set(f.column, `${f.operator}.${f.value}`);
      }
    }

    if (orderBy?.column) {
      params.set('order', `${orderBy.column}.${orderBy.direction || 'asc'}`);
    }

    params.set('limit', String(limit));

    return `${selectedTable}?${params.toString()}`;
  }

  useEffect(() => {
    if (!rawMode) {
      setRawQuery(buildQueryString());
    }
  }, [selectedTable, selectedColumns, filters, orderBy, embeds, limit]);

  async function execute() {
    setLoading(true);
    setError(null);
    setResult(null);

    const queryStr = rawMode ? rawQuery : buildQueryString();
    if (!queryStr) {
      setError('Select a table first');
      setLoading(false);
      return;
    }

    const [table, paramStr] = queryStr.split('?');

    try {
      const url = `${credentials.projectUrl}/rest/v1/${table}?${paramStr || ''}`;
      const res = await fetch(url, {
        headers: {
          'apikey': credentials.apikey,
          'Authorization': `Bearer ${credentials.jwt}`,
          'Prefer': 'count=exact'
        }
      });

      const contentRange = res.headers.get('content-range');
      const count = contentRange ? parseInt(contentRange.split('/')[1]) : null;
      const data = await res.json();

      if (res.ok) {
        setResult({
          data: Array.isArray(data) ? data : [data],
          count,
          status: res.status
        });
      } else {
        setError(data.message || data.hint || `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(err.message);
    }

    setLoading(false);
  }

  function generateCurl() {
    const queryStr = rawMode ? rawQuery : buildQueryString();
    const [table, params] = queryStr.split('?');
    return `curl '${credentials.projectUrl}/rest/v1/${table}?${params || ''}' \\
  -H 'apikey: ${credentials.apikey}' \\
  -H 'Authorization: Bearer ${credentials.jwt}'`;
  }

  function generateFetch() {
    const queryStr = rawMode ? rawQuery : buildQueryString();
    const [table, params] = queryStr.split('?');
    return `const response = await fetch(
  '${credentials.projectUrl}/rest/v1/${table}?${params || ''}',
  {
    headers: {
      'apikey': '${credentials.apikey}',
      'Authorization': 'Bearer ${credentials.jwt}'
    }
  }
);
const data = await response.json();`;
  }

  return html`
    <div class="query-tab">
      <div class="query-mode-toggle">
        <button class="btn btn-sm ${!rawMode ? 'btn-active' : ''}"
                onClick=${() => setRawMode(false)}>Visual</button>
        <button class="btn btn-sm ${rawMode ? 'btn-active' : ''}"
                onClick=${() => { setRawMode(true); setRawQuery(buildQueryString()); }}>Raw</button>
      </div>

      ${!rawMode && html`
        <${VisualBuilder}
          tables=${tables}
          selectedTable=${selectedTable}
          onTableChange=${setSelectedTable}
          columns=${columns}
          selectedColumns=${selectedColumns}
          onColumnsChange=${setSelectedColumns}
          filters=${filters}
          onFiltersChange=${setFilters}
          orderBy=${orderBy}
          onOrderChange=${setOrderBy}
          embeds=${embeds}
          onEmbedsChange=${setEmbeds}
          limit=${limit}
          onLimitChange=${setLimit}
          schema=${schema}
        />
      `}

      <div class="query-raw">
        <label class="form-label">GET /rest/v1/</label>
        <input type="text" class="cell-input query-raw-input"
               value=${rawMode ? rawQuery : buildQueryString()}
               onInput=${e => rawMode && setRawQuery(e.target.value)}
               readOnly=${!rawMode}
               placeholder="table?select=*&column=eq.value" />
      </div>

      <div class="query-actions">
        <button class="btn btn-primary" onClick=${execute} disabled=${loading}>
          ${loading ? 'Executing...' : 'Execute'}
        </button>
        <button class="btn btn-sm" onClick=${() => navigator.clipboard.writeText(generateCurl())}>
          Copy curl
        </button>
        <button class="btn btn-sm" onClick=${() => navigator.clipboard.writeText(generateFetch())}>
          Copy JS
        </button>
      </div>

      ${error && html`<div class="error-msg">${error}</div>`}

      ${result && html`
        <div class="query-results">
          <div class="query-results-header">
            <span>${result.data.length} rows${result.count != null ? ` of ${result.count}` : ''}</span>
            <span class="rpc-result-status">${result.status}</span>
          </div>
          <div class="table-grid-scroll">
            <${ResultTable} data=${result.data} />
          </div>
        </div>
      `}
    </div>
  `;
}

function VisualBuilder({ tables, selectedTable, onTableChange, columns, selectedColumns,
                         onColumnsChange, filters, onFiltersChange, orderBy, onOrderChange,
                         embeds, onEmbedsChange, limit, onLimitChange, schema }) {

  const relatedTables = columns
    .filter(c => c.foreignKey)
    .map(c => c.foreignKey.table)
    .filter((v, i, a) => a.indexOf(v) === i);

  function toggleColumn(colName) {
    const next = new Set(selectedColumns);
    if (next.has(colName)) next.delete(colName);
    else next.add(colName);
    onColumnsChange(next);
  }

  function addFilter() {
    onFiltersChange([...filters, { column: columns[0]?.name || '', operator: 'eq', value: '' }]);
  }

  function updateFilter(idx, field, value) {
    const updated = filters.map((f, i) => i === idx ? { ...f, [field]: value } : f);
    onFiltersChange(updated);
  }

  function removeFilter(idx) {
    onFiltersChange(filters.filter((_, i) => i !== idx));
  }

  function addEmbed(tableName) {
    if (embeds.some(e => e.table === tableName)) return;
    onEmbedsChange([...embeds, { table: tableName, columns: [] }]);
  }

  function removeEmbed(tableName) {
    onEmbedsChange(embeds.filter(e => e.table !== tableName));
  }

  const OPERATORS = [
    { value: 'eq', label: '= equals' },
    { value: 'neq', label: '!= not equal' },
    { value: 'gt', label: '> greater than' },
    { value: 'gte', label: '>= greater or equal' },
    { value: 'lt', label: '< less than' },
    { value: 'lte', label: '<= less or equal' },
    { value: 'like', label: 'LIKE' },
    { value: 'ilike', label: 'ILIKE (case-insensitive)' },
    { value: 'is', label: 'IS (null, true, false)' },
    { value: 'in', label: 'IN (comma-separated)' },
    { value: 'cs', label: '@> contains' },
    { value: 'cd', label: '<@ contained by' },
  ];

  return html`
    <div class="visual-builder">
      <div class="builder-row">
        <label class="builder-label">Table</label>
        <select class="cell-input" value=${selectedTable}
                onChange=${e => onTableChange(e.target.value)}>
          <option value="">Select a table...</option>
          ${tables.map(t => html`<option value=${t.name}>${t.name}</option>`)}
        </select>
      </div>

      ${selectedTable && html`
        <div class="builder-row">
          <label class="builder-label">Select</label>
          <div class="column-checkboxes">
            ${columns.map(col => html`
              <label class="checkbox-label">
                <input type="checkbox"
                       checked=${selectedColumns.has(col.name)}
                       onChange=${() => toggleColumn(col.name)} />
                <span>${col.name}</span>
                <span class="form-type">${col.format || col.type}</span>
              </label>
            `)}
          </div>
          <span class="builder-hint">
            ${selectedColumns.size === 0 ? 'All columns (*)' : `${selectedColumns.size} selected`}
          </span>
        </div>

        <div class="builder-row">
          <label class="builder-label">Filter</label>
          <div class="filter-rows">
            ${filters.map((f, idx) => html`
              <div class="filter-row" key=${idx}>
                <select class="cell-input filter-col" value=${f.column}
                        onChange=${e => updateFilter(idx, 'column', e.target.value)}>
                  ${columns.map(c => html`<option value=${c.name}>${c.name}</option>`)}
                </select>
                <select class="cell-input filter-op" value=${f.operator}
                        onChange=${e => updateFilter(idx, 'operator', e.target.value)}>
                  ${OPERATORS.map(op => html`<option value=${op.value}>${op.value}</option>`)}
                </select>
                <input type="text" class="cell-input filter-val" value=${f.value}
                       onInput=${e => updateFilter(idx, 'value', e.target.value)}
                       placeholder="value" />
                <button class="btn btn-sm btn-ghost" onClick=${() => removeFilter(idx)}>\u2715</button>
              </div>
            `)}
            <button class="btn btn-sm" onClick=${addFilter}>+ Add filter</button>
          </div>
        </div>

        <div class="builder-row">
          <label class="builder-label">Order</label>
          <div class="order-row">
            <select class="cell-input" value=${orderBy?.column || ''}
                    onChange=${e => onOrderChange(e.target.value ? { column: e.target.value, direction: orderBy?.direction || 'asc' } : null)}>
              <option value="">None</option>
              ${columns.map(c => html`<option value=${c.name}>${c.name}</option>`)}
            </select>
            ${orderBy && html`
              <select class="cell-input" value=${orderBy.direction}
                      onChange=${e => onOrderChange({ ...orderBy, direction: e.target.value })}>
                <option value="asc">ASC</option>
                <option value="desc">DESC</option>
              </select>
            `}
          </div>
        </div>

        ${relatedTables.length > 0 && html`
          <div class="builder-row">
            <label class="builder-label">Join</label>
            <div class="embed-list">
              ${relatedTables.map(rt => html`
                <label class="checkbox-label">
                  <input type="checkbox"
                         checked=${embeds.some(e => e.table === rt)}
                         onChange=${() => embeds.some(e => e.table === rt) ? removeEmbed(rt) : addEmbed(rt)} />
                  <span>${rt}</span>
                </label>
              `)}
            </div>
          </div>
        `}

        <div class="builder-row">
          <label class="builder-label">Limit</label>
          <select class="cell-input" style="width: 80px" value=${limit}
                  onChange=${e => onLimitChange(Number(e.target.value))}>
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
      `}
    </div>
  `;
}

function ResultTable({ data }) {
  if (!data || data.length === 0) return html`<div class="empty-hint">No results</div>`;

  const columns = Object.keys(data[0]);

  return html`
    <table class="data-grid">
      <thead>
        <tr>
          ${columns.map(col => html`<th class="grid-header">${col}</th>`)}
        </tr>
      </thead>
      <tbody>
        ${data.map((row, i) => html`
          <tr class="grid-row ${i % 2 === 1 ? 'stripe' : ''}">
            ${columns.map(col => html`
              <td class="grid-cell">${formatCellValue(row[col])}</td>
            `)}
          </tr>
        `)}
      </tbody>
    </table>
  `;
}
