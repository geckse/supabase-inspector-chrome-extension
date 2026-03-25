/**
 * Supabase REST client.
 *
 * All methods require credentials: { projectUrl, apikey, jwt }
 * All requests go directly to the user's Supabase instance.
 */

export class SupabaseRest {
  constructor(credentials) {
    this.baseUrl = credentials.projectUrl;
    this.apikey = credentials.apikey;
    this.jwt = credentials.jwt;
  }

  _headers(extra = {}) {
    const h = {
      'apikey': this.apikey,
      'Content-Type': 'application/json',
    };
    if (this.jwt) {
      h['Authorization'] = `Bearer ${this.jwt}`;
    }
    return { ...h, ...extra };
  }

  /**
   * GET /rest/v1/{table}?{params}
   * @param {string} table
   * @param {object} params - select, filters, order, limit, offset
   * @returns {{ data: any[], count: number|null, error: object|null, status: number }}
   */
  async select(table, { select = '*', filters = [], order, limit, offset } = {}) {
    const url = new URL(`${this.baseUrl}/rest/v1/${table}`);
    url.searchParams.set('select', select);

    for (const { column, operator, value } of filters) {
      url.searchParams.set(column, `${operator}.${value}`);
    }

    if (order) url.searchParams.set('order', order);
    if (limit != null) url.searchParams.set('limit', String(limit));
    if (offset != null) url.searchParams.set('offset', String(offset));

    const headers = this._headers({
      'Prefer': 'count=exact'
    });

    if (limit != null) {
      const start = offset || 0;
      const end = start + limit - 1;
      headers['Range'] = `${start}-${end}`;
    }

    try {
      const res = await fetch(url.toString(), { headers });
      const data = await res.json();
      const contentRange = res.headers.get('content-range');
      const count = contentRange ? parseInt(contentRange.split('/')[1]) : null;

      return {
        data: Array.isArray(data) ? data : [],
        count,
        error: res.ok ? null : data,
        status: res.status
      };
    } catch (err) {
      return { data: [], count: null, error: { message: err.message }, status: 0 };
    }
  }

  /**
   * POST /rest/v1/{table}
   */
  async insert(table, body) {
    try {
      const res = await fetch(`${this.baseUrl}/rest/v1/${table}`, {
        method: 'POST',
        headers: this._headers({ 'Prefer': 'return=representation' }),
        body: JSON.stringify(body)
      });
      const data = await res.json();
      return { data, error: res.ok ? null : data, status: res.status };
    } catch (err) {
      return { data: null, error: { message: err.message }, status: 0 };
    }
  }

  /**
   * PATCH /rest/v1/{table}?{pkColumn}=eq.{pkValue}
   */
  async update(table, pkColumn, pkValue, body) {
    const url = `${this.baseUrl}/rest/v1/${table}?${pkColumn}=eq.${pkValue}`;
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: this._headers({ 'Prefer': 'return=representation' }),
        body: JSON.stringify(body)
      });
      const data = await res.json();
      return { data, error: res.ok ? null : data, status: res.status };
    } catch (err) {
      return { data: null, error: { message: err.message }, status: 0 };
    }
  }

  /**
   * DELETE /rest/v1/{table}?{pkColumn}=eq.{pkValue}
   */
  async delete(table, pkColumn, pkValue) {
    const url = `${this.baseUrl}/rest/v1/${table}?${pkColumn}=eq.${pkValue}`;
    try {
      const res = await fetch(url, {
        method: 'DELETE',
        headers: this._headers({ 'Prefer': 'return=representation' })
      });
      const data = res.status !== 204 ? await res.json() : [];
      return { data, error: res.ok ? null : data, status: res.status };
    } catch (err) {
      return { data: null, error: { message: err.message }, status: 0 };
    }
  }

  /**
   * GET /rest/v1/ -- fetch OpenAPI spec for schema discovery
   */
  async getOpenApiSpec() {
    try {
      const res = await fetch(`${this.baseUrl}/rest/v1/`, {
        headers: this._headers()
      });
      if (!res.ok) {
        console.warn('[Supabase Inspector] OpenAPI spec fetch failed:', res.status);
        return null;
      }
      const spec = await res.json();
      console.log('[Supabase Inspector] OpenAPI spec keys:', Object.keys(spec),
        'definitions:', Object.keys(spec.definitions || {}).length,
        'components.schemas:', Object.keys(spec.components?.schemas || {}).length,
        'paths:', Object.keys(spec.paths || {}).length);
      return spec;
    } catch (err) {
      console.warn('[Supabase Inspector] OpenAPI spec error:', err.message);
      return null;
    }
  }

  /**
   * Discover table columns by fetching a single row and inspecting the shape.
   * Used as a fallback when the OpenAPI spec is not available.
   */
  async probeTable(tableName) {
    try {
      const res = await fetch(`${this.baseUrl}/rest/v1/${tableName}?select=*&limit=1`, {
        headers: this._headers({ 'Prefer': 'count=exact' })
      });
      if (!res.ok) return null;
      const data = await res.json();
      const contentRange = res.headers.get('content-range');
      const count = contentRange ? parseInt(contentRange.split('/')[1]) : null;
      if (data.length === 0) {
        return { columns: [], count: count || 0 };
      }
      // Infer columns from the first row
      const columns = Object.entries(data[0]).map(([name, value]) => ({
        name,
        type: inferType(value),
        format: inferFormat(name, value),
        nullable: true,
        primaryKey: name === 'id',
        description: null,
        maxLength: null,
        default: null,
        enum: null,
        foreignKey: null
      }));
      return { columns, count };
    } catch {
      return null;
    }
  }

  /**
   * Discover tables by probing a list of candidate names.
   * Returns table names that are accessible.
   */
  async discoverTables(candidates) {
    const found = [];
    for (const name of candidates) {
      try {
        const res = await fetch(`${this.baseUrl}/rest/v1/${name}?select=*&limit=0`, {
          headers: this._headers()
        });
        if (res.ok || res.status === 200 || res.status === 206) {
          found.push(name);
        }
      } catch {
        // skip
      }
    }
    return found;
  }
}

function inferType(value) {
  if (value === null) return 'string';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'object') return 'object';
  return 'string';
}

function inferFormat(name, value) {
  if (typeof value === 'string') {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(value)) return 'uuid';
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return 'timestamp with time zone';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
  }
  if (name.endsWith('_at') || name === 'created' || name === 'updated') return 'timestamp with time zone';
  if (name === 'id') return 'uuid';
  return null;
}
