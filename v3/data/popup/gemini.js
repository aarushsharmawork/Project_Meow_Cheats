/* Gemini view and explicit, reviewed screenshot attachments. */
self.createGeminiView = ({save, stop, target}) => {
  const el = id => document.getElementById(id);
  const button = el('gemini');
  const tools = el('gemini-tools');
  const container = el('gemini-frame-container');
  const permission = {permissions: ['declarativeNetRequestWithHostAccess']};
  let generation = 0;
  let disposed = false;
  let screenshot = null;
  let attachmentBusy = false;
  const clearPreview = () => {
    screenshot = null;
    el('gemini-preview-image').removeAttribute('src');
    el('gemini-preview').hidden = true;
  };
  const bridge = (action, values = {}) => new Promise((resolve, reject) => {
    const frame = el('gemini-frame');
    if (!frame?.contentWindow) { reject(new Error('Open Gemini first.')); return; }
    const source = frame.contentWindow;
    const id = crypto.randomUUID();
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', onReply); };
    const onReply = event => {
      if (event.source !== source || event.origin !== 'https://gemini.google.com' ||
          event.data?.channel !== 'meow-gemini-attachment-reply' || event.data.id !== id) return;
      cleanup();
      if (event.data.ok) resolve(event.data);
      else reject(new Error(event.data.error || 'Could not attach the screenshot.'));
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Gemini’s attachment helper is not ready. Wait for Gemini to load, or use ⋯ → Reload Gemini.')); }, action === 'attach' ? 15000 : 2500);
    window.addEventListener('message', onReply);
    source.postMessage({channel: 'meow-gemini-attachment', id, action, ...values}, 'https://gemini.google.com');
  });
  const request = async method => {
    const reply = await chrome.runtime.sendMessage({method});
    if (!reply?.ok) throw new Error(reply?.error || 'Could not reach MeowCheats. Reload the extension and try again.');
    return reply.result;
  };
  const visible = active => {
    document.querySelector('.app-shell').classList.toggle('gemini-open', active);
    el('panel-content').hidden = active;
    document.querySelector('.action-dock').hidden = active;
    el('gemini-view').hidden = !active;
    // Gemini's sign-in and reload tools remain available in the side panel.
    tools.hidden = false;
    tools.open = false;
    if (active) {
      for (const link of document.querySelectorAll('.utility-rail a')) link.removeAttribute('aria-current');
      button.setAttribute('aria-current', 'location');
    }
    else button.removeAttribute('aria-current');
  };
  const render = enabled => {
    tools.open = false;
    el('gemini-consent').hidden = enabled;
    container.hidden = !enabled;
    el('gemini-reload').hidden = !enabled;
    el('gemini-disable').hidden = !enabled;
    el('gemini-capture-bar').hidden = !enabled;
    el('gemini-view').classList.toggle('gemini-enabled', enabled);
    if (!enabled) clearPreview();
    if (!enabled) container.replaceChildren();
    else if (!el('gemini-frame')) {
      // Match the reference's normal website iframe and lazy, persistent load.
      // Cross-origin isolation still keeps Google's page out of the host site.
      const frame = document.createElement('iframe');
      frame.id = 'gemini-frame';
      frame.title = 'Gemini website';
      frame.allow = 'clipboard-write';
      frame.src = 'https://gemini.google.com/';
      container.append(frame);
    }
  };
  const open = async () => {
    const current = ++generation;
    button.disabled = true;
    visible(true);
    el('gemini-status').textContent = '';
    try {
      await save();
      await stop();
      const state = await request('gemini-status');
      if (current === generation && !disposed) render(state.enabled);
    }
    catch (error) { if (!disposed) el('gemini-status').textContent = error.message; }
    finally { if (!disposed) button.disabled = false; }
  };
  button.addEventListener('click', open);
  el('gemini-enable').addEventListener('click', async () => {
    const current = ++generation;
    el('gemini-enable').disabled = true;
    el('gemini-status').textContent = '';
    try {
      // Keep the permission request directly within the user click gesture.
      if (!await chrome.permissions.request(permission)) throw new Error('Permission was not granted. Gemini remains disabled.');
      const state = await request('gemini-enable');
      if (current === generation && !disposed) render(state.enabled);
    }
    catch (error) { if (!disposed) el('gemini-status').textContent = error.message; }
    finally { if (!disposed) el('gemini-enable').disabled = false; }
  });
  el('gemini-reload').addEventListener('click', () => {
    clearPreview();
    container.replaceChildren();
    el('gemini-status').textContent = '';
    render(true);
  });
  el('gemini-disable').addEventListener('click', async () => {
    ++generation;
    try {
      render((await request('gemini-disable')).enabled);
      await chrome.permissions.remove(permission);
    }
    catch (error) { el('gemini-status').textContent = error.message; }
  });
  el('gemini-signin').addEventListener('click', async () => {
    tools.open = false;
    try { await chrome.tabs.create({url: 'https://gemini.google.com/', active: true}); }
    catch (error) { el('gemini-status').textContent = error.message; }
  });
  el('gemini-capture').addEventListener('click', async () => {
    if (attachmentBusy) return;
    const current = generation;
    el('gemini-capture').disabled = true;
    el('gemini-status').textContent = '';
    try {
      const tabId = target?.();
      if (!Number.isInteger(tabId)) throw new Error('Open MeowCheats on a regular webpage to add its screenshot.');
      const reply = await chrome.runtime.sendMessage({method: 'gemini-capture', tabId});
      if (!reply?.ok) throw new Error(reply?.error || 'Screenshot capture failed.');
      if (current !== generation || disposed) return;
      screenshot = reply.result.dataUrl;
      el('gemini-preview-image').src = screenshot;
      el('gemini-preview').hidden = false;
    }
    catch (error) { if (!disposed) el('gemini-status').textContent = error.message; }
    finally { if (!disposed) el('gemini-capture').disabled = false; }
  });
  el('gemini-cancel').addEventListener('click', clearPreview);
  el('gemini-attach').addEventListener('click', async () => {
    if (!screenshot || attachmentBusy) return;
    attachmentBusy = true;
    el('gemini-attach').disabled = true;
    el('gemini-capture').disabled = true;
    el('gemini-status').textContent = 'Checking Gemini’s composer…';
    try {
      if (!(await bridge('ready')).ready) throw new Error('Gemini’s composer is still loading. Keep the preview and try again when it is ready.');
      el('gemini-status').textContent = 'Adding screenshot…';
      const image = screenshot;
      // Remove our review only once the receiving composer is ready.
      clearPreview();
      const result = await bridge('attach', {dataUrl: image});
      el('gemini-status').textContent = result.attached ? 'Screenshot added. Review it in Gemini before sending.' : result.message;
      if (result.attached) {
        const notice = el('gemini-status').textContent;
        setTimeout(() => { if (!disposed && el('gemini-status').textContent === notice) el('gemini-status').textContent = ''; }, 6000);
      }
    }
    catch (error) { if (!disposed) el('gemini-status').textContent = error.message; }
    finally {
      attachmentBusy = false;
      if (!disposed) { el('gemini-attach').disabled = false; el('gemini-capture').disabled = false; }
    }
  });
  document.addEventListener('click', event => { if (!tools.contains(event.target)) tools.open = false; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.geminiEmbedding && !changes.geminiEmbedding.newValue?.enabled && !disposed) {
      ++generation;
      render(false);
    }
  });
  window.addEventListener('pagehide', () => { disposed = true; ++generation; clearPreview(); });
  return {open, hide: () => { ++generation; clearPreview(); visible(false); }, ready: () => { button.disabled = false; }};
};
