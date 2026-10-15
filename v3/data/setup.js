// The browser can save its identity internally, but cannot write into the
// unpacked extension directory. The local installer creates the JSON there.
const keyboardSetup = (() => {
  let pending;
  const save = async () => {
    const platform = await chrome.runtime.getPlatformInfo();
    if (platform.os !== 'mac') return {skipped: true};
    const extensionId = chrome.runtime.id;
    const payload = {format: 'meowcheats-keyboard-setup', version: 1, extensionId};
    await chrome.storage.local.set({keyboardSetupIdentity: payload});
    return {filename: `v3/setup-${extensionId}.json`};
  };
  return {
    save() {
      pending ??= save().finally(() => { pending = undefined; });
      return pending;
    }
  };
})();
