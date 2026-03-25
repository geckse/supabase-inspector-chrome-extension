/**
 * Logger store -- holds captured Supabase request/response pairs.
 * Max 500 entries to avoid memory bloat.
 */

const MAX_ENTRIES = 500;

export class LoggerStore {
  constructor() {
    this.entries = [];
    this.enabled = true;
    this.paused = false;
    this._listeners = new Set();
  }

  addRequest(data) {
    if (!this.enabled) return null;

    const entry = {
      id: crypto.randomUUID(),
      timestamp: data.timestamp || Date.now(),
      method: this._extractMethod(data.method, data.url),
      table: this._extractTable(data.url),
      url: data.url,
      queryParams: this._extractQueryParams(data.url),
      requestBody: data.body,
      response: null,
      duration: null
    };

    this.entries.unshift(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.pop();
    }

    this._notify();
    return entry.id;
  }

  addResponse(data) {
    if (!this.enabled) return;

    const entry = this.entries.find(e => e.url === data.url && !e.response);
    if (entry) {
      entry.response = {
        status: data.status,
        body: data.body
      };
      entry.duration = data.timestamp - entry.timestamp;
      this._notify();
    }
  }

  getFiltered({ table, method, statusGroup } = {}) {
    return this.entries.filter(entry => {
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

  clear() {
    this.entries = [];
    this._notify();
  }

  exportJSON() {
    return JSON.stringify(this.entries, null, 2);
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _notify() {
    if (!this.paused) {
      this._listeners.forEach(fn => fn(this.entries));
    }
  }

  _extractTable(url) {
    const restMatch = url.match(/\/rest\/v1\/([^?/]+)/);
    if (restMatch) return restMatch[1];

    const storageMatch = url.match(/\/storage\/v1\/object\/([^?/]+)/);
    if (storageMatch) return `storage:${storageMatch[1]}`;

    return null;
  }

  _extractMethod(httpMethod, url) {
    if (url.includes('/rest/v1/')) {
      const map = { GET: 'SELECT', POST: 'INSERT', PATCH: 'UPDATE', DELETE: 'DELETE' };
      return map[httpMethod] || httpMethod;
    }
    return httpMethod;
  }

  _extractQueryParams(url) {
    try {
      const u = new URL(url);
      const params = {};
      u.searchParams.forEach((value, key) => { params[key] = value; });
      return Object.keys(params).length > 0 ? params : null;
    } catch {
      return null;
    }
  }
}
