import { h, render } from '../vendor/preact.module.js';
import { useState, useEffect } from '../vendor/preact-hooks.module.js';
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

// Check if a pinned tabId was passed via URL (popup window mode)
const urlParams = new URLSearchParams(window.location.search);
const pinnedTabId = urlParams.get('tabId') ? Number(urlParams.get('tabId')) : null;

function App() {
  const [credentials, setCredentials] = useState(null);
  const [currentTab, setCurrentTab] = useState('security');
  const [logEntries, setLogEntries] = useState([]);
  const [realtimeMonitor] = useState(() => new RealtimeMonitor());
  const [schema, setSchema] = useState(null);
  const [sourceTabId, setSourceTabId] = useState(pinnedTabId);

  useEffect(() => {
    async function loadCredentials() {
      let tabId = sourceTabId;

      // If no pinned tab, discover the active tab
      if (!tabId) {
        const tab = await chrome.runtime.sendMessage({ type: 'get-active-tab' });
        if (tab) {
          tabId = tab.id;
          setSourceTabId(tabId);
        }
      }

      if (tabId) {
        const creds = await chrome.runtime.sendMessage({
          type: 'get-credentials',
          tabId
        });
        setCredentials(creds);
      }
    }

    loadCredentials();

    const listener = (message) => {
      if (message.type === 'credentials-updated') {
        setCredentials(message.data);
      }
      if (message.type === 'log-entry') {
        setLogEntries(prev => [message.data, ...prev].slice(0, 500));
      }
      if (message.type === 'log-entry-response') {
        setLogEntries(prev => matchResponseToRequest(prev, message.data));
      }
      if (message.type === 'realtime-connect') {
        realtimeMonitor.handleConnect(message.data.socketId, message.data.url);
      }
      if (message.type === 'realtime-message') {
        realtimeMonitor.handleMessage(message.data.socketId, message.data.direction, message.data.data);
      }
      if (message.type === 'realtime-status') {
        realtimeMonitor.handleStatus(message.data.socketId, message.data.status);
      }
    };
    chrome.runtime.onMessage.addListener(listener);

    const interval = setInterval(loadCredentials, 3000);

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearInterval(interval);
    };
  }, []);

  // Load schema when credentials become available
  useEffect(() => {
    if (!credentials?.projectUrl) return;
    async function loadSchema() {
      const client = new SupabaseRest(credentials);
      const spec = await client.getOpenApiSpec();
      if (spec) setSchema(parseOpenApiSpec(spec));
    }
    loadSchema();
  }, [credentials?.projectUrl, credentials?.jwt]);

  return html`
    <div class="app">
      <${Header} credentials=${credentials} />
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
          <${SecurityTab} credentials=${credentials} />
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
