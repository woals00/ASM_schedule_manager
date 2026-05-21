chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'asm-worker-fetch') return undefined;

  const { url, options = {} } = message;
  if (!url) {
    sendResponse({ ok: false, error: 'Missing request URL.' });
    return false;
  }

  (async () => {
    try {
      const response = await fetch(url, options);
      const text = await response.text();

      sendResponse({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        text
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error?.message || 'Network request failed.'
      });
    }
  })();

  return true;
});
