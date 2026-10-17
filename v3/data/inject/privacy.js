/* Optional site controls. Settings arrive through the shared document bridge. */
(() => {
  if (/^(chrome|moz)-extension:$/.test(location.protocol) ||
      [...(location.ancestorOrigins || [])].some(origin => /^(chrome|moz)-extension:\/\//.test(origin))) return;
  if (self.__alwaysActivePrivacy) return;
  self.__alwaysActivePrivacy = true;
  const port = document.getElementById('lwys-ctv-port') || self.__alwaysActivePort;
  if (!port) return;
  const suppressMovement = () => port.dataset.mousemove === 'true';
  const movement = new Set(['mousemove', 'pointermove', 'pointerrawupdate']);
  const boundary = new Set(['mouseout', 'mouseleave', 'pointerout', 'pointerleave']);
  const filtered = new Set([...movement, ...boundary]);
  // Document-level move listeners also drive custom drag/resize/selection UIs.
  // Suppress only idle mouse movement; gestures and captured pointers survive.
  const capturedPointers = new Set();
  window.addEventListener('gotpointercapture', event => capturedPointers.add(event.pointerId), true);
  window.addEventListener('lostpointercapture', event => capturedPointers.delete(event.pointerId), true);
  window.addEventListener('pointerup', event => capturedPointers.delete(event.pointerId), true);
  window.addEventListener('pointercancel', event => capturedPointers.delete(event.pointerId), true);
  window.addEventListener('blur', () => capturedPointers.clear(), true);
  const nativeHasCapture = Element.prototype.hasPointerCapture;
  const hasCapture = event => {
    if (!nativeHasCapture || !Number.isInteger(event.pointerId)) return false;
    try { return Reflect.apply(nativeHasCapture, event.target, [event.pointerId]); }
    catch (e) { return false; }
  };
  const interacting = event => event.buttons > 0 ||
    (event.pointerType && event.pointerType !== 'mouse') || capturedPointers.has(event.pointerId) ||
    hasCapture(event);
  const suppress = event => {
    if (movement.has(event.type)) return suppressMovement() && !interacting(event);
    const setting = event.type.endsWith('leave') ? 'mouseleave' : 'mouseout';
    return boundary.has(event.type) && event.relatedTarget === null &&
      port.dataset.enabled === 'true' && port.dataset[setting] !== 'false';
  };
  const globalTarget = target => target === window || target === document;
  const nativeAdd = EventTarget.prototype.addEventListener;
  const nativeRemove = EventTarget.prototype.removeEventListener;
  const status = {mousemove: 'ready', blockFullscreen: 'unsupported', blockPointerLock: 'unsupported'};
  const replace = (target, property, value) => {
    try { return Reflect.set(target, property, value) && target[property] === value; }
    catch (e) { return false; }
  };
  const settingsReady = () => new Promise((resolve, reject) => {
    if (port.dataset.blockFullscreen !== undefined) { resolve(); return; }
    let timer;
    const ready = () => { clearTimeout(timer); Reflect.apply(nativeRemove, port, ['settings-ready', ready]); resolve(); };
    Reflect.apply(nativeAdd, port, ['settings-ready', ready, {once: true}]);
    timer = setTimeout(() => {
      Reflect.apply(nativeRemove, port, ['settings-ready', ready]);
      reject(new DOMException('Site controls could not be loaded. Reload the page and try again.', 'InvalidStateError'));
    }, 3000);
  });
  // Keep one wrapper per target/type/listener; removal and duplicate detection
  // retain their native capture/once/signal semantics.
  const listeners = new WeakMap();
  const wrapperFor = (target, type, listener, create) => {
    let types = listeners.get(target);
    if (!types && create) listeners.set(target, types = new Map());
    let entries = types?.get(type);
    if (!entries && create) types.set(type, entries = new WeakMap());
    let wrapped = entries?.get(listener);
    if (!wrapped && create) {
      wrapped = function(event) {
        if (suppress(event)) return;
        if (typeof listener === 'function') return Reflect.apply(listener, this, [event]);
        return listener.handleEvent?.call(listener, event);
      };
      entries.set(listener, wrapped);
    }
    return wrapped;
  };
  const add = function(type, listener, options) {
    if (globalTarget(this) && filtered.has(type) && listener && ['function', 'object'].includes(typeof listener)) {
      listener = wrapperFor(this, type, listener, true);
    }
    return Reflect.apply(nativeAdd, this, [type, listener, options]);
  };
  const remove = function(type, listener, options) {
    if (globalTarget(this) && filtered.has(type) && listener && ['function', 'object'].includes(typeof listener)) {
      const wrapped = wrapperFor(this, type, listener, false);
      if (wrapped) Reflect.apply(nativeRemove, this, [type, wrapped, options]);
    }
    // Also remove listeners that a page registered before the wrappers existed.
    return Reflect.apply(nativeRemove, this, [type, listener, options]);
  };
  // Install/remove as a pair. If a site locks either API, leave both unchanged.
  if (!replace(EventTarget.prototype, 'addEventListener', add) ||
      !replace(EventTarget.prototype, 'removeEventListener', remove)) {
    if (EventTarget.prototype.addEventListener === add) replace(EventTarget.prototype, 'addEventListener', nativeAdd);
    if (EventTarget.prototype.removeEventListener === remove) replace(EventTarget.prototype, 'removeEventListener', nativeRemove);
    status.mousemove = 'partial';
  }
  // Support global event-handler properties, including existing handlers.
  for (const target of [window, document]) {
    for (const type of filtered) {
      const property = 'on' + type;
      let prototype = target;
      let descriptor;
      while (prototype && !descriptor) {
        descriptor = Object.getOwnPropertyDescriptor(prototype, property);
        prototype = Object.getPrototypeOf(prototype);
      }
      if (!descriptor?.set || !descriptor.get) {
        if (descriptor) status.mousemove = 'partial';
        continue;
      }
      let listener = descriptor.get.call(target);
      const set = value => {
        listener = typeof value === 'function' ? value : null;
        descriptor.set.call(target, listener ? function(event) {
          if (!suppress(event)) return Reflect.apply(listener, this, [event]);
        } : null);
      };
      try {
        Object.defineProperty(target, property, {configurable: true, enumerable: descriptor.enumerable,
          get: () => listener, set});
        set(listener);
      }
      catch (e) { status.mousemove = 'partial'; }
    }
  }
  for (const [name, setting] of [
    ['requestFullscreen', 'blockFullscreen'], ['webkitRequestFullscreen', 'blockFullscreen'],
    ['webkitRequestFullScreen', 'blockFullscreen'], ['requestPointerLock', 'blockPointerLock']
  ]) {
    const original = Element.prototype[name];
    if (typeof original !== 'function') continue;
    const proxy = new Proxy(original, {
      apply(method, element, args) {
        const request = () => {
          if (port.dataset[setting] === 'true') {
            const error = new DOMException(`${name} blocked by your extension site setting.`, 'NotAllowedError');
            // Legacy WebKit requests return void; reject standard promise APIs.
            if (name.startsWith('webkit')) throw error;
            return Promise.reject(error);
          }
          return Reflect.apply(method, element, args);
        };
        // At document_start, the isolated script is still fetching preferences.
        // Defer standard requests until they arrive instead of allowing a race.
        if (!name.startsWith('webkit') && port.dataset[setting] === undefined) return settingsReady().then(request);
        return request();
      }
    });
    const installed = replace(Element.prototype, name, proxy);
    if (status[setting] !== 'partial') status[setting] = installed ? 'ready' : 'partial';
  }
  // Honest local diagnostics; this is not a guarantee that a site's tracking
  // stopped. Previously saved API references and element listeners still work.
  port.dataset.controlHooks = JSON.stringify(status);
})();
