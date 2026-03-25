import { h } from '../../vendor/preact.module.js';
import { useState, useEffect } from '../../vendor/preact-hooks.module.js';
import htm from '../../vendor/htm.module.js';

const html = htm.bind(h);

function castParam(value, type) {
  if (type === 'integer' || type === 'bigint') return parseInt(value, 10);
  if (type === 'number' || type === 'numeric' || type === 'real') return parseFloat(value);
  if (type === 'boolean') return value === 'true';
  if (type === 'json' || type === 'jsonb') {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

export function RpcTab({ credentials, schema }) {
  const [rpcs, setRpcs] = useState([]);
  const [selectedRpc, setSelectedRpc] = useState(null);
  const [params, setParams] = useState({});
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [searchFilter, setSearchFilter] = useState('');

  useEffect(() => {
    if (schema?.rpcs) {
      setRpcs(schema.rpcs);
    }
  }, [schema]);

  function selectRpc(rpc) {
    setSelectedRpc(rpc);
    setParams({});
    setResult(null);
    setError(null);
  }

  async function execute() {
    if (!selectedRpc) return;
    setLoading(true);
    setError(null);
    setResult(null);

    const body = {};
    for (const p of selectedRpc.parameters) {
      const val = params[p.name];
      if (val !== undefined && val !== '') {
        body[p.name] = castParam(val, p.type);
      }
    }

    try {
      const res = await fetch(
        `${credentials.projectUrl}/rest/v1/rpc/${selectedRpc.name}`,
        {
          method: 'POST',
          headers: {
            'apikey': credentials.apikey,
            'Authorization': `Bearer ${credentials.jwt}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(body)
        }
      );

      const data = await res.json().catch(() => null);

      if (res.ok) {
        setResult({ status: res.status, data });
      } else {
        setError({ status: res.status, message: data?.message || data?.hint || `HTTP ${res.status}`, details: data });
      }

      setHistory(prev => [{
        rpc: selectedRpc.name,
        params: body,
        status: res.status,
        timestamp: Date.now()
      }, ...prev].slice(0, 20));

    } catch (err) {
      setError({ status: 0, message: err.message });
    }

    setLoading(false);
  }

  function generateCurl() {
    const body = {};
    for (const p of selectedRpc.parameters) {
      const val = params[p.name];
      if (val !== undefined && val !== '') body[p.name] = castParam(val, p.type);
    }
    return `curl -X POST '${credentials.projectUrl}/rest/v1/rpc/${selectedRpc.name}' \\
  -H 'apikey: ${credentials.apikey}' \\
  -H 'Authorization: Bearer ${credentials.jwt}' \\
  -H 'Content-Type: application/json' \\
  -d '${JSON.stringify(body)}'`;
  }

  function generateFetch() {
    const body = {};
    for (const p of selectedRpc.parameters) {
      const val = params[p.name];
      if (val !== undefined && val !== '') body[p.name] = castParam(val, p.type);
    }
    return `const response = await fetch('${credentials.projectUrl}/rest/v1/rpc/${selectedRpc.name}', {
  method: 'POST',
  headers: {
    'apikey': '${credentials.apikey}',
    'Authorization': 'Bearer ${credentials.jwt}',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(${JSON.stringify(body, null, 2)})
});
const data = await response.json();`;
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text);
  }

  const filteredRpcs = rpcs.filter(r =>
    r.name.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return html`
    <div class="rpc-tab">
      <div class="rpc-sidebar">
        <div class="sidebar-header">Functions</div>
        <input type="text" class="filter-input sidebar-search"
               placeholder="Search..."
               value=${searchFilter}
               onInput=${e => setSearchFilter(e.target.value)} />
        ${filteredRpcs.map(rpc => html`
          <button
            class="sidebar-item ${rpc.name === selectedRpc?.name ? 'active' : ''}"
            onClick=${() => selectRpc(rpc)}
          >
            <span class="rpc-name">${rpc.name}</span>
            <span class="col-count">${rpc.parameters.length}p</span>
          </button>
        `)}
        ${filteredRpcs.length === 0 && html`
          <div class="empty-hint">${rpcs.length === 0 ? 'No RPC functions found' : 'No matches'}</div>
        `}
      </div>

      <div class="rpc-main">
        ${!selectedRpc && html`
          <div class="empty-hint">Select a function to test</div>
        `}
        ${selectedRpc && html`
          <div class="rpc-form">
            <div class="rpc-header">
              <span class="rpc-fn-name">${selectedRpc.name}</span>
              <span class="rpc-param-count">${selectedRpc.parameters.length} parameter${selectedRpc.parameters.length !== 1 ? 's' : ''}</span>
            </div>

            ${selectedRpc.parameters.length > 0 && html`
              <div class="rpc-params">
                ${selectedRpc.parameters.map(p => html`
                  <div class="form-field">
                    <label class="form-label">
                      ${p.name}
                      <span class="form-type">${p.format || p.type}</span>
                      ${p.required && html`<span class="form-required">*</span>`}
                    </label>
                    <${ParamInput}
                      param=${p}
                      value=${params[p.name] || ''}
                      onChange=${v => setParams(prev => ({ ...prev, [p.name]: v }))}
                    />
                  </div>
                `)}
              </div>
            `}

            <div class="rpc-actions">
              <button class="btn btn-primary" onClick=${execute} disabled=${loading}>
                ${loading ? 'Executing...' : 'Execute'}
              </button>
              <button class="btn btn-sm" onClick=${() => copyToClipboard(generateCurl())}
                      title="Copy as curl">
                Copy curl
              </button>
              <button class="btn btn-sm" onClick=${() => copyToClipboard(generateFetch())}
                      title="Copy as JS fetch">
                Copy JS
              </button>
            </div>

            ${error && html`
              <div class="rpc-error">
                <div class="rpc-error-status">Error ${error.status}</div>
                <div class="rpc-error-message">${error.message}</div>
                ${error.details && html`
                  <pre class="rpc-error-detail">${JSON.stringify(error.details, null, 2)}</pre>
                `}
              </div>
            `}

            ${result && html`
              <div class="rpc-result">
                <div class="rpc-result-header">
                  <span>Result</span>
                  <span class="rpc-result-status">${result.status}</span>
                </div>
                <pre class="rpc-result-body">${JSON.stringify(result.data, null, 2)}</pre>
              </div>
            `}
          </div>
        `}
      </div>
    </div>
  `;
}

function ParamInput({ param, value, onChange }) {
  if (param.type === 'boolean') {
    return html`
      <select class="cell-input" value=${value} onChange=${e => onChange(e.target.value)}>
        <option value="">\u2014 select \u2014</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    `;
  }

  if (param.type === 'integer' || param.type === 'number') {
    return html`
      <input type="number" class="cell-input"
             value=${value} onInput=${e => onChange(e.target.value)}
             placeholder=${param.required ? 'required' : 'optional'} />
    `;
  }

  if (param.format === 'json' || param.format === 'jsonb') {
    return html`
      <textarea class="cell-input cell-textarea" rows="3"
                value=${value} onInput=${e => onChange(e.target.value)}
                placeholder='{"key": "value"}' />
    `;
  }

  return html`
    <input type="text" class="cell-input"
           value=${value} onInput=${e => onChange(e.target.value)}
           placeholder=${param.required ? 'required' : 'optional'} />
  `;
}
