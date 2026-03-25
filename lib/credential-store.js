/**
 * Credential store — in-memory only, keyed by tabId.
 *
 * Structure per entry:
 * {
 *   projectUrl: "https://xyz.supabase.co",
 *   apikey: "eyJ...",        // anon/public key
 *   jwt: "eyJ...",           // authenticated user's JWT (if logged in)
 *   lastSeen: 1711234567890  // timestamp of last intercepted request
 * }
 */

export class CredentialStore {
  constructor() {
    this._store = new Map();
  }

  set(tabId, { projectUrl, apikey, jwt }) {
    this._store.set(tabId, {
      projectUrl,
      apikey,
      jwt: jwt || this._store.get(tabId)?.jwt, // keep existing JWT if new request doesn't have one
      lastSeen: Date.now()
    });
  }

  get(tabId) {
    return this._store.get(tabId) || null;
  }

  delete(tabId) {
    this._store.delete(tabId);
  }

  has(tabId) {
    return this._store.has(tabId);
  }
}
