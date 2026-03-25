import { h } from '../../vendor/preact.module.js';
import { useState } from '../../vendor/preact-hooks.module.js';
import htm from '../../vendor/htm.module.js';
import { parseFromEdit } from './InlineEditor.js';

const html = htm.bind(h);

export function RowForm({ columns, onSubmit, onCancel }) {
  const [values, setValues] = useState({});
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const editableColumns = columns.filter(c => !c.primaryKey);

  function setValue(colName, value) {
    setValues(prev => ({ ...prev, [colName]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const row = {};
    for (const col of editableColumns) {
      const v = values[col.name];
      if (v !== undefined && v !== '') {
        row[col.name] = parseFromEdit(v, col);
      }
    }

    const result = await onSubmit(row);
    setSubmitting(false);

    if (!result.success) {
      setError(result.error);
    }
  }

  return html`
    <form class="row-form" onSubmit=${handleSubmit}>
      <div class="row-form-fields">
        ${editableColumns.map(col => html`
          <div class="form-field">
            <label class="form-label">
              ${col.name}
              <span class="form-type">${col.format || col.type}</span>
              ${!col.nullable && html`<span class="form-required">*</span>`}
            </label>
            <input type="text" class="cell-input"
                   placeholder=${col.nullable ? 'NULL' : 'required'}
                   value=${values[col.name] || ''}
                   onInput=${e => setValue(col.name, e.target.value)} />
          </div>
        `)}
      </div>
      ${error && html`<div class="cell-error">${error}</div>`}
      <div class="row-form-actions">
        <button type="submit" class="btn btn-sm btn-primary" disabled=${submitting}>
          ${submitting ? 'Inserting...' : 'Insert Row'}
        </button>
        <button type="button" class="btn btn-sm" onClick=${onCancel}>Cancel</button>
      </div>
    </form>
  `;
}
