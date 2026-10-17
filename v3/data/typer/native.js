/* Only the extension worker connects to the OS helper. There is no page-facing key API. */
const nativeTyping = (() => {
  const host = 'com.meowtantra.keyboard';
  const runs = new Map();
  let activeRun;
  const connection = () => {
    const port = chrome.runtime.connectNative(host);
    const pending = new Map();
    let closed = false;
    let serial = 0;
    let onClose = () => {};
    const close = message => {
      if (closed) return;
      closed = true;
      for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error(message)); }
      pending.clear();
      onClose(message);
    };
    port.onMessage.addListener(reply => {
      const request = pending.get(reply.id);
      if (!request) return;
      pending.delete(reply.id);
      clearTimeout(request.timer);
      if (reply.ok) request.resolve(reply.result);
      else request.reject(new Error(reply.error || 'The keyboard helper rejected the request.'));
    });
    port.onDisconnect.addListener(() => close(chrome.runtime.lastError?.message || 'Keyboard helper disconnected.'));
    return {
      request(command, values = {}) {
        if (closed) return Promise.reject(new Error('Keyboard helper disconnected.'));
        const id = ++serial;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { close('Keyboard helper did not respond.'); port.disconnect(); }, 5000);
          pending.set(id, {resolve, reject, timer});
          try { port.postMessage({id, command, ...values}); }
          catch (e) { close(e.message); port.disconnect(); }
        });
      },
      onClose(callback) { onClose = callback; },
      disconnect() { close('Keyboard helper disconnected.'); port.disconnect(); }
    };
  };
  const guard = async (tabId, frameId, command) => {
    const results = await chrome.scripting.executeScript({target: {tabId, frameIds: [frameId]}, world: 'ISOLATED',
      func: command => {
        try { return {ok: true, value: self.__meowNativeGuard?.[command]()}; }
        catch (e) { return {ok: false, error: e.message}; }
      }, args: [command]});
    const result = results[0]?.result;
    if (result?.ok === false) throw new Error(result.error);
    return result?.value;
  };
  const formatting = async (run, command, values = {}) => {
    if (!run.preserveFormatting) return;
    const results = await chrome.scripting.executeScript({target: {tabId: run.tabId, frameIds: [run.frameId]}, world: 'MAIN',
      func: (command, values) => {
        try {
          if (!self.__meowCodeFormatting) throw new Error('Code-formatting protection could not load.');
          return {ok: true, value: self.__meowCodeFormatting[command](values)};
        }
        catch (e) { return {ok: false, error: e.message}; }
      }, args: [command, {token: run.token, ...values}]});
    const reply = results[0]?.result;
    if (!reply?.ok) throw new Error(reply?.error || 'Could not check the editor formatting.');
    return reply.value;
  };
  const release = run => {
    if (activeRun === run) activeRun = undefined;
    const pipe = run.pipe;
    run.pipe = undefined;
    pipe?.disconnect();
    if (run.frameId !== undefined) guard(run.tabId, run.frameId, 'stop').catch(() => {});
    if (run.frameId !== undefined) formatting(run, 'stop').catch(() => {});
  };
  const stop = async tabId => {
    const run = runs.get(tabId);
    if (!run || (!['armed', 'typing'].includes(run.state.phase) && !run.state.interruptedByModifier)) return;
    run.state = {...run.state, phase: 'stopped', interruptedByModifier: false, message: 'Typing stopped.'};
    release(run);
  };
  const fail = async (tabId, message) => {
    const run = runs.get(tabId);
    if (!run || !['armed', 'typing'].includes(run.state.phase)) return;
    // Command/Shift can reach the helper before Chrome dispatches Cmd+Shift+Y.
    // Remember this safety stop so that shortcut acknowledges it, rather than
    // mistaking the interrupted run for an idle session and starting again.
    run.state = {...run.state, phase: 'error', message,
      interruptedByModifier: message === 'A modifier key is held. Typing stopped to avoid triggering shortcuts.'};
    release(run);
  };
  const check = async (prompt = false) => {
    const platform = await chrome.runtime.getPlatformInfo();
    if (platform.os !== 'mac') throw new Error('OS keyboard mode currently supports macOS only.');
    const pipe = connection();
    try { return await pipe.request('check', {prompt}); }
    catch (e) { throw new Error(`${e.message} Run native/install.command, then check again.`); }
    finally { pipe.disconnect(); }
  };
  const permissionMessage = status => {
    if (status.axTrusted === false && status.postEventAccess === false)
      return 'Accessibility and keyboard-event access denied. Enable MeowCheats Keyboard and your browser in macOS Accessibility, then check again.';
    if (status.axTrusted === false)
      return 'Accessibility denied. Enable MeowCheats Keyboard and your browser in macOS Accessibility, then check again.';
    if (status.postEventAccess === false)
      return 'macOS denied keyboard-event posting. Click Request macOS keyboard permission, then check again.';
    return 'macOS keyboard permission is unavailable. Use Request macOS keyboard permission in the menu, then check again.';
  };
  const planKeys = (text, sourceIndentation, backspacesPerLevel = 1) => {
    if (!sourceIndentation) return Array.from(text, character => ({character}));
    const keys = [];
    let previousIndent;
    for (const [index, line] of text.split('\n').entries()) {
      if (index) keys.push({character: '\n'});
      const prefix = line.match(/^[ \t]*/)[0];
      const blank = line.trim().length === 0;
      // Actual tabs are retained, as before. Do not infer indentation levels
      // across mixed/tab-indented lines: their visual width is editor-specific.
      const indent = prefix.includes('\t') ? undefined : Math.floor(prefix.length / 4);
      if (index && !blank && indent !== undefined && previousIndent !== undefined) {
        for (let count = 0; count < (previousIndent - indent) * backspacesPerLevel; count++) keys.push({action: 'backspace'});
      }
      const content = index ? line.replace(/^(?: {4})+/, '') : line;
      for (const character of content) keys.push({character});
      // Blank lines often retain the editor's indent. Carry the last real
      // source line's level until the next real line, including multiple blanks.
      if (!blank) previousIndent = indent;
    }
    return keys;
  };
  const arm = async tabId => {
    if (activeRun) throw new Error('OS keyboard typing is already running in another tab. Stop it first.');
    const platform = await chrome.runtime.getPlatformInfo();
    if (platform.os !== 'mac') throw new Error('OS keyboard mode currently supports macOS only.');
    const run = {tabId, state: {phase: 'armed', typed: 0, total: 0, message: ''}};
    activeRun = run;
    runs.set(tabId, run);
    try {
      run.pipe = connection();
      run.pipe.onClose(message => { if (['armed', 'typing'].includes(run.state.phase)) fail(tabId, message); });
      const status = await run.pipe.request('check');
      run.capabilities = status.capabilities || {};
      if (status.protocol !== 3) throw new Error('Update the keyboard helper using native/build.command, then reconnect the extension.');
      if (!status.accessibility) throw new Error(permissionMessage(status));
    }
    catch (e) {
      await fail(tabId, e.message);
      if (/native messaging host|not found|disconnected/i.test(e.message))
        throw new Error(`${e.message} Run native/install.command, then check again.`);
      throw e;
    }
  };
  const start = async (tabId, frameId, options) => {
    const run = runs.get(tabId);
    if (run !== activeRun || run?.state.phase !== 'armed') throw new Error('Keyboard session expired or was cancelled. Start again.');
    const tab = await chrome.tabs.get(tabId);
    run.windowId = tab.windowId;
    run.frameId = frameId;
    await chrome.scripting.executeScript({target: {tabId, frameIds: [frameId]}, world: 'ISOLATED', files: ['data/typer/native-guard.js']});
    if (!await guard(tabId, frameId, 'start')) throw new Error('Could not lock the focused typing field.');
    const text = options.text.replace(/\r\n?/g, '\n');
    run.skipLeadingFourSpaces = options.skipLeadingFourSpaces === true;
    let backspacesPerLevel = 1;
    if (run.skipLeadingFourSpaces) {
      backspacesPerLevel = await guard(tabId, frameId, 'backspaceWidth') === 4 ? 4 : 1;
    }
    const keys = planKeys(text, run.skipLeadingFourSpaces, backspacesPerLevel);
    const corrections = keys.filter(key => key.action === 'backspace').length;
    if (corrections && run.capabilities.backspace !== true) {
      throw new Error('Update the keyboard helper for indentation correction: double-click native/install.command, then reload MeowCheats and retry. No text was sent.');
    }
    const total = keys.filter(key => key.character !== undefined).length;
    run.token = crypto.randomUUID();
    run.preserveFormatting = !run.skipLeadingFourSpaces && options.preserveFormatting !== false;
    if (run.preserveFormatting) {
      await chrome.scripting.executeScript({target: {tabId, frameIds: [frameId]}, world: 'MAIN', files: ['data/typer/code-formatting.js']});
      // If Stop wins this race, restore only this token and do not send any text.
      await formatting(run, 'start', {hasTabs: text.includes('\t')});
      if (run !== activeRun) { await formatting(run, 'stop'); throw new Error('Typing was cancelled.'); }
    }
    await run.pipe.request('begin', {token: run.token, focusGuard: 'isolated-field-v2'});
    if (run !== activeRun) throw new Error('Typing was cancelled.');
    run.state = {phase: 'typing', typed: 0, total, corrections: 0, startedAt: Date.now(), message: ''};
    // Each acknowledged key is checked separately. No bulk text is queued in the helper.
    const pump = async () => {
      try {
        for (let sequence = 0; sequence < keys.length; sequence++) {
          if (run !== activeRun || run.state.phase !== 'typing') return;
          const [currentTab, window, focused] = await Promise.all([
            chrome.tabs.get(tabId), chrome.windows.get(run.windowId), guard(tabId, frameId, 'check')
          ]);
          if (!currentTab.active || !window.focused || !focused) throw new Error('Focus changed. OS keyboard typing stopped.');
          if (run !== activeRun || !run.pipe) return;
          const key = keys[sequence];
          await formatting(run, 'prepare', key);
          if (run !== activeRun || !run.pipe) return;
          await run.pipe.request('key', {token: run.token, sequence, ...key, focusGuard: 'isolated-field-v2'});
          if (run !== activeRun) return;
          if (run.preserveFormatting) {
            let matched = false;
            const deadline = Date.now() + 750;
            do {
              if (run !== activeRun) return;
              if (await formatting(run, 'verify')) { matched = true; break; }
              await new Promise(resolve => setTimeout(resolve, 20));
            } while (Date.now() < deadline);
            if (!matched) throw new Error('The editor changed or rejected a character, indentation, or tab. Typing stopped. Check the destination; try Browser editing for exact code insertion.');
          }
          if (key.action) run.state.corrections++;
          else run.state.typed++;
          if (sequence + 1 < keys.length) await new Promise(resolve => setTimeout(resolve,
            options.minDelay + Math.random() * (options.maxDelay - options.minDelay)));
        }
        if (run !== activeRun) return;
        run.state = {...run.state, phase: 'completed', message: run.preserveFormatting ?
          'Typing complete. Destination text and whitespace verified.' : run.skipLeadingFourSpaces ?
          'Keys sent with indentation decreases guided by your draft. Editor formatting was not verified; check the result.' :
          'OS keyboard events sent. Check the destination text.'};
        release(run);
      }
      catch (e) { await fail(tabId, e.message); }
    };
    // Let the tab's countdown callback finish before dispatching the first key.
    setTimeout(() => pump(), 0);
    return {...run.state};
  };
  chrome.tabs.onActivated.addListener(info => {
    if (activeRun && info.tabId !== activeRun.tabId) fail(activeRun.tabId, 'Tab changed. OS keyboard typing stopped.');
  });
  chrome.tabs.onRemoved.addListener(tabId => { stop(tabId); runs.delete(tabId); });
  chrome.tabs.onUpdated.addListener((tabId, changes) => {
    if (changes.status === 'loading' || changes.url) fail(tabId, 'The page navigated. OS keyboard typing stopped.');
  });
  chrome.windows.onFocusChanged.addListener(windowId => {
    if (activeRun?.windowId !== undefined && windowId !== activeRun.windowId) fail(activeRun.tabId, 'Window focus changed. OS keyboard typing stopped.');
  });
  return {check, arm, start, stop, fail,
    clear(tabId) { runs.delete(tabId); },
    state(tabId) { const state = runs.get(tabId)?.state; return state && state.phase !== 'armed' ? {...state} : undefined; }};
})();
