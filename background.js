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
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        // Filter out extension pages — find a real web tab
        const webTab = tabs.find(t => t.url && !t.url.startsWith('chrome'));
        if (webTab) {
          sendResponse(webTab);
        } else {
          // Fallback: find any tab that has stored credentials
          const allTabIds = [...credentials._store.keys()];
          if (allTabIds.length > 0) {
            chrome.tabs.get(allTabIds[allTabIds.length - 1], (tab) => {
              sendResponse(tab || null);
            });
          } else {
            sendResponse(null);
          }
        }
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
