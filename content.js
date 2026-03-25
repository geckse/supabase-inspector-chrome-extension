// Content script — runs in isolated world at document_start.
// Relays intercepted Supabase data from page-script.js to the background service worker.

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.source !== 'supabase-inspector-page') return;

  chrome.runtime.sendMessage({
    type: event.data.payload.type,
    data: event.data.payload
  });
});
