/* Countdown lives in the tab, so closing the popup or worker does not cancel it. */
(() => {
  if (self.__alwaysActiveTyperControl) return;
  let timer;
  let generation = 0;
  let state = {phase: 'idle', typed: 0, total: 0, message: ''};
  const status = () => ({...state});
  self.__alwaysActiveTyperControl = {
    status,
    start(options) {
      if (['countdown', 'starting'].includes(state.phase)) throw new Error('A countdown is already running.');
      const id = ++generation;
      state = {phase: 'countdown', typed: 0, total: Array.from(options.text.replace(/\r\n?/g, '\n')).length, deadline: Date.now() + options.preparationDelay * 1000, message: ''};
      timer = setTimeout(async () => {
        if (generation !== id) return;
        state.phase = 'starting';
        try {
          const result = await chrome.runtime.sendMessage({method: 'typer-ready', generation: id, options});
          if (generation !== id) return;
          state = result.ok ? {phase: 'idle', typed: 0, total: 0, message: ''} : {...state, phase: 'error', message: result.error};
        }
        catch (e) {
          if (generation === id) state = {...state, phase: 'error', message: e.message};
        }
      }, options.preparationDelay * 1000);
      return status();
    },
    current(id) { return generation === id && state.phase === 'starting'; },
    fail(message) {
      generation++;
      clearTimeout(timer);
      state = {phase: 'error', typed: 0, total: 0, message};
      return status();
    },
    stop() {
      generation++;
      clearTimeout(timer);
      state = {...state, phase: 'stopped', message: 'Typing stopped.'};
      return status();
    }
  };
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && ['countdown', 'starting'].includes(state.phase)) {
      self.__alwaysActiveTyperControl.stop();
      chrome.runtime.sendMessage({method: 'typer-cancel'}).catch(() => {});
    }
  }, true);
})();
