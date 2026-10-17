const byId = id => document.getElementById(id);
byId('site-controls').open = true;
const sectionLinks = [...document.querySelectorAll('.utility-rail a[href^="#"]')];
let gemini;
const selectSection = hash => {
  if (!sectionLinks.some(link => link.hash === hash)) return;
  gemini?.hide();
  for (const link of sectionLinks) {
    if (link.hash === hash) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
};
for (const link of sectionLinks) link.addEventListener('click', () => selectSection(link.hash));
window.addEventListener('hashchange', () => selectSection(location.hash || '#typer-form'));
selectSection(location.hash);
const defaults = {text: '', preparationDelay: 3, minDelay: 110, maxDelay: 150, keepActive: true, engine: 'native', preserveFormatting: false, skipLeadingFourSpaces: true};
const controlIds = ['blockFullscreen', 'blockPointerLock', 'mousemove'];
let tabId;
let windowId;
let supported = false;
let busy = false;
let running = false;
let pollTimer;
let binding = 0;
let disposed = false;
let panelPort;
const connectPanelLifecycle = async () => {
  if (disposed || !Number.isInteger(windowId) || (chrome.sidePanel.onOpened && chrome.sidePanel.onClosed)) return;
  if (await chrome.tabs.getCurrent() || disposed) return;
  panelPort = chrome.runtime.connect({name: 'side-panel-lifecycle'});
  panelPort.postMessage({windowId});
  panelPort.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    if (!disposed) setTimeout(() => connectPanelLifecycle().catch(console.error), 100);
  });
};
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
  skipLeadingFourSpaces: byId('skipLeadingFourSpaces').checked,
  keepActive: true
});
const fillDraft = value => {
  // Keep explicit saved choices, including drafts from before Stable existed.
  const stable = value.skipLeadingFourSpaces ?? (value.preserveFormatting === undefined);
  value = {...defaults, ...value, skipLeadingFourSpaces: stable};
  for (const id of ['text', 'preparationDelay', 'minDelay', 'maxDelay', 'engine']) byId(id).value = value[id];
  byId('skipLeadingFourSpaces').checked = value.skipLeadingFourSpaces === true;
  byId('skipLeadingFourSpaces').disabled = value.engine !== 'native';
  byId('preserveFormatting').checked = value.preserveFormatting && !value.skipLeadingFourSpaces;
  byId('native-setup').hidden = value.engine !== 'native';
};
// Issue the storage operation immediately so closing a popup cannot drop a draft
// that was still waiting on a debounce timer. Shared views read the same draft.
const save = () => chrome.storage.local.set({typerDraft: draft()});
const buttons = () => {
  byId('start').disabled = busy || !supported || running;
  byId('stop').disabled = busy || !supported || !running;
  for (const id of ['active', ...controlIds]) byId(id).disabled = busy || !supported;
};
const renderSite = result => {
  byId('active').checked = result.active;
  byId('reload').hidden = !result.reloadRequired;
  byId('active-note').textContent = result.wildcardRemoved ? 'The matching wildcard was removed from your site list. Review More settings if needed.' : '';
  for (const id of controlIds) byId(id).checked = result.controls?.[id] === true;
  const names = {blockFullscreen: 'Fullscreen blocking', blockPointerLock: 'Cursor-lock blocking', mousemove: 'Idle mouse filtering'};
  const limited = controlIds.filter(id => result.controls?.[id] && result.controlHooks?.[id] !== 'ready');
  byId('control-note').textContent = limited.length ?
    `Limited availability: ${limited.map(id => names[id]).join(', ')}. A page or frame did not expose a replaceable browser API. Try reloading; protection is not confirmed.` : '';
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
byId('typer-form').addEventListener('input', event => {
  // These two checkboxes save together after their mutually exclusive change.
  if (['preserveFormatting', 'skipLeadingFourSpaces'].includes(event.target.id)) return;
  save().catch(e => show(e.message));
});
byId('engine').addEventListener('change', () => {
  byId('native-setup').hidden = byId('engine').value !== 'native';
  byId('skipLeadingFourSpaces').disabled = byId('engine').value !== 'native';
  save().catch(e => show(e.message));
});
for (const [chosen, other] of [['preserveFormatting', 'skipLeadingFourSpaces'], ['skipLeadingFourSpaces', 'preserveFormatting']]) {
  byId(chosen).addEventListener('change', () => {
    if (byId(chosen).checked) byId(other).checked = false;
    save().catch(e => show(e.message));
  });
}
send('setup-export').catch(error => {
  byId('native-setup-file').hidden = false;
  byId('native-setup-file').textContent = error.message;
});
for (const id of ['native-check', 'native-permission']) byId(id).addEventListener('click', async () => {
  try {
    const state = await send('native-check', {prompt: id === 'native-permission'});
    byId('native-status').textContent = state.accessibility ? 'Connected. Keyboard permission enabled.' :
      'Helper connected. Request macOS keyboard permission, enable MeowCheats Keyboard in Accessibility, then check again.';
  }
  catch (e) { byId('native-status').textContent = e.message; }
});
window.addEventListener('pagehide', () => { disposed = true; clearTimeout(pollTimer); panelPort?.disconnect(); });
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
  try { await chrome.tabs.reload(tabId); }
  catch (e) { show(e.message); }
});
byId('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
gemini = createGeminiView({save, target: () => supported ? tabId : null, stop: async () => {
  if (supported && Number.isInteger(tabId)) await send('typer-stop');
}});
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
chrome.tabs.onActivated.addListener(info => { if (info.windowId === windowId) bindTab(info.tabId); });
chrome.tabs.onUpdated.addListener((id, changes) => {
  if (id === tabId && (changes.url || changes.status === 'complete')) bindTab(id);
});
(async () => {
  try {
    const prefs = await chrome.storage.local.get({typerDraft: defaults});
    fillDraft(prefs.typerDraft);
    byId('save').disabled = false;
    gemini.ready();
    const commands = await chrome.commands.getAll();
    const shortcut = name => commands.find(command => command.name === name)?.shortcut || 'unassigned';
    byId('panel-shortcut').textContent = `Open/close side panel: ${shortcut('toggle-panel')}. Start/stop typing: ${shortcut('start-typing')}. Escape also stops typing. Change shortcuts in the browser’s extension shortcuts settings.`;
    windowId = (await chrome.windows.getCurrent()).id;
    await connectPanelLifecycle();
    const id = (await chrome.tabs.query({active: true, currentWindow: true}))[0]?.id;
    await bindTab(id, true);
  }
  catch (e) { show(e.message); }
})();
