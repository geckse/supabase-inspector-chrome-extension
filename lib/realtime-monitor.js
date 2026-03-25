/**
 * Realtime monitor -- tracks channels, their status, and events.
 */

const MAX_EVENTS_PER_CHANNEL = 200;

export class RealtimeMonitor {
  constructor() {
    this.connections = new Map();   // socketId -> { url, status, connectedAt }
    this.channels = new Map();      // topic -> { status, filter, events[], eventCounts }
    this._listeners = new Set();
  }

  handleConnect(socketId, url) {
    this.connections.set(socketId, {
      url,
      status: 'connecting',
      connectedAt: Date.now()
    });
    this._notify();
  }

  handleStatus(socketId, status) {
    const conn = this.connections.get(socketId);
    if (conn) {
      conn.status = status;
      this._notify();
    }
  }

  handleMessage(socketId, direction, data) {
    const { topic, event, payload } = data;
    if (!topic || topic === 'phoenix') return;

    if (!this.channels.has(topic)) {
      this.channels.set(topic, {
        topic,
        status: 'unknown',
        filter: null,
        events: [],
        eventCounts: { INSERT: 0, UPDATE: 0, DELETE: 0 }
      });
    }

    const channel = this.channels.get(topic);

    if (event === 'phx_join') {
      channel.status = 'joining';
      channel.filter = payload?.config?.filter || null;
    } else if (event === 'phx_reply' && payload?.status === 'ok') {
      channel.status = 'joined';
    } else if (event === 'phx_close') {
      channel.status = 'closed';
    } else if (event === 'phx_error') {
      channel.status = 'errored';
    }

    if (['INSERT', 'UPDATE', 'DELETE'].includes(event)) {
      channel.eventCounts[event]++;

      channel.events.unshift({
        id: crypto.randomUUID(),
        event,
        payload: payload?.record || payload,
        timestamp: Date.now()
      });

      if (channel.events.length > MAX_EVENTS_PER_CHANNEL) {
        channel.events.pop();
      }
    }

    this._notify();
  }

  getChannels() {
    return Array.from(this.channels.values()).sort((a, b) => {
      const aLast = a.events[0]?.timestamp || 0;
      const bLast = b.events[0]?.timestamp || 0;
      return bLast - aLast;
    });
  }

  getEvents(topic) {
    return this.channels.get(topic)?.events || [];
  }

  clearEvents() {
    for (const channel of this.channels.values()) {
      channel.events = [];
      channel.eventCounts = { INSERT: 0, UPDATE: 0, DELETE: 0 };
    }
    this._notify();
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _notify() {
    this._listeners.forEach(fn => fn());
  }
}
