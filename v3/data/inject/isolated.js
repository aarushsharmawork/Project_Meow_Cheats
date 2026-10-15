(() => {
  if (self.__alwaysActiveIsolated === 2) {
    self.__alwaysActiveRefresh?.();
    return;
  }
  self.__alwaysActiveIsolated = 2;
/* Tests:
  http://www2.stat.duke.edu/~cc248/jsphylosvg/js/yui/tests/event/tests/manual/window-focus-test.html
  https://page-visibility.vercel.app/
  https://codepen.io/calebnance/full/nXPaKN
  https://cdpn.io/tobiasdev/fullpage/oGewQR?anon=true&view=
  https://oncode-frontend.github.io/tab_detector/
*/

/* one marker on the ISOLATED world's global object (per document; invisible to the page) */
self.PROTECTED = true;

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
port.dataset.hidden = document.hidden;
port.dataset.enabled = false;

port.addEventListener('state', () => {
  port.dataset.hidden = document.hidden;
});

let updateId = 0;
const update = async () => {
  const id = ++updateId;
  try {
    const [prefs, context] = await Promise.all([
      chrome.storage.local.get({enabled: true, blur: true, focus: true, redirect: true,
        mouseleave: true, mouseout: true, visibility: true, pointercapture: true,
        fullscreen: false, policies: null}),
      chrome.runtime.sendMessage({method: 'page-controls'})
    ]);
    if (id !== updateId || !context?.ok) return;
    const {hostname, active, controls} = context.result;
    const policy = prefs.policies?.[hostname] || [];
    port.dataset.enabled = active;
    for (const setting of ['blur', 'focus', 'redirect', 'mouseleave', 'mouseout', 'visibility', 'pointercapture']) {
      port.dataset[setting] = !policy.includes(setting) && prefs[setting];
    }
    for (const setting of ['blockFullscreen', 'blockPointerLock', 'mousemove']) {
      port.dataset[setting] = controls[setting] === true;
    }
    const fullscreen = active && !policy.includes('fullscreen') && prefs.fullscreen;
    const changed = port.dataset.fullscreen !== undefined && (port.dataset.fullscreen === 'true') !== fullscreen;
    port.dataset.fullscreen = fullscreen;
    port.dispatchEvent(new Event('settings-ready'));
    if (changed) port.dispatchEvent(new Event('fs'));
    if (window.top === window) chrome.runtime.sendMessage({method: 'set-icon', hostname}).catch(() => {});
  }
  catch (e) { console.debug('[MeowCheats] Settings could not be refreshed', e); }
};

self.__alwaysActiveRefresh = update;
update();
const settings = new Set(['enabled', 'hosts', 'siteControls', 'blur', 'focus', 'redirect',
  'mouseleave', 'mouseout', 'visibility', 'pointercapture', 'fullscreen', 'policies', 'badge']);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some(key => settings.has(key))) update();
});
})();
