/* Narrow bridge for an image explicitly reviewed in MeowCheats. No capture,
   clipboard access, prompt reading or submission occurs in this script. */
(() => {
  if (self === top || location.hostname !== 'gemini.google.com') return;
  // Web-accessible resources can use a dynamic UUID while Chrome hosts the
  // extension document at its stable ID. Both belong to this extension.
  const owners = new Set([new URL(chrome.runtime.getURL('data/popup/index.html')).origin,
    `chrome-extension://${chrome.runtime.id}`]);
  const composer = () => ['rich-textarea [contenteditable="true"]', '[role="textbox"][contenteditable="true"]', 'div[contenteditable="true"]', 'textarea']
    .map(selector => [...document.querySelectorAll(selector)].find(node => {
      const rect = node.getBoundingClientRect();
      return !node.disabled && !node.readOnly && rect.width > 4 && rect.height > 4 && rect.bottom > 0 && rect.top < innerHeight &&
        getComputedStyle(node).visibility !== 'hidden';
    })).find(Boolean);
  const pasteScreenshot = async (editor, dataUrl) => {
    const previews = () => [...document.querySelectorAll(
      'uploader-file-preview, file-preview, .file-preview, [data-test-id="file-preview"], ' +
      '[aria-label*="Remove image"], [aria-label*="Remove file"], [aria-label*="Remove attachment"], ' +
      '.attachment-container img, .file-preview-container img, .upload-file-card'
    )];
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], `screenshot-${Date.now()}.png`, {type: 'image/png'});
    const existing = new Set(previews());
    const transfer = new DataTransfer(); transfer.items.add(file);
    editor.focus();
    const paste = new ClipboardEvent('paste', {clipboardData: transfer, bubbles: true, cancelable: true, composed: true});
    editor.dispatchEvent(paste);
    if (!paste.defaultPrevented) {
      // Do not try a second method after a paste handler consumed the image.
      for (const type of ['dragenter', 'dragover', 'drop']) {
        editor.dispatchEvent(new DragEvent(type, {dataTransfer: transfer, bubbles: true, cancelable: true, composed: true}));
      }
    }
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (previews().some(node => !existing.has(node))) return {attached: true};
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    return {attached: false, message: 'Attachment could not be confirmed. Check Gemini for a preview before retrying. If its drawer or upload controls are still loading, the embedded connection may be incomplete.'};
  };
  let busy = false;
  window.addEventListener('message', async event => {
    if (event.source !== parent || !owners.has(event.origin) || event.data?.channel !== 'meow-gemini-attachment') return;
    const {id, action, dataUrl} = event.data;
    if (typeof id !== 'string' || id.length > 80) return;
    const reply = result => parent.postMessage({channel: 'meow-gemini-attachment-reply', id, ...result}, event.origin);
    if (action === 'ready') { reply({ok: true, ready: !!composer()}); return; }
    if (action !== 'attach') return;
    if (busy) { reply({ok: false, error: 'An attachment is already being processed.'}); return; }
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,iVBORw0KGgo') || dataUrl.length > 28 * 1024 * 1024) {
      reply({ok: false, error: 'The screenshot is not a supported PNG image.'}); return;
    }
    const editor = composer();
    if (!editor) { reply({ok: false, error: 'Gemini’s composer is still loading. Wait for it to become available.'}); return; }
    busy = true;
    try {
      reply({ok: true, ...await pasteScreenshot(editor, dataUrl)});
    }
    catch { reply({ok: false, error: 'Gemini did not accept the image paste. Try its + → Upload files control.'}); }
    finally { busy = false; }
  });
})();
