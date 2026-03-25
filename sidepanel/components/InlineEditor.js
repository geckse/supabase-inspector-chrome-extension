import { h } from '../../vendor/preact.module.js';
import { useState } from '../../vendor/preact-hooks.module.js';
import htm from '../../vendor/htm.module.js';

const html = htm.bind(h);

export function InlineEditor({ value, column, onSave, disabled }) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState(false);

  function startEdit() {
    if (disabled || column.primaryKey) return;
    setEditValue(formatForEdit(value, column));
    setEditing(true);
    setError(null);
  }

  async function save() {
    setSaving(true);
    const parsed = parseFromEdit(editValue, column);
    const result = await onSave(parsed);
    setSaving(false);

    if (result.success) {
      setEditing(false);
      setDirty(false);
    } else {
      setError(result.error);
    }
  }

  function cancel() {
    setEditing(false);
    setEditValue('');
    setError(null);
    setDirty(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      save();
    }
    if (e.key === 'Escape') cancel();
  }

  if (!editing) {
    return html`
      <td class="grid-cell ${column.primaryKey ? 'pk-cell' : ''}"
          onClick=${startEdit}
          title=${disabled ? 'No primary key \u2014 editing disabled' : 'Click to edit'}>
        <${CellDisplay} value=${value} column=${column} />
      </td>
    `;
  }

  return html`
    <td class="grid-cell cell-editing ${dirty ? 'cell-dirty' : ''}">
      <div class="cell-editor">
        <${CellInput}
          value=${editValue}
          column=${column}
          onChange=${(v) => { setEditValue(v); setDirty(true); }}
          onKeyDown=${handleKeyDown}
        />
        <div class="cell-editor-actions">
          <button class="btn btn-sm btn-primary" onClick=${save} disabled=${saving}>
            ${saving ? '...' : '\u2713'}
          </button>
          <button class="btn btn-sm" onClick=${cancel}>\u2715</button>
        </div>
        ${error && html`<div class="cell-error">${error}</div>`}
      </div>
    </td>
  `;
}

function CellDisplay({ value, column }) {
  if (value === null || value === undefined) {
    return html`<span class="null-value">NULL</span>`;
  }

  if (typeof value === 'boolean') {
    return html`<span class="bool-value">${value ? '\u2713' : '\u2717'}</span>`;
  }

  if (typeof value === 'object') {
    return html`<span class="json-value">${JSON.stringify(value)}</span>`;
  }

  return html`<span>${String(value)}</span>`;
}

function CellInput({ value, column, onChange, onKeyDown }) {
  const type = column.format || column.type;

  if (type === 'boolean' || column.type === 'boolean') {
    return html`
      <label class="bool-editor">
        <input type="checkbox"
               checked=${value === 'true' || value === true}
               onChange=${e => onChange(e.target.checked)} />
      </label>
    `;
  }

  if (column.type === 'integer' || column.type === 'number' || type === 'numeric' ||
      type === 'bigint' || type === 'real' || type === 'double precision') {
    return html`
      <input type="number" class="cell-input"
             value=${value} onChange=${e => onChange(e.target.value)}
             onKeyDown=${onKeyDown} autofocus />
    `;
  }

  if (type === 'json' || type === 'jsonb') {
    return html`
      <textarea class="cell-input cell-textarea"
                value=${value}
                onInput=${e => onChange(e.target.value)}
                onKeyDown=${onKeyDown}
                rows="4" />
    `;
  }

  if (type === 'timestamp with time zone' || type === 'timestamp without time zone' || type === 'timestamp') {
    return html`
      <input type="datetime-local" class="cell-input"
             value=${value} onChange=${e => onChange(e.target.value)}
             onKeyDown=${onKeyDown} autofocus />
    `;
  }

  if (column.enum) {
    return html`
      <select class="cell-input" value=${value}
              onChange=${e => onChange(e.target.value)} autofocus>
        ${column.enum.map(v => html`<option value=${v}>${v}</option>`)}
      </select>
    `;
  }

  return html`
    <input type="text" class="cell-input"
           value=${value} onInput=${e => onChange(e.target.value)}
           onKeyDown=${onKeyDown} autofocus />
  `;
}

function formatForEdit(value, column) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

export function parseFromEdit(value, column) {
  if (value === '') return null;

  const type = column.format || column.type;

  if (column.type === 'boolean' || type === 'boolean') {
    return value === true || value === 'true';
  }

  if (column.type === 'integer' || type === 'bigint') {
    return parseInt(value, 10);
  }

  if (column.type === 'number' || type === 'numeric' || type === 'real' || type === 'double precision') {
    return parseFloat(value);
  }

  if (type === 'json' || type === 'jsonb') {
    try { return JSON.parse(value); }
    catch { return value; }
  }

  return value;
}
