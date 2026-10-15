(() => {
  if (self.__alwaysActiveMain) {
    // Reconnect the existing page hooks when an extension update reinjects the
    // isolated settings controller into a document that is still open.
    const port = self.__alwaysActivePort;
    if (port && !port.isConnected) document.documentElement.append(port);
    if (port) port.hidden = true;
    return;
  }
  self.__alwaysActiveMain = true;
/* global navigation */
{
  /* port is used to communicate between chrome and page scripts */
  let port;
  try {
    port = document.getElementById('lwys-ctv-port');
    if (!port) throw new Error('No settings bridge yet');
  }
  catch (e) {
    port = document.createElement('span');
    port.id = 'lwys-ctv-port';
    document.documentElement.append(port);
  }

  port.hidden = true;
  self.__alwaysActivePort = port;
  port.dataset.enabled ??= 'false';
  const vstate = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
  const hstate = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');

  const block = e => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  };

  /* visibility */
  Object.defineProperty(document, 'visibilityState', {
    get() {
      return port.dataset.enabled === 'true' ? 'visible' : vstate.get.call(document);
    }
  });
  Object.defineProperty(document, 'webkitVisibilityState', {
    get() {
      return port.dataset.enabled === 'true' ? 'visible' : vstate.get.call(document);
    }
  });

  const cstate = vstate.get.call(document);
  const once = {
    focus: true,
    // if document is hidden allow one time event
    visibilitychange: cstate === 'hidden',
    webkitvisibilitychange: cstate === 'hidden'
  };

  /* prevent redirect when hidden */
  if (window.top === window && typeof navigation !== 'undefined') {
    // Save the original property descriptor
    const redirect = e => {
      if (redirect.href) {
        console.info('[MeowCheats]', 'an attempt to redirect is being blocked', redirect.href);
        e.preventDefault();
        e.returnValue = 'no';
      }
    };
    navigation.addEventListener('navigate', navigateEvent => {
      if (navigateEvent.navigationType === 'reload') {
        redirect.href = navigateEvent.destination.url;
      }
    });
    document.addEventListener('visibilitychange', e => {
      delete redirect.href;
      removeEventListener('beforeunload', redirect);
      try {
        const state = vstate.get.call(document);
        if (state === 'hidden') {
          if (port.dataset.enabled === 'true' && port.dataset.redirect !== 'false') {
            addEventListener('beforeunload', redirect);
          }
        }
      }
      catch (e) {}
    });
  }

  const onvisibility = e => {
    port.dispatchEvent(new Event('state'));
    if (port.dataset.enabled === 'true' && port.dataset.visibility !== 'false') {
      if (once.visibilitychange) {
        once.visibilitychange = false;
        return;
      }
      return block(e);
    }
  };
  // Window capture runs before page listeners on document, including capture listeners.
  window.addEventListener('visibilitychange', onvisibility, true);
  const onwebkitvisibility = e => {
    if (port.dataset.enabled === 'true' && port.dataset.visibility !== 'false') {
      if (once.webkitvisibilitychange) {
        once.webkitvisibilitychange = false;
        return;
      }
      return block(e);
    }
  };
  window.addEventListener('webkitvisibilitychange', onwebkitvisibility, true);
  window.addEventListener('pagehide', e => {
    if (port.dataset.enabled === 'true' && port.dataset.visibility !== 'false') {
      block(e);
    }
  }, true);

  /* pointercapture */
  window.addEventListener('lostpointercapture', e => {
    if (port.dataset.enabled === 'true' && port.dataset.pointercapture !== 'false') {
      block(e);
    }
  }, true);

  /* hidden */
  Object.defineProperty(document, 'hidden', {
    get() {
      return port.dataset.enabled === 'true' ? false : hstate.get.call(document);
    }
  });
  Object.defineProperty(document, 'webkitHidden', {
    get() {
      return port.dataset.enabled === 'true' ? false : hstate.get.call(document);
    }
  });

  /* focus */
  Document.prototype.hasFocus = new Proxy(Document.prototype.hasFocus, {
    apply(target, self, args) {
      if (port.dataset.enabled === 'true' && port.dataset.focus !== 'false') {
        return true;
      }
      return Reflect.apply(target, self, args);
    }
  });

  const onfocus = e => {
    if (port.dataset.enabled === 'true' && port.dataset.focus !== 'false') {
      if (e.target === document || e.target === window) {
        if (once.focus) {
          once.focus = false;
          return;
        }
        return block(e);
      }
    }
  };
  document.addEventListener('focus', onfocus, true);
  window.addEventListener('focus', onfocus, true);

  /* blur */
  const onblur = e => {
    if (port.dataset.enabled === 'true' && port.dataset.blur !== 'false') {
      if (e.target === document || e.target === window) {
        return block(e);
      }
    }
  };
  document.addEventListener('blur', onblur, true);
  window.addEventListener('blur', onblur, true);

  /* Page-edge exits only. Transitions between elements keep working. Global
     listeners receiving exits from deeper elements are filtered in privacy.js. */
  for (const type of ['mouseleave', 'mouseout', 'pointerleave', 'pointerout']) {
    window.addEventListener(type, e => {
      const setting = type.endsWith('leave') ? 'mouseleave' : 'mouseout';
      if (port.dataset.enabled !== 'true' || port.dataset[setting] === 'false' || e.relatedTarget !== null) return;
      if ([window, document, document.documentElement, document.body].includes(e.target)) block(e);
    }, true);
  }

  /* fullscreen protection (optional): keeps the page believing it is still fullscreen
     after the browser force-exits fullscreen on a hidden tab. The option is off by default;
     until it is enabled, the script touches nothing at all (no listeners, no overwrites).
     Once enabled, while the page is visible the fullscreen events pass through and only
     the real state is recorded; while the page is hidden, the events are blocked and the
     recorded state is spoofed. Toggling the pref installs or fully removes the protection
     on the fly. */
  {
    /* original descriptors (captured before any overwrite; invisible to the page) */
    const fele = Object.getOwnPropertyDescriptor(Document.prototype, 'fullscreenElement');
    const wfele = Object.getOwnPropertyDescriptor(Document.prototype, 'webkitFullscreenElement');
    const target = fele || wfele;

    /* the recorded state (persists across the hidden period) */
    const real = {
      element: null
    };
    const realElement = () => {
      try {
        return target ? target.get.call(document) : null;
      }
      catch (e) {
        return null;
      }
    };
    const grab = () => {
      real.element = realElement();
    };

    const protectedState = () => port.dataset.enabled === 'true' &&
      port.dataset.fullscreen !== 'false' &&
      port.dataset.hidden === 'true';

    const element = () => protectedState() ? real.element : realElement();
    const bool = () => !!element();

    const onfullscreen = e => {
      /* always track the real state; block the page's handlers only while hidden */
      // Preserve the last fullscreen element if the browser exits while hidden.
      if (!protectedState() || realElement()) grab();
      if (protectedState()) return block(e);
    };
    const onfullscreenerror = e => {
      if (protectedState()) {
        return block(e);
      }
    };

    const install = () => {
      grab();
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get: element
      });
      Object.defineProperty(document, 'webkitFullscreenElement', {
        configurable: true,
        get: element
      });
      Object.defineProperty(document, 'fullscreen', {
        configurable: true,
        get: bool
      });
      Object.defineProperty(document, 'webkitIsFullScreen', {
        configurable: true,
        get: bool
      });
      document.addEventListener('fullscreenchange', onfullscreen, true);
      document.addEventListener('webkitfullscreenchange', onfullscreen, true);
      window.addEventListener('fullscreenchange', onfullscreen, true);
      window.addEventListener('webkitfullscreenchange', onfullscreen, true);
      document.addEventListener('fullscreenerror', onfullscreenerror, true);
      document.addEventListener('webkitfullscreenerror', onfullscreenerror, true);
      window.addEventListener('fullscreenerror', onfullscreenerror, true);
      window.addEventListener('webkitfullscreenerror', onfullscreenerror, true);

      install.active = true;
    };
    const uninstall = () => {
      document.removeEventListener('fullscreenchange', onfullscreen, true);
      document.removeEventListener('webkitfullscreenchange', onfullscreen, true);
      window.removeEventListener('fullscreenchange', onfullscreen, true);
      window.removeEventListener('webkitfullscreenchange', onfullscreen, true);
      document.removeEventListener('fullscreenerror', onfullscreenerror, true);
      document.removeEventListener('webkitfullscreenerror', onfullscreenerror, true);
      window.removeEventListener('fullscreenerror', onfullscreenerror, true);
      window.removeEventListener('webkitfullscreenerror', onfullscreenerror, true);
      for (const prop of ['fullscreenElement', 'webkitFullscreenElement', 'fullscreen', 'webkitIsFullScreen']) {
        delete document[prop];
      }
      real.element = null;

      install.active = false;
    };

    /* the decision is delivered by the ISOLATED world through the port element;
       until it arrives (or unless it is "true"), nothing is installed */
    const toggle = () => {
      if (port.dataset.fullscreen === 'true' && !install.active) {
        install();
      }
      else if (port.dataset.fullscreen !== 'true' && install.active) {
        uninstall();
      }
    };
    const check = () => {
      toggle();
      if (port.dataset.fullscreen === undefined) {
        setTimeout(check, 4);
      }
    };
    check();

    /* live install/uninstall when the pref (or a per-host policy) changes */
    port.addEventListener('fs', toggle);
  }

  /* Keep background animation callbacks cancellable even after returning to the tab. */
  let lastTime = 0;
  let nextFrameId = -1;
  const pendingFrames = new Map();
  window.requestAnimationFrame = new Proxy(window.requestAnimationFrame, {
    apply(method, receiver, args) {
      if (port.dataset.enabled === 'true' && port.dataset.hidden === 'true') {
        const now = performance.now();
        const delay = Math.max(0, 16 - (now - lastTime));
        const id = nextFrameId--;
        pendingFrames.set(id, setTimeout(() => {
          pendingFrames.delete(id);
          args[0](performance.now());
        }, delay));
        lastTime = now + delay;
        return id;
      }
      return Reflect.apply(method, receiver, args);
    }
  });
  window.cancelAnimationFrame = new Proxy(window.cancelAnimationFrame, {
    apply(method, receiver, args) {
      if (pendingFrames.has(args[0])) {
        clearTimeout(pendingFrames.get(args[0]));
        pendingFrames.delete(args[0]);
        return;
      }
      return Reflect.apply(method, receiver, args);
    }
  });

}

''

})();
