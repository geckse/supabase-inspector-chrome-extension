import { h } from '../../vendor/preact.module.js';
import { useState, useEffect } from '../../vendor/preact-hooks.module.js';
import htm from '../../vendor/htm.module.js';
import { SupabaseRest } from '../../lib/supabase-rest.js';
import { InlineEditor } from './InlineEditor.js';
import { RowForm } from './RowForm.js';

const html = htm.bind(h);

export function TableGrid({ credentials, table, columns, primaryKey }) {
  const [rows, setRows] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [loading, setLoading] = useState(false);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  useEffect(() => {
    setPage(0);
    setSortCol(null);
    setSortDir('asc');
  }, [table]);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      const client = new SupabaseRest(credentials);
      const order = sortCol ? `${sortCol}.${sortDir}` : undefined;
      const result = await client.select(table, {
        limit: pageSize,
        offset: page * pageSize,
        order
      });
      setRows(result.data);
      if (result.count != null) setTotalCount(result.count);
      setLoading(false);
    }
    fetchData();
  }, [table, page, pageSize, sortCol, sortDir, fetchTrigger]);

  const totalPages = Math.ceil(totalCount / pageSize);

  function handleSort(colName) {
    if (sortCol === colName) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(colName);
      setSortDir('asc');
    }
    setPage(0);
  }

  async function handleCellSave(rowPkValue, colName, newValue) {
    const client = new SupabaseRest(credentials);
    const result = await client.update(table, primaryKey, rowPkValue, { [colName]: newValue });
    if (result.error) {
      return { success: false, error: result.error.message || 'Update failed' };
    }
    setRows(prev => prev.map(r =>
      r[primaryKey] === rowPkValue ? { ...r, [colName]: newValue } : r
    ));
    return { success: true };
  }

  async function handleDelete(rowPkValue) {
    const client = new SupabaseRest(credentials);
    const result = await client.delete(table, primaryKey, rowPkValue);
    if (result.error) {
      return { success: false, error: result.error.message || 'Delete failed' };
    }
    setRows(prev => prev.filter(r => r[primaryKey] !== rowPkValue));
    setTotalCount(c => c - 1);
    return { success: true };
  }

  async function handleInsert(newRow) {
    const client = new SupabaseRest(credentials);
    const result = await client.insert(table, newRow);
    if (result.error) {
      return { success: false, error: result.error.message || 'Insert failed' };
    }
    const inserted = Array.isArray(result.data) ? result.data[0] : result.data;
    setRows(prev => [inserted, ...prev]);
    setTotalCount(c => c + 1);
    return { success: true };
  }

  return html`
    <div class="table-grid-container">
      <${GridToolbar}
        table=${table}
        page=${page}
        totalPages=${totalPages}
        pageSize=${pageSize}
        totalCount=${totalCount}
        onPageChange=${setPage}
        onPageSizeChange=${(s) => { setPageSize(s); setPage(0); }}
        onInsert=${handleInsert}
        columns=${columns}
        primaryKey=${primaryKey}
        onRefresh=${() => setFetchTrigger(n => n + 1)}
      />
      <div class="table-grid-scroll">
        <table class="data-grid">
          <thead>
            <tr>
              ${columns.map(col => html`
                <th class="grid-header ${sortCol === col.name ? 'sorted' : ''}"
                    onClick=${() => handleSort(col.name)}>
                  ${col.name}
                  ${sortCol === col.name && html`
                    <span class="sort-indicator">${sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>
                  `}
                  <span class="col-type">${col.format || col.type}</span>
                </th>
              `)}
              <th class="grid-header actions-col">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${loading && html`
              <tr><td colspan=${columns.length + 1} class="grid-loading">Loading...</td></tr>
            `}
            ${!loading && rows.map((row, i) => html`
              <tr class="grid-row ${i % 2 === 1 ? 'stripe' : ''}">
                ${columns.map(col => html`
                  <${InlineEditor}
                    key="${row[primaryKey]}-${col.name}"
                    value=${row[col.name]}
                    column=${col}
                    onSave=${(newVal) => handleCellSave(row[primaryKey], col.name, newVal)}
                    disabled=${!primaryKey}
                  />
                `)}
                <td class="grid-cell actions-cell">
                  ${primaryKey && html`
                    <${DeleteButton} onDelete=${() => handleDelete(row[primaryKey])} />
                  `}
                </td>
              </tr>
            `)}
            ${!loading && rows.length === 0 && html`
              <tr><td colspan=${columns.length + 1} class="grid-empty">No data</td></tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function GridToolbar({ table, page, totalPages, pageSize, totalCount,
                       onPageChange, onPageSizeChange, onInsert, columns, primaryKey, onRefresh }) {
  const [showInsert, setShowInsert] = useState(false);

  return html`
    <div class="grid-toolbar">
      <span class="grid-table-name">${table}</span>
      <span class="grid-count">${totalCount} rows</span>

      <div class="grid-toolbar-right">
        ${primaryKey && html`
          <button class="btn btn-sm btn-primary" onClick=${() => setShowInsert(!showInsert)}>
            + Insert
          </button>
        `}
        <button class="btn btn-sm" onClick=${onRefresh}>Refresh</button>
        <select class="filter-select" value=${pageSize}
                onChange=${e => onPageSizeChange(Number(e.target.value))}>
          <option value="25">25</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
        <div class="pagination">
          <button class="btn btn-sm" disabled=${page === 0}
                  onClick=${() => onPageChange(page - 1)}>\u2039</button>
          <span class="page-info">${page + 1} / ${totalPages || 1}</span>
          <button class="btn btn-sm" disabled=${page >= totalPages - 1}
                  onClick=${() => onPageChange(page + 1)}>\u203A</button>
        </div>
      </div>

      ${showInsert && html`
        <${RowForm}
          columns=${columns}
          onSubmit=${async (row) => {
            const result = await onInsert(row);
            if (result.success) setShowInsert(false);
            return result;
          }}
          onCancel=${() => setShowInsert(false)}
        />
      `}
    </div>
  `;
}

function DeleteButton({ onDelete }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);

  async function handleConfirm() {
    const result = await onDelete();
    if (!result.success) {
      setError(result.error);
      setTimeout(() => { setError(null); setConfirming(false); }, 3000);
    }
  }

  if (error) {
    return html`<span class="cell-error">${error}</span>`;
  }

  if (confirming) {
    return html`
      <span class="delete-confirm">
        <button class="btn btn-sm btn-danger" onClick=${handleConfirm}>Confirm</button>
        <button class="btn btn-sm" onClick=${() => setConfirming(false)}>Cancel</button>
      </span>
    `;
  }

  return html`
    <button class="btn btn-sm btn-ghost" onClick=${() => setConfirming(true)} title="Delete row">
      \u2715
    </button>
  `;
}
