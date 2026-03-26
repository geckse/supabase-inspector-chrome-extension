import { h, render } from '../vendor/preact.module.js';
import { useState, useEffect, useRef } from '../vendor/preact-hooks.module.js';
import htm from '../vendor/htm.module.js';
import { Header } from './components/Header.js';
import { TabBar } from './components/TabBar.js';
import { SecurityTab } from './components/SecurityTab.js';
import { LoggerTab } from './components/LoggerTab.js';
import { TablesTab } from './components/TablesTab.js';
import { RealtimeTab } from './components/RealtimeTab.js';
import { StorageTab } from './components/StorageTab.js';
import { RpcTab } from './components/RpcTab.js';
import { AuthTab } from './components/AuthTab.js';
import { QueryTab } from './components/QueryTab.js';
import { SchemaTab } from './components/SchemaTab.js';
import { PermissionDiffTab } from './components/PermissionDiffTab.js';
import { RealtimeMonitor } from '../lib/realtime-monitor.js';
import { SupabaseRest } from '../lib/supabase-rest.js';
import { parseOpenApiSpec } from '../lib/schema-parser.js';

const html = htm.bind(h);

const TABS = [
  { id: 'security', icon: '\u{1F6E1}', label: 'Security' },
  { id: 'logger',   icon: '\u{1F50D}', label: 'Logger' },
  { id: 'tables',   icon: '\u{1F4CB}', label: 'Tables' },
  { id: 'realtime', icon: '\u26A1',     label: 'Realtime' },
  { id: 'storage',  icon: '\u{1F4E6}', label: 'Storage' },
  { id: 'rpc',      icon: '\u0192',     label: 'RPC' },
  { id: 'auth',     icon: '\u{1F464}', label: 'Auth' },
  { id: 'query',    icon: '\u25B6',     label: 'Query' },
  { id: 'schema',   icon: '\u{1F5C2}', label: 'Schema' },
  { id: 'diff',     icon: '\u2696',     label: 'Diff' },
];

function matchResponseToRequest(entries, responseData) {
  return entries.map(entry => {
    if (entry.url === responseData.url && !entry.response && entry.type === 'supabase-request') {
      return {
        ...entry,
        response: {
          status: responseData.status,
          body: responseData.body,
          timestamp: responseData.timestamp
        },
        duration: responseData.timestamp - entry.timestamp
      };
    }
    return entry;
  });
}

// Popup window mode: tab ID passed via URL param
const urlParams = new URLSearchParams(window.location.search);
const pinnedTabId = urlParams.get('tabId') ? Number(urlParams.get('tabId')) : null;

// Schema cache helpers
function schemaStorageKey(projectUrl) {
  return `schema_cache_${projectUrl.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

async function loadCachedSchema(projectUrl) {
  try {
    const key = schemaStorageKey(projectUrl);
    const result = await chrome.storage.local.get(key);
    const cached = result[key];
    if (cached?.schema?.tables && cached.timestamp) {
      if (Date.now() - cached.timestamp < 24 * 60 * 60 * 1000) {
        return cached.schema;
      }
    }
  } catch (e) {
    console.warn('[Supabase Inspector] Cache read error:', e);
  }
  return null;
}

async function saveCachedSchema(projectUrl, schemaData) {
  try {
    const key = schemaStorageKey(projectUrl);
    await chrome.storage.local.set({ [key]: { schema: schemaData, timestamp: Date.now() } });
  } catch (e) {
    console.warn('[Supabase Inspector] Cache write error:', e);
  }
}

function App() {
  const [credentials, setCredentials] = useState(null);
  const [currentTab, setCurrentTab] = useState('security');
  const [logEntries, setLogEntries] = useState([]);
  const [realtimeMonitor] = useState(() => new RealtimeMonitor());
  const [schema, setSchema] = useState(null);
  const [schemaStatus, setSchemaStatus] = useState(null);

  // Track which project we've already loaded schema for (avoid re-fetching on every poll)
  const schemaLoadedFor = useRef(null);

  // ── Credential polling ──
  useEffect(() => {
    async function loadCredentials() {
      let tabId = pinnedTabId;
      if (!tabId) {
        const tab = await chrome.runtime.sendMessage({ type: 'get-active-tab' });
        if (tab) tabId = tab.id;
      }
      if (tabId) {
        const creds = await chrome.runtime.sendMessage({ type: 'get-credentials', tabId });
        setCredentials(creds);
      }
    }

    loadCredentials();

    const listener = (message) => {
      if (message.type === 'credentials-updated') setCredentials(message.data);
      if (message.type === 'log-entry') setLogEntries(prev => [message.data, ...prev].slice(0, 500));
      if (message.type === 'log-entry-response') setLogEntries(prev => matchResponseToRequest(prev, message.data));
      if (message.type === 'realtime-connect') realtimeMonitor.handleConnect(message.data.socketId, message.data.url);
      if (message.type === 'realtime-message') realtimeMonitor.handleMessage(message.data.socketId, message.data.direction, message.data.data);
      if (message.type === 'realtime-status') realtimeMonitor.handleStatus(message.data.socketId, message.data.status);
    };
    chrome.runtime.onMessage.addListener(listener);
    const interval = setInterval(loadCredentials, 3000);

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearInterval(interval);
    };
  }, []);

  // ── Schema loading ──
  // Runs once when credentials.projectUrl changes (not on every poll cycle)
  useEffect(() => {
    if (!credentials?.projectUrl || !credentials?.apikey) return;

    const projectKey = `${credentials.projectUrl}|${credentials.apikey}`;
    if (schemaLoadedFor.current === projectKey) return;
    schemaLoadedFor.current = projectKey;

    async function loadSchema() {
      setSchemaStatus('loading');

      // 1. Try cache
      const cached = await loadCachedSchema(credentials.projectUrl);
      if (cached && cached.tables.length > 0) {
        setSchema(cached);
        setSchemaStatus('loaded');
      }

      // 2. Try OpenAPI spec (always, to get fresh data)
      const client = new SupabaseRest(credentials);
      const spec = await client.getOpenApiSpec();
      if (spec) {
        const parsed = parseOpenApiSpec(spec);
        if (parsed.tables.length > 0 || parsed.rpcs.length > 0) {
          setSchema(parsed);
          setSchemaStatus('loaded');
          saveCachedSchema(credentials.projectUrl, parsed);
          return;
        }
      }

      // 3. If spec failed and no cache, try probing tables from intercepted traffic
      if (!cached || cached.tables.length === 0) {
        setSchemaStatus('probing');
        await probeFromTraffic(client);
      }
    }

    async function probeFromTraffic(client) {
      // Extract table names from log entries
      const tableNames = new Set();
      for (const entry of logEntries) {
        if (entry.url) {
          const match = entry.url.match(/\/rest\/v1\/([^?/]+)/);
          if (match && match[1] !== 'rpc') tableNames.add(match[1]);
        }
      }

      if (tableNames.size === 0) {
        setSchemaStatus('error');
        return;
      }

      const tables = [];
      for (const name of tableNames) {
        const probed = await client.probeTable(name);
        if (probed) {
          tables.push({
            name,
            columns: probed.columns,
            primaryKey: probed.columns.find(c => c.primaryKey)?.name || null
          });
        }
      }

      if (tables.length > 0) {
        const newSchema = { tables: tables.sort((a, b) => a.name.localeCompare(b.name)), rpcs: [] };
        setSchema(newSchema);
        setSchemaStatus('loaded');
        saveCachedSchema(credentials.projectUrl, newSchema);
      } else {
        setSchemaStatus('error');
      }
    }

    loadSchema();
  }, [credentials?.projectUrl, credentials?.apikey]);

  // ── Probe new tables when discovered from traffic (only if spec was blocked) ──
  useEffect(() => {
    if (schemaStatus !== 'error' && schemaStatus !== 'probing') return;
    if (!credentials?.projectUrl || !credentials?.apikey) return;

    const tableNames = new Set();
    for (const entry of logEntries) {
      if (entry.url) {
        const match = entry.url.match(/\/rest\/v1\/([^?/]+)/);
        if (match && match[1] !== 'rpc') tableNames.add(match[1]);
      }
    }

    // Check if we have new tables not yet in schema
    const existingNames = new Set((schema?.tables || []).map(t => t.name));
    const newNames = [...tableNames].filter(n => !existingNames.has(n));
    if (newNames.length === 0) return;

    async function probeNewTables() {
      const client = new SupabaseRest(credentials);
      const newTables = [];
      for (const name of newNames) {
        const probed = await client.probeTable(name);
        if (probed) {
          newTables.push({
            name,
            columns: probed.columns,
            primaryKey: probed.columns.find(c => c.primaryKey)?.name || null
          });
        }
      }

      if (newTables.length > 0) {
        const merged = {
          tables: [...(schema?.tables || []), ...newTables].sort((a, b) => a.name.localeCompare(b.name)),
          rpcs: schema?.rpcs || []
        };
        setSchema(merged);
        setSchemaStatus('loaded');
        saveCachedSchema(credentials.projectUrl, merged);
      }
    }

    probeNewTables();
  }, [logEntries.length]);

  // ── Clear cache handler ──
  async function handleClearCache() {
    if (credentials?.projectUrl) {
      const key = schemaStorageKey(credentials.projectUrl);
      await chrome.storage.local.remove(key);
      setSchema(null);
      setSchemaStatus(null);
      schemaLoadedFor.current = null; // Allow re-fetch
    }
  }

  return html`
    <div class="app">
      <${Header} credentials=${credentials} schemaStatus=${schemaStatus} onClearCache=${handleClearCache} />
      ${credentials && html`
        <${TabBar}
          tabs=${TABS}
          activeTab=${currentTab}
          onTabChange=${setCurrentTab}
        />
      `}
      <div class="content">
        ${!credentials && html`
          <div class="empty-state">
            <p>Waiting for Supabase requests...</p>
            <p class="hint">Visit a website that uses Supabase to get started.</p>
          </div>
        `}
        ${credentials && currentTab === 'security' && html`
          <${SecurityTab} credentials=${credentials} schema=${schema} />
        `}
        ${credentials && currentTab === 'logger' && html`
          <${LoggerTab} entries=${logEntries} onClear=${() => setLogEntries([])} />
        `}
        ${credentials && currentTab === 'tables' && html`
          <${TablesTab} credentials=${credentials} schema=${schema} />
        `}
        ${credentials && currentTab === 'realtime' && html`
          <${RealtimeTab} realtimeMonitor=${realtimeMonitor} />
        `}
        ${credentials && currentTab === 'storage' && html`
          <${StorageTab} credentials=${credentials} />
        `}
        ${credentials && currentTab === 'rpc' && html`
          <${RpcTab} credentials=${credentials} schema=${schema} />
        `}
        ${credentials && currentTab === 'auth' && html`
          <${AuthTab} credentials=${credentials} />
        `}
        ${credentials && currentTab === 'query' && html`
          <${QueryTab} credentials=${credentials} schema=${schema} />
        `}
        ${credentials && currentTab === 'schema' && html`
          <${SchemaTab} schema=${schema} />
        `}
        ${credentials && currentTab === 'diff' && html`
          <${PermissionDiffTab} credentials=${credentials} schema=${schema} />
        `}
      </div>
    </div>
  `;
}

render(html`<${App} />`, document.getElementById('app'));
