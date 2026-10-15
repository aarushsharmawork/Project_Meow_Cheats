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
    if (!run || !['armed', 'typing'].includes(run.state.phase)) return;
    run.state = {...run.state, phase: 'stopped', message: 'Typing stopped.'};
    release(run);
  };
  const fail = async (tabId, message) => {
    const run = runs.get(tabId);
    if (!run || !['armed', 'typing'].includes(run.state.phase)) return;
    run.state = {...run.state, phase: 'error', message};
    release(run);
  };
  const check = async (prompt = false) => {
    const platform = await chrome.runtime.getPlatformInfo();
    if (platform.os !== 'mac') throw new Error('OS keyboard mode currently supports macOS only.');
    const pipe = connection();
    try { return await pipe.request('check', {prompt}); }
    catch (e) { throw new Error(`${e.message} Run native/install.command with this extension ID: ${chrome.runtime.id}.`); }
    finally { pipe.disconnect(); }
  };
  const permissionMessage = status => {
    if (status.axTrusted === false && status.postEventAccess === false)
      return 'macOS denied both Accessibility and keyboard-event access for the helper launched by Chrome. Check Google Chrome and the keyboard helper in System Settings → Privacy & Security → Accessibility. If both are on after rebuilding, remove and re-add the rebuilt keyboard helper app there.';
    if (status.axTrusted === false)
      return 'macOS denied Accessibility for the helper launched by Chrome. Check Google Chrome and the keyboard helper in System Settings → Privacy & Security → Accessibility. If both are on after rebuilding, remove and re-add the rebuilt keyboard helper app there.';
    if (status.postEventAccess === false)
      return 'macOS denied keyboard-event posting for the helper launched by Chrome. Use Request macOS keyboard permission in the menu, then check again.';
    return 'macOS keyboard permission is unavailable. Use Request macOS keyboard permission in the menu, then check again.';
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
      if (status.protocol !== 3) throw new Error('Update the keyboard helper using native/build.command, then reconnect the extension.');
      if (!status.accessibility) throw new Error(permissionMessage(status));
    }
    catch (e) {
      await fail(tabId, e.message);
      if (/native messaging host|not found|disconnected/i.test(e.message))
        throw new Error(`${e.message} Helper setup: native/install.command; extension ID: ${chrome.runtime.id}.`);
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
    const chars = Array.from(options.text.replace(/\r\n?/g, '\n'));
    run.token = crypto.randomUUID();
    run.preserveFormatting = options.preserveFormatting !== false;
    if (run.preserveFormatting) {
      await chrome.scripting.executeScript({target: {tabId, frameIds: [frameId]}, world: 'MAIN', files: ['data/typer/code-formatting.js']});
      // If Stop wins this race, restore only this token and do not send any text.
      await formatting(run, 'start', {hasTabs: chars.includes('\t')});
      if (run !== activeRun) { await formatting(run, 'stop'); throw new Error('Typing was cancelled.'); }
    }
    await run.pipe.request('begin', {token: run.token, focusGuard: 'isolated-field-v2'});
    if (run !== activeRun) throw new Error('Typing was cancelled.');
    run.state = {phase: 'typing', typed: 0, total: chars.length, startedAt: Date.now(), message: ''};
    // Each acknowledged key is checked separately. No bulk text is queued in the helper.
    const pump = async () => {
      try {
        for (let sequence = 0; sequence < chars.length; sequence++) {
          if (run !== activeRun || run.state.phase !== 'typing') return;
          const [currentTab, window, focused] = await Promise.all([
            chrome.tabs.get(tabId), chrome.windows.get(run.windowId), guard(tabId, frameId, 'check')
          ]);
          if (!currentTab.active || !window.focused || !focused) throw new Error('Focus changed. OS keyboard typing stopped.');
          if (run !== activeRun || !run.pipe) return;
          await formatting(run, 'prepare', {character: chars[sequence]});
          if (run !== activeRun || !run.pipe) return;
          await run.pipe.request('key', {token: run.token, sequence, character: chars[sequence], focusGuard: 'isolated-field-v2'});
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
          run.state.typed++;
          if (sequence + 1 < chars.length) await new Promise(resolve => setTimeout(resolve,
            options.minDelay + Math.random() * (options.maxDelay - options.minDelay)));
        }
        if (run !== activeRun) return;
        run.state = {...run.state, phase: 'completed', message: run.preserveFormatting ?
          'Typing complete. Destination text and whitespace verified.' : 'OS keyboard events sent. Check the destination text.'};
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
