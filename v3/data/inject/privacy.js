/* Optional site controls. Settings arrive through the shared document bridge. */
(() => {
  if (self.__alwaysActivePrivacy) return;
  self.__alwaysActivePrivacy = true;
  const port = document.getElementById('lwys-ctv-port') || self.__alwaysActivePort;
  if (!port) return;
  const suppressMovement = () => port.dataset.mousemove === 'true';
  const movement = new Set(['mousemove', 'pointermove', 'pointerrawupdate']);
  const boundary = new Set(['mouseout', 'mouseleave', 'pointerout', 'pointerleave']);
  const filtered = new Set([...movement, ...boundary]);
  const suppress = event => {
    if (movement.has(event.type)) return suppressMovement();
    const setting = event.type.endsWith('leave') ? 'mouseleave' : 'mouseout';
    return boundary.has(event.type) && event.relatedTarget === null &&
      port.dataset.enabled === 'true' && port.dataset[setting] !== 'false';
  };
  const globalTarget = target => target === window || target === document;
  const nativeAdd = EventTarget.prototype.addEventListener;
  const nativeRemove = EventTarget.prototype.removeEventListener;
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
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (globalTarget(this) && filtered.has(type) && listener && ['function', 'object'].includes(typeof listener)) {
      listener = wrapperFor(this, type, listener, true);
    }
    return Reflect.apply(nativeAdd, this, [type, listener, options]);
  };
  EventTarget.prototype.removeEventListener = function(type, listener, options) {
    if (globalTarget(this) && filtered.has(type) && listener && ['function', 'object'].includes(typeof listener)) {
      const wrapped = wrapperFor(this, type, listener, false);
      if (wrapped) Reflect.apply(nativeRemove, this, [type, wrapped, options]);
    }
    // Also remove listeners that a page registered before the wrappers existed.
    return Reflect.apply(nativeRemove, this, [type, listener, options]);
  };
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
      if (!descriptor?.set || !descriptor.get) continue;
      let listener = descriptor.get.call(target);
      const set = value => {
        listener = typeof value === 'function' ? value : null;
        descriptor.set.call(target, listener ? function(event) {
          if (!suppress(event)) return Reflect.apply(listener, this, [event]);
        } : null);
      };
      Object.defineProperty(target, property, {configurable: true, enumerable: descriptor.enumerable,
        get: () => listener, set});
      set(listener);
    }
  }
  for (const [name, setting] of [
    ['requestFullscreen', 'blockFullscreen'], ['webkitRequestFullscreen', 'blockFullscreen'],
    ['webkitRequestFullScreen', 'blockFullscreen'], ['requestPointerLock', 'blockPointerLock']
  ]) {
    const original = Element.prototype[name];
    if (typeof original !== 'function') continue;
    Element.prototype[name] = new Proxy(original, {
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
  }
})();
