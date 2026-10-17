// Old framing-only consent does not authorize the new reference-based rule.
chrome.storage.local.remove('geminiEmbedEnabled').catch(console.error);

const log = (...args) => chrome.storage.local.get({
  log: false
}, prefs => prefs.log && console.log(...args));

const i18n = (...args) => chrome.i18n.getMessage(...args) || '';

const COLORS = {
  on: [27, 94, 32, 255],
  off: [176, 24, 24, 255]
};

/* preference mirror: set-icon paints are synchronous, no storage read needed */
let badge = true;
chrome.storage.local.get({badge: true}, prefs => badge = prefs.badge);

// Custom artwork may be larger or non-square. Chrome's runtime icon API needs
// valid icon-sized pixels; fit the artwork without stretching or cropping it.
const iconCache = new Map();
const setSiteIcon = async (tabId, active) => {
  const state = active ? 'active' : 'disabled';
  if (!iconCache.has(state)) {
    const images = Promise.all([16, 32, 48].map(async size => {
      const path = `data/icons/${active ? '' : 'disabled/'}${size}.png`;
      const response = await fetch(chrome.runtime.getURL(path));
      if (!response.ok) throw new Error('Could not load the extension icon.');
      const bitmap = await createImageBitmap(await response.blob());
      try {
        const canvas = new OffscreenCanvas(size, size);
        const context = canvas.getContext('2d');
        const scale = Math.min(size / bitmap.width, size / bitmap.height);
        const width = bitmap.width * scale;
        const height = bitmap.height * scale;
        context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
        return [size, context.getImageData(0, 0, size, size)];
      }
      finally { bitmap.close(); }
    })).then(Object.fromEntries);
    iconCache.set(state, images);
    images.catch(() => iconCache.delete(state));
  }
  await chrome.action.setIcon({tabId, imageData: await iconCache.get(state)});
};

const paint = (tabId, text, color, title) => {
  chrome.action.setBadgeText({tabId, text});
  if (color) {
    chrome.action.setBadgeBackgroundColor({
      tabId,
      color
    });
  }
  if (title) {
    chrome.action.setTitle({tabId, title});
  }
};

const urlHost = url => {
  try {
    return new URL(url).hostname;
  }
  catch (e) {
    return '';
  }
};

const notify = async (tabId, title, symbol = '!') => {
  tabId = tabId || (await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  }))[0]?.id;
  if (tabId) {
    paint(tabId, symbol, COLORS.off, title);
  }
};

const validate = async hosts => {
  if (hosts.length === 0) {
    return '';
  }

  let message = '';
  const validationId = 'validate-' + crypto.randomUUID();
  try {
    await chrome.scripting.registerContentScripts([{
      'matches': hosts.map(h => '*://' + h + '/*'),
      'allFrames': true,
      'matchOriginAsFallback': true,
      'runAt': 'document_start',
      'id': validationId,
      'js': ['data/inject/test.js']
    }]);
  }
  catch (e) {
    message = e.message;
  }
  try {
    await chrome.scripting.unregisterContentScripts({
      ids: [validationId]
    });
  }
  catch (e) {}

  return message;
};

/* wildcard-aware list membership: matches exact hosts, '*', and '*.' patterns
   the same way match patterns do ('*.example.com' covers example.com and
   any-depth subdomains like www.example.com, a.b.example.com) */
const matchesHost = (hostname, entry) => {
  hostname = hostname.toLowerCase();
  entry = entry.toLowerCase();
  if (entry === '*') {
    return true;
  }
  if (entry === hostname) {
    return true;
  }
  if (entry.startsWith('*.')) {
    const domain = entry.slice(2);
    return hostname === domain || hostname.endsWith('.' + domain);
  }
  return false;
};

/* inject the registered scripts into the already-open document (no reload needed);
   only runs in response to a user click */
const applyNow = async tabId => {
  // The page hooks must expose their existing settings bridge before the
  // isolated controller reconnects to it after a reload or reinjection.
  await chrome.scripting.executeScript({
    target: {tabId, allFrames: true},
    files: ['data/inject/main.js', 'data/inject/privacy.js'],
    world: 'MAIN',
    injectImmediately: true
  });
  await chrome.scripting.executeScript({
    target: {tabId, allFrames: true},
    files: ['data/inject/isolated.js'],
    world: 'ISOLATED',
    injectImmediately: true
  });
};

/* Serialize registration so quick setting changes cannot lose the final state. */
let registration = Promise.resolve();
const activate = () => {
  registration = registration.catch(() => {}).then(async () => {
    const prefs = await chrome.storage.local.get({enabled: true, hosts: [], siteControls: {}});
    const hosts = [...new Set([
      ...(prefs.enabled ? prefs.hosts : []),
      ...Object.keys(prefs.siteControls).filter(host => Object.values(prefs.siteControls[host]).some(value => value === true))
    ])];
    const existing = await chrome.scripting.getRegisteredContentScripts({ids: ['main', 'isolated']});
    if (existing.length) await chrome.scripting.unregisterContentScripts({ids: existing.map(script => script.id)});
    if (!hosts.length) return;
    const props = {allFrames: true, matchOriginAsFallback: true, runAt: 'document_start',
      matches: hosts.includes('*') ? ['*://*/*'] : hosts.map(host => '*://' + host + '/*')};
    await chrome.scripting.registerContentScripts([
      {...props, id: 'main', js: ['data/inject/main.js', 'data/inject/privacy.js'], world: 'MAIN'},
      {...props, id: 'isolated', js: ['data/inject/isolated.js'], world: 'ISOLATED'}
    ]);
  });
  return registration;
};
const refresh = () => activate().catch(e => {
  notify(undefined, 'Could not apply site settings: ' + e.message);
  console.error('[MeowCheats]', e);
});
chrome.runtime.onStartup.addListener(refresh);
chrome.runtime.onInstalled.addListener(refresh);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.badge) badge = changes.badge.newValue;
  if (changes.enabled || changes.hosts || changes.siteControls) refresh();
});
const emptyControls = {blockFullscreen: false, blockPointerLock: false, mousemove: false};
const pageControls = async tabId => {
  const tab = await chrome.tabs.get(tabId);
  const hostname = urlHost(tab.url);
  const prefs = await chrome.storage.local.get({enabled: true, hosts: [], siteControls: {}});
  return {hostname, active: prefs.enabled && prefs.hosts.some(host => matchesHost(hostname, host)),
    controls: {...emptyControls, ...prefs.siteControls[hostname]}};
};
// An isolated content script asks only for settings belonging to its own tab.
chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if (request.method !== 'page-controls' || sender.id !== chrome.runtime.id || !sender.tab) return;
  pageControls(sender.tab.id).then(result => respond({ok: true, result})).catch(e => respond({ok: false, error: e.message}));
  return true;
});

// Chrome opens the native side panel directly from the toolbar gesture.
chrome.sidePanel?.setPanelBehavior({openPanelOnActionClick: true}).catch(console.error);

// Session storage survives worker suspension, but is cleared when the browser
// session/extension ends. Chrome reports SIDE_PANEL context windowId as -1, so
// getContexts() alone cannot tell which window has its panel open.
const panelStateKey = windowId => `side-panel-open:${windowId}`;
const setPanelVisible = (windowId, visible) => {
  if (!Number.isInteger(windowId) || windowId < 0) return;
  const key = panelStateKey(windowId);
  (visible ? chrome.storage.session.set({[key]: true}) : chrome.storage.session.remove(key)).catch(console.error);
};
if (chrome.sidePanel.onOpened && chrome.sidePanel.onClosed) {
  chrome.sidePanel.onOpened.addListener(({windowId}) => setPanelVisible(windowId, true));
  chrome.sidePanel.onClosed.addListener(({windowId}) => setPanelVisible(windowId, false));
}
else {
  // Older Chrome lacks panel visibility events. The panel UI connects only
  // from a native panel, never when its HTML is opened in a tab for preview.
  const panelPorts = new Map();
  chrome.runtime.onConnect.addListener(port => {
    if (port.name !== 'side-panel-lifecycle' || port.sender?.id !== chrome.runtime.id ||
        port.sender.url !== chrome.runtime.getURL('data/popup/index.html?mode=side')) return;
    let windowId;
    let disconnected = false;
    port.onDisconnect.addListener(() => {
      disconnected = true;
      if (panelPorts.get(windowId) !== port) return;
      panelPorts.delete(windowId);
      setPanelVisible(windowId, false);
    });
    port.onMessage.addListener(message => {
      if (disconnected || !Number.isInteger(message.windowId) || windowId !== undefined) return;
      windowId = message.windowId;
      panelPorts.set(windowId, port);
      setPanelVisible(windowId, true);
    });
  });
}
chrome.windows.onRemoved.addListener(windowId => setPanelVisible(windowId, false));

/* Shared by panel views and shortcuts. Never reload unsaved text. */
const siteState = async tabId => {
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:\/\//.test(tab.url || '')) throw new Error('Open a regular HTTP or HTTPS website to use these controls.');
  const hostname = urlHost(tab.url);
  const prefs = await chrome.storage.local.get({hosts: [], enabled: true, siteControls: {}});
  const frames = await chrome.scripting.executeScript({
    target: {tabId, allFrames: true}, world: 'ISOLATED',
    func: () => {
      const extensionOwned = /^(chrome|moz)-extension:$/.test(location.protocol) ||
        [...(location.ancestorOrigins || [])].some(origin => /^(chrome|moz)-extension:\/\//.test(origin));
      const port = document.getElementById('lwys-ctv-port');
      let controlHooks;
      try { controlHooks = JSON.parse(port?.dataset.controlHooks || 'null'); }
      catch (e) { controlHooks = null; }
      return {hostname: !extensionOwned && /^https?:$/.test(location.protocol) ? location.hostname : '',
        protected: self.PROTECTED === true && !!port, controlHooks};
    }
  });
  const top = frames.find(f => f.frameId === 0)?.result;
  return {hostname, active: prefs.enabled && prefs.hosts.some(h => matchesHost(hostname, h)),
    protected: top?.protected === true, hosts: prefs.hosts,
    controls: {...emptyControls, ...prefs.siteControls[hostname]},
    controlHooks: Object.fromEntries(Object.keys(emptyControls).map(key => {
      const states = frames.filter(frame => frame.result?.hostname).map(frame => frame.result.controlHooks?.[key]);
      return [key, states.length && states.every(state => state === 'ready') ? 'ready' : 'limited'];
    })),
    frameHosts: [...new Set(frames.map(f => f.result?.hostname).filter(Boolean))]};
};
let settingsQueue = Promise.resolve();
const mutateSettings = task => {
  const result = settingsQueue.catch(() => {}).then(task);
  settingsQueue = result;
  return result;
};
const setSiteActive = (tabId, active) => mutateSettings(async () => {
  await removeLegacyPanel(tabId);
  const current = await siteState(tabId);
  let hosts = current.hosts.slice();
  if (active) {
    for (const host of current.frameHosts) {
      if (!hosts.some(h => matchesHost(host, h))) hosts.push(host);
    }
  }
  else {
    hosts = hosts.filter(h => !current.frameHosts.some(host => matchesHost(host, h)));
  }
  const error = await validate(hosts);
  if (error) throw new Error(error);
  await chrome.storage.local.set({hosts, ...(active ? {enabled: true} : {})});
  await activate();
  await applyNow(tabId);
  await chrome.scripting.executeScript({target: {tabId, allFrames: true}, world: 'ISOLATED',
    func: () => self.__alwaysActiveRefresh?.()});
  // The installed hooks read live settings, so disabling takes effect immediately.
  const reloadRequired = false;
  await setSiteIcon(tabId, active);
  paint(tabId, badge ? (reloadRequired ? 'R' : active ? 'ON' : 'OFF') : '',
    active ? COLORS.on : COLORS.off,
    `MeowCheats: ${current.hostname} (${active ? 'active' : 'inactive'})`);
  return {hostname: current.hostname, active, reloadRequired, controls: current.controls,
    wildcardRemoved: !active && current.hosts.some(h => h === '*' || h.startsWith('*.')) && hosts.length !== current.hosts.length};
});
// Migration only: remove an obsolete webpage panel after a user opens/uses the
// new version. Do not reload the website or change its fullscreen state.
const removeLegacyPanel = tabId => chrome.scripting.executeScript({target: {tabId}, world: 'ISOLATED',
  func: () => {
    self.__alwaysActivePanel?.destroy?.();
    delete self.__alwaysActivePanel;
    document.getElementById('always-active-floating-panel')?.remove();
  }}).catch(() => {});

/* messaging */
chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.method === 'check') {
    log('check event from', sender.tab);
  }
  else if (request.method === 'change') {
    log('page visibility state is changed', sender.tab);
  }
  else if (request.method === 'set-icon' && sender.tab?.id) {
    pageControls(sender.tab.id).then(async ({hostname, active}) => {
      await setSiteIcon(sender.tab.id, active);
      paint(sender.tab.id, badge ? active ? 'ON' : 'OFF' : '', active ? COLORS.on : COLORS.off,
        i18n(active ? 'action_title_enabled' : 'action_title_disabled', hostname));
    }).catch(() => {});
  }
  else if (request.method === 'reload-required' || request.method === 'reload-recommended') {
    log('reload request from', sender.tab);
    if (sender.tab?.id) {
      if (request.method === 'reload-required') {
        /* paint the post-reload state before starting the reload */
        chrome.storage.local.get({badge: true}, ({badge}) => paint(
          sender.tab.id,
          badge ? 'OFF' : '',
          COLORS.off,
          i18n('action_title_disabled', request.hostname || urlHost(sender.url) || '')
        ));
      }
      chrome.tabs.reload(sender.tab.id);
    }
  }
  else if (request.method === 'validate') {
    validate(request.hosts).then(message => response(message));
    return true;
  }
});

/* operation mode (for old users) */
const mode = ({reason}) => {
  // do not offer mode selection to the new users
  if (reason !== 'update') {
    chrome.storage.local.set({
      'mode-displayed': true
    });
    return;
  }

  chrome.storage.local.get({
    'mode-displayed': false,
    'hosts': []
  }, async prefs => {
    if (prefs['mode-displayed']) {
      return;
    }
    chrome.storage.local.set({
      'mode-displayed': true
    });
    // user already know how to deal with the change
    if (prefs.hosts.length) {
      return;
    }

    const width = 600;
    const height = 300;
    const win = await chrome.windows.getCurrent();

    chrome.windows.create({
      url: '/data/guide/index.html',
      width,
      height,
      left: win.left + Math.round((win.width - width) / 2),
      top: win.top + Math.round((win.height - height) / 2),
      type: 'popup'
    });
  });
};
chrome.runtime.onInstalled.addListener(mode);

/* FAQs & Feedback */
{
  const {management, runtime: {onInstalled, setUninstallURL, getManifest}, storage, tabs} = chrome;
  if (navigator.webdriver !== true) {
    const {homepage_url: page, name, version} = getManifest();
    onInstalled.addListener(({reason, previousVersion}) => {
      management.getSelf(({installType}) => installType === 'normal' && storage.local.get({
        'faqs': true,
        'last-update': 0
      }, prefs => {
        if (reason === 'install' || (prefs.faqs && reason === 'update')) {
          const doUpdate = (Date.now() - prefs['last-update']) / 1000 / 60 / 60 / 24 > 45;
          if (doUpdate && previousVersion !== version) {
            tabs.query({active: true, lastFocusedWindow: true}, tbs => tabs.create({
              url: page + '?version=' + version + (previousVersion ? '&p=' + previousVersion : '') + '&type=' + reason,
              active: reason === 'install',
              ...(tbs && tbs.length && {index: tbs[0].index + 1})
            }));
            storage.local.set({'last-update': Date.now()});
          }
        }
      }));
    });
    setUninstallURL(page + '?rd=feedback&name=' + encodeURIComponent(name) + '&version=' + version);
  }
}

/* Auto typer: the tab owns timers, and the worker only dispatches commands. */
const typerSettings = options => {
  if (!options || typeof options.text !== 'string' || !options.text.length) throw new Error('Paste some text first.');
  if (options.text.length > 200000) throw new Error('Use at most 200,000 characters per run.');
  const {preparationDelay, minDelay, maxDelay} = options;
  if (![preparationDelay, minDelay, maxDelay].every(Number.isFinite) ||
      preparationDelay < 1 || preparationDelay > 60 || minDelay < 10 || maxDelay > 2000 || minDelay > maxDelay) {
    throw new Error('Use a start delay of 1–60 seconds and character delays of 10–2000 ms, with min no greater than max.');
  }
  const engine = options.engine ?? 'browser';
  if (!['browser', 'native'].includes(engine)) throw new Error('Choose a supported typing method.');
  if (options.preserveFormatting !== undefined && typeof options.preserveFormatting !== 'boolean') throw new Error('Preserve code formatting (Unstable) must be on or off.');
  if (options.skipLeadingFourSpaces !== undefined && typeof options.skipLeadingFourSpaces !== 'boolean') throw new Error('Preserve code formatting (Stable) must be on or off.');
  const skipLeadingFourSpaces = engine === 'native' && (options.skipLeadingFourSpaces ?? (options.preserveFormatting === undefined));
  return {text: options.text, preparationDelay, minDelay, maxDelay, engine,
    skipLeadingFourSpaces, preserveFormatting: !skipLeadingFourSpaces && options.preserveFormatting === true};
};
const controlCommand = async (tabId, command, argument) => {
  const results = await chrome.scripting.executeScript({
    target: {tabId}, world: 'ISOLATED',
    func: (command, argument) => self.__alwaysActiveTyperControl?.[command](argument),
    args: [command, argument ?? null]
  });
  return results[0]?.result;
};
const runnerCommand = async (tabId, command, frameId, options) => chrome.scripting.executeScript({
  target: frameId === undefined ? {tabId, allFrames: true} : {tabId, frameIds: [frameId]},
  world: 'MAIN',
  func: (command, options) => {
    try { return globalThis.__alwaysActiveTyper?.[command](options); }
    catch (e) { return {phase: 'error', message: e.message, typed: 0, total: 0}; }
  },
  args: [command, options ?? null]
});
const typerStatus = async tabId => {
  const countdown = await controlCommand(tabId, 'status');
  if (['countdown', 'starting', 'error'].includes(countdown?.phase)) return countdown;
  const native = nativeTyping.state(tabId);
  if (native) return native;
  const states = (await runnerCommand(tabId, 'status')).map(r => r.result).filter(Boolean)
    .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  return states.find(s => s.phase === 'typing') ||
    (countdown?.phase === 'stopped' ? countdown : states.find(s => s.phase !== 'idle')) ||
    {phase: 'idle', typed: 0, total: 0, message: 'Ready.'};
};
// Serialize commands per tab; Stop cannot race an in-flight Start or frame dispatch.
const typerQueues = new Map();
const queueTyper = (tabId, task) => {
  const previous = typerQueues.get(tabId) || Promise.resolve();
  const result = previous.catch(() => {}).then(task);
  typerQueues.set(tabId, result);
  result.finally(() => {
    if (typerQueues.get(tabId) === result) typerQueues.delete(tabId);
  }).catch(() => {});
  return result;
};
const ensureActive = async tabId => {
  await removeLegacyPanel(tabId);
  const current = await siteState(tabId);
  if (!current.active || !current.protected || current.frameHosts.some(host => !current.hosts.some(entry => matchesHost(host, entry)))) {
    await setSiteActive(tabId, true);
  }
  else {
    // A recovered typing attempt must not keep an old helper error as its
    // toolbar title/badge while the site is already active.
    paint(tabId, badge ? 'ON' : '', COLORS.on, i18n('action_title_enabled', current.hostname));
  }
};
// Both button and shortcut use the same validation, duplicate guard and countdown.
const startTyping = async (tabId, draft) => {
  const options = typerSettings(draft);
  const current = await typerStatus(tabId);
  if (['countdown', 'starting', 'typing'].includes(current.phase)) throw new Error('Typing is already running. Press Stop first.');
  await ensureActive(tabId);
  await chrome.scripting.executeScript({target: {tabId}, world: 'ISOLATED', files: ['data/typer/controller.js']});
  await runnerCommand(tabId, 'stop');
  await nativeTyping.stop(tabId);
  nativeTyping.clear(tabId);
  if (options.engine === 'native') await nativeTyping.arm(tabId);
  try { return await controlCommand(tabId, 'start', options); }
  catch (e) { await nativeTyping.stop(tabId); throw e; }
};
const stopTyping = async tabId => {
  await nativeTyping.stop(tabId);
  await controlCommand(tabId, 'stop');
  await runnerCommand(tabId, 'stop');
  return {phase: 'stopped', typed: 0, total: 0, message: 'Typing stopped.'};
};
const toggleSidePanel = async tabId => {
  // Request the pre-gesture snapshot first, then open synchronously: awaiting
  // an API response before open() loses Chrome's shortcut user gesture.
  // open() is idempotent for an already-open panel; close that panel below.
  const snapshot = chrome.storage.session.get(null);
  const window = Number.isInteger(tabId) ? chrome.tabs.get(tabId) : chrome.windows.getLastFocused();
  const opened = chrome.sidePanel.open(Number.isInteger(tabId) ? {tabId} : {windowId: chrome.windows.WINDOW_ID_CURRENT});
  const [visibility, target] = await Promise.all([snapshot, window, opened]);
  const windowId = Number.isInteger(tabId) ? target.windowId : target.id;
  if (visibility[panelStateKey(windowId)]) {
    // The manifest defines a global panel, so close the window's panel rather
    // than asking Chrome to close a nonexistent tab-specific panel.
    if (chrome.sidePanel.close) await chrome.sidePanel.close({windowId});
    else {
      // Chrome 116–140 has no close API. Disabling the global panel closes it;
      // restore its availability so the next shortcut/toolbar click can open it.
      await chrome.sidePanel.setOptions({enabled: false});
      await chrome.storage.session.remove(Object.keys(visibility).filter(key => key.startsWith('side-panel-open:')));
      await chrome.sidePanel.setOptions({enabled: true});
    }
    return;
  }
  const id = tabId ?? (await chrome.tabs.query({active: true, windowId}))[0]?.id;
  if (Number.isInteger(id) && /^https?:\/\//.test((await chrome.tabs.get(id)).url || '')) {
    await queueTyper(id, () => ensureActive(id));
  }
};
const runShortcut = (command, tabId) => {
  if (command === 'toggle-panel') return toggleSidePanel(tabId);
  return queueTyper(tabId, async () => {
    if (command !== 'start-typing') throw new Error('Unknown shortcut.');
    const current = await typerStatus(tabId);
    if (['countdown', 'starting', 'typing'].includes(current.phase) || current.interruptedByModifier) return stopTyping(tabId);
    try {
      const {typerDraft} = await chrome.storage.local.get({typerDraft: {}});
      return await startTyping(tabId, {text: '', preparationDelay: 3, minDelay: 110, maxDelay: 150, engine: 'native', ...typerDraft});
    }
    catch (e) {
      const state = await typerStatus(tabId);
      if (!['countdown', 'starting', 'typing'].includes(state.phase)) {
        await chrome.scripting.executeScript({target: {tabId}, world: 'ISOLATED', files: ['data/typer/controller.js']});
        await controlCommand(tabId, 'fail', e.message);
      }
      throw e;
    }
  });
};
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!['toggle-panel', 'start-typing'].includes(command)) return;
  let tabId = tab?.id;
  try {
    if (command === 'toggle-panel') { await runShortcut(command, tabId); return; }
    tabId ??= (await chrome.tabs.query({active: true, lastFocusedWindow: true}))[0]?.id;
    if (!Number.isInteger(tabId)) throw new Error('Open a regular website to use this shortcut.');
    await runShortcut(command, tabId);
  }
  catch (e) { notify(tabId, e.message).catch(error => console.debug('[MeowCheats]', error)); }
});
chrome.action.onClicked.addListener(tab => {
  if (!Number.isInteger(tab.id) || !/^https?:\/\//.test(tab.url || '')) return;
  queueTyper(tab.id, () => ensureActive(tab.id)).catch(error => notify(tab.id, error.message).catch(console.error));
});
chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if (!['setup-export', 'site-state', 'site-active', 'typer-start', 'typer-stop', 'typer-status', 'typer-ready', 'typer-cancel', 'native-cancel', 'native-check', 'site-controls'].includes(request.method)) return;
  // Site pages can only dispatch their own countdown; popup controls are extension-only.
  if (sender.id !== chrome.runtime.id) return;
  if (!['typer-ready', 'typer-cancel', 'native-cancel'].includes(request.method) && !/^chrome-extension:|^moz-extension:/.test(sender.url || '')) return;
  if (['typer-ready', 'typer-cancel'].includes(request.method) && (!sender.tab || sender.frameId !== 0)) return;
  if (request.method === 'setup-export') {
    keyboardSetup.save().then(result => respond({ok: true, result}), error => respond({ok: false, error: error.message}));
    return true;
  }
  const tabId = ['typer-ready', 'typer-cancel', 'native-cancel'].includes(request.method) ? sender.tab?.id : request.tabId;
  if (sender.tab && /^chrome-extension:|^moz-extension:/.test(sender.url || '') && sender.frameId > 0 && tabId !== sender.tab.id) {
    respond({ok: false, error: 'Embedded controls can only control their own tab.'});
    return;
  }
  if (!Number.isInteger(tabId)) {
    respond({ok: false, error: 'No current tab was found.'});
    return;
  }
  queueTyper(tabId, async () => {
    switch (request.method) {
      case 'site-state': return siteState(tabId);
      case 'site-controls': return mutateSettings(async () => {
        const current = await siteState(tabId);
        const controls = Object.fromEntries(Object.keys(emptyControls).map(key => [key, request.controls?.[key] === true]));
        const prefs = await chrome.storage.local.get({siteControls: {}});
        await chrome.storage.local.set({siteControls: {...prefs.siteControls, [current.hostname]: controls}});
        await activate();
        await applyNow(tabId);
        await chrome.scripting.executeScript({target: {tabId, allFrames: true}, world: 'ISOLATED',
          func: () => self.__alwaysActiveRefresh?.()});
        return {...await siteState(tabId), listenersNeedReload: controls.mousemove};
      });
      case 'site-active': return setSiteActive(tabId, request.active === true);
      case 'typer-status': return typerStatus(tabId);
      case 'native-check': return nativeTyping.check(request.prompt === true);
      case 'typer-start': return startTyping(tabId, request.options);
      case 'typer-ready': {
        const options = typerSettings(request.options);
        if (!await controlCommand(tabId, 'current', request.generation)) throw new Error('Countdown was cancelled.');
        // ISOLATED has native focus APIs, independent of the page's always-active overrides.
        const frames = await chrome.scripting.executeScript({
          target: {tabId, allFrames: true}, world: 'ISOLATED',
          func: () => {
            let element = document.activeElement;
            while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
            return document.hasFocus() && !!element && !['IFRAME', 'FRAME', 'BODY', 'HTML'].includes(element.tagName);
          }
        });
        const frame = frames.find(f => f.result === true);
        if (!frame) throw new Error('No focused field found. Start again and click a text field during the countdown.');
        if (options.engine === 'native') return nativeTyping.start(tabId, frame.frameId, options);
        await chrome.scripting.executeScript({target: {tabId, frameIds: [frame.frameId]}, world: 'MAIN', files: ['data/typer/runner.js']});
        const results = await runnerCommand(tabId, 'start', frame.frameId, options);
        const state = results[0]?.result;
        if (!state || state.phase === 'error') throw new Error(state?.message || 'Could not start in this field.');
        return state;
      }
      case 'typer-cancel':
      case 'native-cancel':
      case 'typer-stop': {
        return stopTyping(tabId);
      }
    }
  }).then(result => respond({ok: true, result})).catch(async e => {
    if (request.method === 'typer-ready') await nativeTyping.fail(tabId, e.message);
    respond({ok: false, error: e.message});
  });
  return true;
});

importScripts('data/typer/native.js', 'data/setup.js', 'data/gemini.js');
