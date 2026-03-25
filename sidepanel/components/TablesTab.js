import { h } from '../../vendor/preact.module.js';
import { useState, useEffect } from '../../vendor/preact-hooks.module.js';
import htm from '../../vendor/htm.module.js';
import { TableGrid } from './TableGrid.js';

const html = htm.bind(h);

export function TablesTab({ credentials, schema }) {
  const [selectedTable, setSelectedTable] = useState(null);

  // Auto-select first table when schema loads
  useEffect(() => {
    if (schema?.tables?.length > 0 && !selectedTable) {
      setSelectedTable(schema.tables[0].name);
    }
  }, [schema]);

  const loading = !schema;
  const error = null;

  const tableInfo = schema?.tables.find(t => t.name === selectedTable) || null;

  return html`
    <div class="tables-tab">
      <div class="tables-sidebar">
        <div class="sidebar-header">Tables</div>
        ${schema?.tables.map(t => html`
          <button
            class="sidebar-item ${t.name === selectedTable ? 'active' : ''}"
            onClick=${() => setSelectedTable(t.name)}
          >
            ${t.name}
            <span class="col-count">${t.columns.length}</span>
          </button>
        `)}
      </div>
      <div class="tables-main">
        ${loading && html`<div class="loading">Loading schema...</div>`}
        ${error && html`<div class="error-msg">${error}</div>`}
        ${tableInfo && html`
          <${TableGrid}
            credentials=${credentials}
            table=${selectedTable}
            columns=${tableInfo.columns}
            primaryKey=${tableInfo.primaryKey}
          />
        `}
      </div>
    </div>
  `;
}
