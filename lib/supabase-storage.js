export class SupabaseStorage {
  constructor(credentials) {
    this.baseUrl = credentials.projectUrl;
    this.apikey = credentials.apikey;
    this.jwt = credentials.jwt;
  }

  _headers(extra = {}) {
    const h = { 'apikey': this.apikey };
    if (this.jwt) h['Authorization'] = `Bearer ${this.jwt}`;
    return { ...h, ...extra };
  }

  async listBuckets() {
    try {
      const res = await fetch(`${this.baseUrl}/storage/v1/bucket`, {
        headers: this._headers()
      });
      if (!res.ok) return { data: [], error: await res.json(), status: res.status };
      return { data: await res.json(), error: null, status: res.status };
    } catch (err) {
      return { data: [], error: { message: err.message }, status: 0 };
    }
  }

  async listObjects(bucket, { prefix = '', limit = 100, offset = 0 } = {}) {
    try {
      const res = await fetch(`${this.baseUrl}/storage/v1/object/list/${bucket}`, {
        method: 'POST',
        headers: this._headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          prefix,
          limit,
          offset,
          sortBy: { column: 'name', order: 'asc' }
        })
      });
      if (!res.ok) return { data: [], error: await res.json(), status: res.status };
      return { data: await res.json(), error: null, status: res.status };
    } catch (err) {
      return { data: [], error: { message: err.message }, status: 0 };
    }
  }

  getDownloadUrl(bucket, path, isPublic) {
    const access = isPublic ? 'public' : 'authenticated';
    return `${this.baseUrl}/storage/v1/object/${access}/${bucket}/${path}`;
  }

  async downloadFile(bucket, path) {
    try {
      const res = await fetch(
        `${this.baseUrl}/storage/v1/object/authenticated/${bucket}/${path}`,
        { headers: this._headers() }
      );
      if (!res.ok) return { data: null, error: { message: `HTTP ${res.status}` }, status: res.status };
      return { data: await res.blob(), error: null, status: res.status };
    } catch (err) {
      return { data: null, error: { message: err.message }, status: 0 };
    }
  }

  async uploadFile(bucket, path, file) {
    const formData = new FormData();
    formData.append('', file);

    try {
      const res = await fetch(`${this.baseUrl}/storage/v1/object/${bucket}/${path}`, {
        method: 'POST',
        headers: this._headers(),
        body: formData
      });
      const data = await res.json();
      return { data, error: res.ok ? null : data, status: res.status };
    } catch (err) {
      return { data: null, error: { message: err.message }, status: 0 };
    }
  }

  async deleteFile(bucket, paths) {
    try {
      const res = await fetch(`${this.baseUrl}/storage/v1/object/${bucket}`, {
        method: 'DELETE',
        headers: this._headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefixes: Array.isArray(paths) ? paths : [paths] })
      });
      const data = await res.json();
      return { data, error: res.ok ? null : data, status: res.status };
    } catch (err) {
      return { data: null, error: { message: err.message }, status: 0 };
    }
  }
}
