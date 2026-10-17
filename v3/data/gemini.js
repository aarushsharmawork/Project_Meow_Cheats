/* Gemini-only adaptation of the reference's framing rule. Opt-in; never
   applied to normal tabs, Google sign-in, challenge pages or API requests. */
(() => {
  const permission = {permissions: ['declarativeNetRequestWithHostAccess']};
  const key = 'geminiEmbedding';
  const consentVersion = 1;
  const ruleId = 72001;
  let queue = Promise.resolve();
  const update = async method => {
    const allowed = await chrome.permissions.contains(permission);
    const stored = (await chrome.storage.local.get(key))[key];
    if (method === 'gemini-enable' && !allowed) throw new Error('Allow the optional Gemini permission first.');
    const enabled = allowed && (method === 'gemini-enable' ||
      (method === 'gemini-status' && stored?.enabled === true && stored?.version === consentVersion));
    if (allowed) await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [71001, ruleId],
      addRules: enabled ? [{
        id: ruleId,
        priority: 1,
        action: {type: 'modifyHeaders', responseHeaders: [
          'x-frame-options', 'content-security-policy', 'content-security-policy-report-only'
        ].map(header => ({header, operation: 'remove'}))},
        condition: {
          requestDomains: ['gemini.google.com'],
          initiatorDomains: [chrome.runtime.id],
          resourceTypes: ['sub_frame'],
          regexFilter: '^https://gemini\\.google\\.com/((u/[0-9]+/)?app([/?#]|$)|([?#]|$))'
        }
      }] : []
    });
    if (method === 'gemini-enable') await chrome.storage.local.set({[key]: {enabled: true, version: consentVersion}});
    else if (!enabled && stored) await chrome.storage.local.remove(key);
    return {enabled};
  };
  const run = method => {
    const next = queue.then(() => update(method));
    queue = next.catch(() => {});
    return next;
  };
  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (!['gemini-enable', 'gemini-disable', 'gemini-status'].includes(request?.method)) return;
    if (sender.id !== chrome.runtime.id || !/^(chrome|moz)-extension:\/\//.test(sender.url || '')) return;
    run(request.method).then(result => respond({ok: true, result}), error => respond({ok: false, error: error.message}));
    return true;
  });
  chrome.permissions.onRemoved.addListener(removed => {
    if (removed.permissions?.includes(permission.permissions[0])) run('gemini-disable').catch(console.error);
  });

  let capturing = false;
  let tabEpoch = 0;
  chrome.tabs.onActivated.addListener(() => { tabEpoch++; });
  chrome.tabs.onUpdated.addListener((id, changes) => { if (changes.url) tabEpoch++; });
  const capture = async (request, sender) => {
    const tabId = request.tabId;
    if (!Number.isInteger(tabId) || (sender.tab && sender.frameId > 0 && sender.tab.id !== tabId)) {
      throw new Error('Choose a regular webpage to capture.');
    }
    if (!(await run('gemini-status')).enabled) throw new Error('Enable Gemini before adding a screenshot.');
    const tab = await chrome.tabs.get(tabId);
    if (!tab.active || !/^https?:\/\//.test(tab.url || '')) throw new Error('Return to the webpage you want to capture.');
    const current = async () => {
      const active = (await chrome.tabs.query({active: true, windowId: tab.windowId}))[0];
      return active?.id === tabId && active.url === tab.url;
    };
    const epoch = tabEpoch;
    if (epoch !== tabEpoch || !await current()) throw new Error('The tab changed. No screenshot was shared.');
    let dataUrl;
    try { dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {format: 'png'}); }
    catch { throw new Error('Click MeowCheats’s toolbar icon on this webpage once, reopen Gemini, and try Add screenshot again.'); }
    if (epoch !== tabEpoch || !await current()) throw new Error('The tab changed. No screenshot was shared.');
    return {dataUrl};
  };
  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (request?.method !== 'gemini-capture') return;
    if (sender.id !== chrome.runtime.id || !/^(chrome|moz)-extension:\/\/[^/]+\/data\/popup\/index\.html(?:[?#]|$)/.test(sender.url || '')) return;
    if (capturing) { respond({ok: false, error: 'A screenshot is already being captured.'}); return; }
    capturing = true;
    capture(request, sender).then(result => respond({ok: true, result}), error => respond({ok: false, error: error.message}))
      .finally(() => { capturing = false; });
    return true;
  });
})();
