import { CredentialStore } from './lib/credential-store.js';

const credentials = new CredentialStore();

// Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  credentials.delete(tabId);
});

// Clean up on navigation (credentials re-captured on next Supabase request)
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    credentials.delete(tabId);
  }
});

// Message handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (message.type) {
    case 'supabase-request': {
      const { projectUrl, apikey, jwt } = message.data.credentials || {};
      if (tabId && projectUrl) {
        credentials.set(tabId, { projectUrl, apikey, jwt });
      }
      broadcastToSidePanel('log-entry', message.data);
      break;
    }

    case 'supabase-response': {
      broadcastToSidePanel('log-entry-response', message.data);
      break;
    }

    case 'realtime-connect':
    case 'realtime-message':
    case 'realtime-status':
      broadcastToSidePanel(message.type, { ...message.data, tabId });
      break;

    case 'auth-refresh-token':
      if (tabId && credentials.has(tabId)) {
        const existing = credentials.get(tabId);
        existing.refreshToken = message.data.refreshToken;
      }
      break;

    case 'get-credentials': {
      const creds = credentials.get(message.tabId) || null;
      sendResponse(creds);
      return true;
    }

    case 'get-active-tab': {
      // Try all windows to find a real web tab with credentials
      chrome.tabs.query({}, (allTabs) => {
        // 1. Prefer the active tab in the last focused non-extension window
        const activeTabs = allTabs.filter(t => t.active && t.url && !t.url.startsWith('chrome-extension'));
        const withCreds = activeTabs.find(t => credentials.has(t.id));
        if (withCreds) { sendResponse(withCreds); return; }

        // 2. Any active non-extension tab
        const anyActive = activeTabs.find(t => !t.url.startsWith('chrome:'));
        if (anyActive) { sendResponse(anyActive); return; }

        // 3. Any tab that has credentials
        const credTabIds = [...credentials._store.keys()];
        if (credTabIds.length > 0) {
          const credTab = allTabs.find(t => t.id === credTabIds[credTabIds.length - 1]);
          if (credTab) { sendResponse(credTab); return; }
        }

        sendResponse(activeTabs[0] || null);
      });
      return true;
    }
  }
});

function broadcastToSidePanel(type, data) {
  chrome.runtime.sendMessage({ type, data }).catch(() => {
    // Side panel might not be open — ignore
  });
}

// Enable side panel availability
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
