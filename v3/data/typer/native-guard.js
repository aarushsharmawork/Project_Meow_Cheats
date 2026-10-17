/* Native focus APIs in the isolated world remain independent of page overrides. */
(() => {
  if (self.__meowNativeGuard?.version === 2) return;
  self.__meowNativeGuard?.stop?.();
  let target;
  const active = () => {
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    return element;
  };
  const stop = () => {
    if (!target) return;
    target = null;
    chrome.runtime.sendMessage({method: 'native-cancel'}).catch(() => {});
  };
  self.__meowNativeGuard = {
    version: 2,
    start() {
      const element = active();
      if (!document.hasFocus() || !element || ['BODY', 'HTML', 'IFRAME', 'FRAME'].includes(element.tagName) ||
          /^(chrome|moz)-extension:/.test(location.protocol) || element.disabled || element.readOnly || element.type === 'password') {
        throw new Error('Click an editable website field. Password fields and extension panels cannot be typed into.');
      }
      target = element;
      return true;
    },
    backspaceWidth() {
      // CodeMirror 5's default Backspace removes a character, while Ace and
      // Monaco remove a soft-indent level. Identify only the editor container;
      // do not read its source/model API. Custom bindings have a manual setting.
      return target?.closest('.CodeMirror') ? 4 : 1;
    },
    check() { return !!target && target.isConnected && !target.disabled && !target.readOnly &&
      target.type !== 'password' && document.hasFocus() && active() === target; },
    stop() { target = null; }
  };
  document.addEventListener('keydown', event => { if (event.key === 'Escape') stop(); }, true);
  document.addEventListener('focusin', () => { if (target && active() !== target) stop(); }, true);
  window.addEventListener('blur', stop, true);
  window.addEventListener('pagehide', stop, true);
})();
