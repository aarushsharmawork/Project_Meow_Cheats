/* Isolated-world panel. The cross-origin iframe keeps its draft out of page JS. */
(() => {
  if (self.__alwaysActivePanel?.version === 2) return;
  self.__alwaysActivePanel?.destroy?.();
  // The previous isolated world may be gone while its DOM is still present.
  // Keep one live panel instead of leaving an inert frame above the new one.
  for (const stale of document.querySelectorAll('#always-active-floating-panel')) stale.remove();
  const host = document.createElement('div');
  host.id = 'always-active-floating-panel';
  host.setAttribute('popover', 'manual');
  // Preserve the browser's popover overlay styles; all:initial would reset them.
  host.style.cssText = 'all:revert!important;position:fixed!important;inset:12px 12px auto auto!important;margin:0!important;padding:0!important;width:min(390px,calc(100vw - 24px))!important;height:min(760px,calc(100dvh - 24px))!important;min-width:0!important;min-height:0!important;border:1px solid #383838!important;border-radius:14px!important;overflow:hidden!important;background:#191919!important;color-scheme:dark!important;box-shadow:0 12px 40px #0008!important;z-index:2147483647!important;';
  const shadow = host.attachShadow({mode: 'closed'});
  const style = document.createElement('style');
  style.textContent = ':host::backdrop{background:transparent;pointer-events:none}iframe{display:block;border:0;width:100%;height:100%;min-width:0;min-height:0;background:#191919;color-scheme:dark}';
  const frame = document.createElement('iframe');
  frame.title = 'MeowCheats controls';
  // A normal iframe, without sandboxing: extension origin isolates the UI while
  // preserving the extension APIs it needs. Only this HTML is web accessible.
  const frameURL = chrome.runtime.getURL('data/popup/index.html') + '?mode=overlay';
  frame.src = frameURL;
  shadow.append(style, frame);
  let visible = false;
  let opened = false;
  const show = (refresh = true) => {
    // Reopening can follow an extension reload. Recreate the iframe's API
    // context; drafts have already been saved by the shared menu.
    if (refresh && opened) frame.src = frameURL + '&refresh=' + Date.now();
    opened = true;
    if (!host.isConnected) document.documentElement.append(host);
    host.style.setProperty('display', 'block', 'important');
    visible = true;
    if (typeof host.showPopover === 'function') {
      if (!host.matches(':popover-open')) host.showPopover();
    }
    else {
      host.removeAttribute('popover');
      host.style.setProperty('display', 'block', 'important');
      const fullscreen = document.fullscreenElement;
      if (fullscreen && !['VIDEO', 'CANVAS', 'IFRAME'].includes(fullscreen.tagName)) fullscreen.append(host);
    }
    return {visible};
  };
  const hide = () => {
    visible = false;
    if (host.matches(':popover-open')) host.hidePopover();
    host.style.setProperty('display', 'none', 'important');
    return {visible};
  };
  const raise = () => {
    if (!visible) return;
    // Fullscreen creates another top-layer entry. Re-show to move above it.
    if (host.matches(':popover-open')) host.hidePopover();
    show(false);
  };
  document.addEventListener('fullscreenchange', raise, true);
  document.addEventListener('webkitfullscreenchange', raise, true);
  const destroy = () => {
    visible = false;
    document.removeEventListener('fullscreenchange', raise, true);
    document.removeEventListener('webkitfullscreenchange', raise, true);
    host.remove();
  };
  self.__alwaysActivePanel = {version: 2, show, hide, destroy,
    toggle: () => visible ? hide() : show(), status: () => ({visible})};
})();
