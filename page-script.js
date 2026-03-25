// Main-world script — wraps fetch/XHR/WebSocket to intercept Supabase requests.
// Loaded via manifest with "world": "MAIN". Communicates with content.js via postMessage.

(function () {
  const originalFetch = window.fetch;
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  function isSupabaseRequest(url) {
    if (!url) return false;
    return url.includes('.supabase.co/rest/v1/')
        || url.includes('.supabase.co/storage/v1/')
        || url.includes('.supabase.co/auth/v1/');
  }

  function extractHeaders(init) {
    if (!init?.headers) return {};
    const h = {};
    if (init.headers instanceof Headers) {
      init.headers.forEach((value, key) => { h[key.toLowerCase()] = value; });
    } else if (Array.isArray(init.headers)) {
      init.headers.forEach(([key, value]) => { h[key.toLowerCase()] = value; });
    } else {
      Object.entries(init.headers).forEach(([key, value]) => {
        h[key.toLowerCase()] = value;
      });
    }
    return h;
  }

  function extractCredentials(url, headers) {
    const projectUrl = url.match(/(https:\/\/[^/]+\.supabase\.co)/)?.[1] || null;
    const apikey = headers['apikey'] || null;
    let jwt = headers['authorization'] || null;
    if (jwt && jwt.startsWith('Bearer ')) {
      jwt = jwt.substring(7);
    }
    return { projectUrl, apikey, jwt };
  }

  function tryParseJSON(body) {
    if (!body) return null;
    if (typeof body !== 'string') {
      try { return JSON.parse(body); } catch { return String(body); }
    }
    try { return JSON.parse(body); } catch { return body; }
  }

  function notify(data) {
    window.postMessage({
      source: 'supabase-inspector-page',
      payload: data
    }, '*');
  }

  // Wrap fetch
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    const headers = extractHeaders(init);

    if (isSupabaseRequest(url)) {
      const credentials = extractCredentials(url, headers);
      notify({
        type: 'supabase-request',
        url,
        method: init?.method || 'GET',
        headers,
        credentials,
        body: init?.body ? tryParseJSON(init.body) : null,
        timestamp: Date.now()
      });
    }

    const response = await originalFetch.apply(this, arguments);

    if (isSupabaseRequest(url)) {
      const clone = response.clone();
      clone.text().then(body => {
        notify({
          type: 'supabase-response',
          url,
          status: response.status,
          body: body.substring(0, 1024),
          timestamp: Date.now()
        });
      });
    }

    // Capture refresh tokens from auth endpoint
    if (url.includes('.supabase.co/auth/v1/token')) {
      const clone2 = response.clone();
      clone2.json().then(data => {
        if (data.refresh_token) {
          notify({
            type: 'auth-refresh-token',
            refreshToken: data.refresh_token,
            timestamp: Date.now()
          });
        }
      }).catch(() => {});
    }

    return response;
  };

  // Wrap XHR
  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    this._supabaseMethod = method;
    this._supabaseUrl = url;
    return originalXHROpen.apply(this, [method, url, ...args]);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (isSupabaseRequest(this._supabaseUrl)) {
      notify({
        type: 'supabase-request',
        url: this._supabaseUrl,
        method: this._supabaseMethod,
        body: tryParseJSON(body),
        timestamp: Date.now()
      });

      this.addEventListener('load', () => {
        notify({
          type: 'supabase-response',
          url: this._supabaseUrl,
          status: this.status,
          body: (this.responseText || '').substring(0, 1024),
          timestamp: Date.now()
        });
      });
    }
    return originalXHRSend.apply(this, arguments);
  };

  // ── WebSocket interception ──

  const OriginalWebSocket = window.WebSocket;

  window.WebSocket = function(url, protocols) {
    const ws = new OriginalWebSocket(url, protocols);

    if (!isRealtimeUrl(url)) return ws;

    const socketId = crypto.randomUUID();

    notify({
      type: 'realtime-connect',
      socketId,
      url,
      timestamp: Date.now()
    });

    ws.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data);
        notify({
          type: 'realtime-message',
          socketId,
          direction: 'incoming',
          data,
          timestamp: Date.now()
        });
      } catch {
        // Binary or non-JSON message — skip
      }
    });

    const originalSend = ws.send.bind(ws);
    ws.send = function(data) {
      try {
        const parsed = JSON.parse(data);
        notify({
          type: 'realtime-message',
          socketId,
          direction: 'outgoing',
          data: parsed,
          timestamp: Date.now()
        });
      } catch {
        // Non-JSON — skip
      }
      return originalSend(data);
    };

    ws.addEventListener('open', () => {
      notify({ type: 'realtime-status', socketId, status: 'open', timestamp: Date.now() });
    });
    ws.addEventListener('close', (e) => {
      notify({ type: 'realtime-status', socketId, status: 'closed', code: e.code, timestamp: Date.now() });
    });
    ws.addEventListener('error', () => {
      notify({ type: 'realtime-status', socketId, status: 'error', timestamp: Date.now() });
    });

    return ws;
  };

  window.WebSocket.prototype = OriginalWebSocket.prototype;
  window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  window.WebSocket.OPEN = OriginalWebSocket.OPEN;
  window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
  window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;

  function isRealtimeUrl(url) {
    return url.includes('supabase.co/realtime') || url.includes('realtime-v1.supabase.co');
  }
})();
