import { h } from '../../vendor/preact.module.js';
import { useState } from '../../vendor/preact-hooks.module.js';
import htm from '../../vendor/htm.module.js';

const html = htm.bind(h);

export function SchemaTab({ schema }) {
  const [selectedTable, setSelectedTable] = useState(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [viewMode, setViewMode] = useState('detail');

  const tables = schema?.tables || [];
  const filteredTables = tables.filter(t =>
    t.name.toLowerCase().includes(searchFilter.toLowerCase())
  );
  const tableInfo = tables.find(t => t.name === selectedTable);

  const relationships = [];
  for (const table of tables) {
    for (const col of table.columns) {
      if (col.foreignKey) {
        relationships.push({
          from: table.name,
          fromCol: col.name,
          to: col.foreignKey.table,
          toCol: col.foreignKey.column
        });
      }
    }
  }

  return html`
    <div class="schema-tab">
      <div class="schema-sidebar">
        <div class="sidebar-header">
          Tables
          <span class="col-count">${tables.length}</span>
        </div>
        <input type="text" class="filter-input sidebar-search"
               placeholder="Search..."
               value=${searchFilter}
               onInput=${e => setSearchFilter(e.target.value)} />
        ${filteredTables.map(t => html`
          <button
            class="sidebar-item ${t.name === selectedTable ? 'active' : ''}"
            onClick=${() => setSelectedTable(t.name)}
          >
            ${t.name}
            <span class="col-count">${t.columns.length}</span>
          </button>
        `)}
      </div>

      <div class="schema-main">
        <div class="schema-toolbar">
          <button class="btn btn-sm ${viewMode === 'detail' ? 'btn-active' : ''}"
                  onClick=${() => setViewMode('detail')}>Detail</button>
          <button class="btn btn-sm ${viewMode === 'diagram' ? 'btn-active' : ''}"
                  onClick=${() => setViewMode('diagram')}>Relationships</button>
        </div>

        ${viewMode === 'detail' && html`
          ${!tableInfo && html`<div class="empty-hint">Select a table to view its schema</div>`}
          ${tableInfo && html`
            <${TableDetail}
              table=${tableInfo}
              onNavigate=${(tableName) => setSelectedTable(tableName)}
            />
          `}
        `}

        ${viewMode === 'diagram' && html`
          <${RelationshipDiagram}
            tables=${tables}
            relationships=${relationships}
            selectedTable=${selectedTable}
            onSelectTable=${setSelectedTable}
          />
        `}
      </div>
    </div>
  `;
}

function TableDetail({ table, onNavigate }) {
  return html`
    <div class="table-detail">
      <h3 class="detail-title">${table.name}</h3>
      ${table.primaryKey && html`
        <div class="detail-pk">Primary key: <code>${table.primaryKey}</code></div>
      `}

      <table class="schema-grid">
        <thead>
          <tr>
            <th>Column</th>
            <th>Type</th>
            <th>Nullable</th>
            <th>Default</th>
            <th>Info</th>
          </tr>
        </thead>
        <tbody>
          ${table.columns.map(col => html`
            <tr class="schema-row ${col.primaryKey ? 'pk-row' : ''}">
              <td class="schema-col-name">
                ${col.primaryKey && html`<span class="pk-badge">PK</span>`}
                ${col.name}
              </td>
              <td class="schema-col-type">${col.format || col.type}</td>
              <td class="schema-col-null">${col.nullable ? 'yes' : 'no'}</td>
              <td class="schema-col-default">
                ${col.default ? html`<code>${col.default}</code>` : html`<span class="null-value">\u2014</span>`}
              </td>
              <td class="schema-col-info">
                ${col.foreignKey && html`
                  <span class="fk-link" onClick=${() => onNavigate(col.foreignKey.table)}>
                    \u2192 ${col.foreignKey.table}.${col.foreignKey.column}
                  </span>
                `}
                ${col.maxLength && html`<span class="constraint">max: ${col.maxLength}</span>`}
                ${col.enum && html`<span class="constraint">enum: ${col.enum.join(', ')}</span>`}
              </td>
            </tr>
          `)}
        </tbody>
      </table>
    </div>
  `;
}

function RelationshipDiagram({ tables, relationships, selectedTable, onSelectTable }) {
  const tableHasRelation = new Set();
  for (const r of relationships) {
    tableHasRelation.add(r.from);
    tableHasRelation.add(r.to);
  }

  const relevantTables = tables.filter(t => tableHasRelation.has(t.name));

  return html`
    <div class="diagram">
      ${relevantTables.length === 0 && html`
        <div class="empty-hint">No foreign key relationships found</div>
      `}

      <div class="diagram-grid">
        ${relevantTables.map(t => html`
          <div class="diagram-table ${t.name === selectedTable ? 'selected' : ''}"
               onClick=${() => onSelectTable(t.name)}>
            <div class="diagram-table-header">${t.name}</div>
            <div class="diagram-table-cols">
              ${t.columns.map(col => html`
                <div class="diagram-col ${col.primaryKey ? 'pk' : ''} ${col.foreignKey ? 'fk' : ''}">
                  ${col.primaryKey && html`<span class="pk-badge">PK</span>`}
                  ${col.foreignKey && html`<span class="fk-badge">FK</span>`}
                  <span>${col.name}</span>
                  <span class="diagram-col-type">${col.format || col.type}</span>
                </div>
              `)}
            </div>
          </div>
        `)}
      </div>

      ${relationships.length > 0 && html`
        <div class="relationship-list">
          <h4>Relationships</h4>
          ${relationships.map(r => html`
            <div class="relationship-item">
              <span class="rel-from" onClick=${() => onSelectTable(r.from)}>${r.from}</span>
              <span class="rel-col">.${r.fromCol}</span>
              <span class="rel-arrow">\u2192</span>
              <span class="rel-to" onClick=${() => onSelectTable(r.to)}>${r.to}</span>
              <span class="rel-col">.${r.toCol}</span>
            </div>
          `)}
        </div>
      `}
    </div>
  `;
}
