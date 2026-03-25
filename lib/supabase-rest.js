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
      return await res.json();
    } catch (err) {
      return null;
    }
  }
}
