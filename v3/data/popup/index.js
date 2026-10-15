const byId = id => document.getElementById(id);
const mode = new URL(location.href).searchParams.get('mode') || 'popup';
const persistent = mode === 'side' || mode === 'overlay';
if (persistent) document.body.classList.add('persistent');
if (persistent) byId('site-controls').open = true;
const sectionLinks = [...document.querySelectorAll('.utility-rail a[href^="#"]')];
const selectSection = hash => {
  if (!sectionLinks.some(link => link.hash === hash)) return;
  for (const link of sectionLinks) {
    if (link.hash === hash) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
};
for (const link of sectionLinks) link.addEventListener('click', () => selectSection(link.hash));
window.addEventListener('hashchange', () => selectSection(location.hash || '#typer-form'));
selectSection(location.hash);
const defaults = {text: '', preparationDelay: 3, minDelay: 110, maxDelay: 150, keepActive: true, engine: 'native', preserveFormatting: true};
const controlIds = ['blockFullscreen', 'blockPointerLock', 'mousemove'];
let tabId;
let windowId;
let supported = false;
let busy = false;
let running = false;
let pollTimer;
let binding = 0;
let disposed = false;
let statusUntil = 0;
const show = message => {
  byId('status').textContent = message;
  statusUntil = Date.now() + 2500;
};
const send = async (method, values = {}) => {
  const reply = await chrome.runtime.sendMessage({method, tabId, ...values});
  if (!reply?.ok) throw new Error(reply?.error || 'Could not reach the extension. Reload it and try again.');
  return reply.result;
};
const draft = () => ({
  text: byId('text').value,
  preparationDelay: Number(byId('preparationDelay').value),
  minDelay: Number(byId('minDelay').value),
  maxDelay: Number(byId('maxDelay').value),
  engine: byId('engine').value,
  preserveFormatting: byId('preserveFormatting').checked,
  keepActive: true
});
const fillDraft = value => {
  value = {...defaults, ...value};
  for (const id of ['text', 'preparationDelay', 'minDelay', 'maxDelay', 'engine']) byId(id).value = value[id];
  byId('preserveFormatting').checked = value.preserveFormatting;
  byId('native-setup').hidden = value.engine !== 'native';
};
// Issue the storage operation immediately so closing a popup cannot drop a draft
// that was still waiting on a debounce timer. Shared views read the same draft.
const save = () => chrome.storage.local.set({typerDraft: draft()});
const buttons = () => {
  byId('start').disabled = busy || !supported || running;
  byId('stop').disabled = busy || !supported || !running;
  for (const id of ['active', 'floating-panel', ...controlIds]) byId(id).disabled = busy || !supported;
};
const renderSite = result => {
  byId('active').checked = result.active;
  byId('reload').hidden = !result.reloadRequired;
  byId('active-note').textContent = result.wildcardRemoved ? 'The matching wildcard was removed from your site list. Review More settings if needed.' : '';
  for (const id of controlIds) byId(id).checked = result.controls?.[id] === true;
};
const renderStatus = state => {
  running = ['countdown', 'starting', 'typing'].includes(state.phase);
  buttons();
  if (Date.now() < statusUntil) return;
  byId('status').textContent = state.phase === 'countdown' ? `Starting in ${Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000))} seconds. Click your target field.` :
    state.phase === 'starting' ? 'Finding the focused field…' :
    state.phase === 'typing' ? `Typing ${state.typed} of ${state.total} characters…` :
    state.message || 'Ready.';
};
const poll = async () => {
  clearTimeout(pollTimer);
  if (disposed || !supported) return;
  const current = tabId;
  try {
    const state = await send('typer-status');
    if (current === tabId) renderStatus(state);
  }
  catch (e) { if (current === tabId) show(e.message); }
  if (!disposed) pollTimer = setTimeout(poll, 500);
};
const bindTab = async (id, enableActive = false) => {
  const token = ++binding;
  supported = false;
  running = false;
  clearTimeout(pollTimer);
  tabId = id;
  buttons();
  try {
    const tab = await chrome.tabs.get(id);
    if (token !== binding) return;
    byId('site').textContent = /^https?:\/\//.test(tab.url || '') ? new URL(tab.url).hostname : 'Open a regular website to start';
    const result = await send(enableActive ? 'site-active' : 'site-state', enableActive ? {active: true} : {});
    if (token !== binding) return;
    renderSite(result);
    supported = true;
    statusUntil = 0;
    buttons();
    await poll();
  }
  catch (e) { if (token === binding) show(e.message); }
};
byId('typer-form').addEventListener('input', () => save().catch(e => show(e.message)));
byId('engine').addEventListener('change', () => {
  byId('native-setup').hidden = byId('engine').value !== 'native';
  save().catch(e => show(e.message));
});
byId('native-id').textContent = `First-time setup: double-click native/install.command in the project folder. It finds this extension and saves the setup file inside v3. Manual fallback extension ID: ${chrome.runtime.id}`;
send('setup-export').then(result => {
  if (!result.skipped) byId('native-setup-file').textContent = `Extension ID remembered. The installer saves its setup file at ${result.filename}.`;
}).catch(error => {
  byId('native-setup-file').textContent = error.message;
});
for (const id of ['native-check', 'native-permission']) byId(id).addEventListener('click', async () => {
  try {
    const state = await send('native-check', {prompt: id === 'native-permission'});
    byId('native-status').textContent = state.accessibility ? 'Keyboard helper connected. macOS keyboard permissions are enabled.' :
      state.axTrusted === false ? 'Helper connected, but macOS denied Accessibility when Chrome launched it. Check Google Chrome and the keyboard helper in System Settings → Privacy & Security → Accessibility. If both are on after rebuilding the helper, remove the helper there and add the rebuilt app again, then check here.' :
      state.postEventAccess === false ? 'Helper connected, but macOS denied keyboard-event posting. Click Request macOS keyboard permission, follow the macOS prompt, then check again.' :
      'Helper connected, but macOS keyboard permission is unavailable. Click Request macOS keyboard permission, then check again.';
  }
  catch (e) { byId('native-status').textContent = e.message; }
});
window.addEventListener('pagehide', () => { disposed = true; clearTimeout(pollTimer); });
byId('save').addEventListener('click', async () => {
  try { await save(); show('Draft saved.'); }
  catch (e) { show(e.message); }
});
byId('active').addEventListener('change', async () => {
  const active = byId('active').checked;
  busy = true;
  buttons();
  const current = tabId;
  try {
    const result = await send('site-active', {active});
    if (current === tabId) renderSite(result);
    show(active ? 'Always active is on for this site.' : 'Always active is off for this site.');
  }
  catch (e) { if (current === tabId) await bindTab(current); show(e.message); }
  finally { busy = false; buttons(); }
});
for (const id of controlIds) byId(id).addEventListener('change', async () => {
  busy = true;
  buttons();
  const current = tabId;
  try {
    const controls = Object.fromEntries(controlIds.map(key => [key, byId(key).checked]));
    const result = await send('site-controls', {controls});
    if (current === tabId) renderSite(result);
    show(result.listenersNeedReload ? 'Saved. Reload once to filter movement listeners already registered by the page.' : 'Site controls saved.');
  }
  catch (e) { if (current === tabId) await bindTab(current); show(e.message); }
  finally { busy = false; buttons(); }
});
byId('typer-form').addEventListener('submit', async event => {
  event.preventDefault();
  const current = tabId;
  const options = draft();
  busy = true;
  buttons();
  try {
    await save();
    const state = await send('typer-start', {tabId: current, options});
    if (current === tabId) {
      statusUntil = 0;
      renderStatus(state);
    }
    if (!persistent) window.close();
  }
  catch (e) { show(e.message); }
  finally { busy = false; buttons(); }
});
byId('stop').addEventListener('click', async () => {
  const current = tabId;
  busy = true;
  buttons();
  try {
    const state = await send('typer-stop', {tabId: current});
    if (current === tabId) { renderStatus(state); show('Typing stopped.'); }
  }
  catch (e) { show(e.message); }
  finally { busy = false; buttons(); }
});
byId('reload').addEventListener('click', async () => {
  try { await chrome.tabs.reload(tabId); if (!persistent) window.close(); }
  catch (e) { show(e.message); }
});
byId('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
byId('floating-panel').hidden = mode === 'overlay';
byId('hide-panel').hidden = mode !== 'overlay';
byId('side-panel').hidden = !chrome.sidePanel?.open || mode === 'side';
byId('side-panel').addEventListener('click', () => {
  // Call directly during the click: an awaited operation can lose the user gesture.
  chrome.sidePanel.open({tabId}).then(() => { if (!persistent) window.close(); }).catch(e => show(e.message));
});
byId('floating-panel').addEventListener('click', async () => {
  try { await send('panel-show'); if (!persistent) window.close(); }
  catch (e) { show(e.message); }
});
byId('hide-panel').addEventListener('click', () => send('panel-hide').catch(e => show(e.message)));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || disposed) return;
  if (changes.typerDraft?.newValue && JSON.stringify(changes.typerDraft.newValue) !== JSON.stringify(draft())) {
    fillDraft(changes.typerDraft.newValue);
  }
  if (changes.hosts || changes.enabled || changes.siteControls) {
    // Refresh checkboxes without resetting the countdown/progress message.
    const current = tabId;
    send('site-state').then(result => { if (current === tabId) renderSite(result); }).catch(() => {});
  }
});
if (mode === 'side') {
  chrome.tabs.onActivated.addListener(info => { if (info.windowId === windowId) bindTab(info.tabId); });
}
chrome.tabs.onUpdated.addListener((id, changes) => {
  if (persistent && id === tabId && (changes.url || changes.status === 'complete')) bindTab(id);
});
(async () => {
  try {
    const prefs = await chrome.storage.local.get({typerDraft: defaults});
    fillDraft(prefs.typerDraft);
    byId('save').disabled = false;
    const commands = await chrome.commands.getAll();
    const shortcut = name => commands.find(command => command.name === name)?.shortcut || 'unassigned';
    byId('panel-shortcut').textContent = `Menu: ${shortcut('toggle-panel')}. Start saved draft: ${shortcut('start-typing')}. Escape stops typing. Change shortcuts in the browser’s extension shortcuts settings.`;
    windowId = (await chrome.windows.getCurrent()).id;
    const context = mode === 'overlay' ? await send('panel-context') : null;
    const id = context?.tabId ?? (await chrome.tabs.query({active: true, currentWindow: true}))[0]?.id;
    // The worker enables the site before opening a floating panel. Its iframe
    // may also be recreated for recovery; that must not undo a later OFF click.
    await bindTab(id, mode !== 'overlay');
  }
  catch (e) { show(e.message); }
})();
