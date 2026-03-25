document.getElementById('side-panel').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch (e) {
      openWindow();
      return;
    }
  }
  window.close();
});

document.getElementById('window').addEventListener('click', async () => {
  await openWindow();
  window.close();
});

async function openWindow() {
  // Capture the active tab BEFORE opening the new window
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = tab?.id || '';
  chrome.windows.create({
    url: chrome.runtime.getURL(`sidepanel/index.html?tabId=${tabId}`),
    type: 'popup',
    width: 420,
    height: 700
  });
}
