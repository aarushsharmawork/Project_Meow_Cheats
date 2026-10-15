/* Runs in the page world so supported editors can receive actual model edits. */
(() => {
  if (globalThis.__alwaysActiveTyper) return;
  let timer;
  let target;
  let characters = [];
  let settings;
  let state = {phase: 'idle', typed: 0, total: 0, message: ''};
  const status = () => ({...state});
  const finish = (phase, message) => {
    clearTimeout(timer);
    characters = [];
    target = null;
    state = {...state, phase, message};
  };
  const activeElement = () => {
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    return element;
  };
  const findTarget = () => {
    const element = activeElement();
    if (!element) throw new Error('Click a writable text field before the countdown ends.');
    const monacoNode = element.closest('.monaco-editor');
    if (monacoNode) {
      const editor = globalThis.monaco?.editor?.getEditors?.().find(e => e.getDomNode() === monacoNode);
      if (!editor || !editor.getModel()) throw new Error('This Monaco editor does not expose its editing API.');
      return {
        element: monacoNode,
        insert(char) {
          if (editor.getRawOptions().readOnly) throw new Error('The editor is read-only.');
          const model = editor.getModel();
          const range = editor.getSelection();
          const offset = model.getOffsetAt({lineNumber: range.startLineNumber, column: range.startColumn});
          if (!editor.executeEdits('always-active-typer', [{range, text: char, forceMoveMarkers: true}])) {
            throw new Error('The editor refused the edit.');
          }
          const position = model.getPositionAt(offset + (char === '\n' ? model.getEOL().length : char.length));
          editor.setPosition(position);
        }
      };
    }
    const aceNode = element.closest('.ace_editor');
    if (aceNode) {
      const editor = aceNode.env?.editor;
      if (!editor) throw new Error('This Ace editor does not expose its editing API.');
      return {
        element: aceNode,
        insert(char) {
          if (editor.getReadOnly()) throw new Error('The editor is read-only.');
          // Session replacement avoids automatic indentation and paired characters.
          const position = editor.session.replace(editor.getSelectionRange(), char);
          editor.selection.moveCursorToPosition(position);
          editor.clearSelection();
        }
      };
    }
    const cmNode = element.closest('.CodeMirror');
    if (cmNode) {
      const editor = cmNode.CodeMirror;
      if (!editor) throw new Error('This CodeMirror editor does not expose its editing API.');
      return {
        element: cmNode,
        insert(char) {
          if (editor.getOption('readOnly')) throw new Error('The editor is read-only.');
          editor.replaceSelection(char, 'end', '+input');
        }
      };
    }
    if (element.closest('.cm-editor')) {
      throw new Error('This CodeMirror version is not supported. Use a standard text field.');
    }
    if (element instanceof HTMLTextAreaElement ||
        (element instanceof HTMLInputElement && ['text', 'search', 'url', 'tel'].includes(element.type))) {
      return {
        element,
        insert(char) {
          if (element.disabled || element.readOnly) throw new Error('The field is read-only or disabled.');
          if (element.maxLength >= 0 && element.value.length - (element.selectionEnd - element.selectionStart) + char.length > element.maxLength) {
            throw new Error('The field has reached its character limit.');
          }
          if (element instanceof HTMLInputElement && char === '\n') throw new Error('Use a multiline field for text containing line breaks.');
          if (!element.dispatchEvent(new InputEvent('beforeinput', {bubbles: true, composed: true, cancelable: true, inputType: 'insertText', data: char}))) {
            throw new Error('The page blocked text insertion.');
          }
          const start = element.selectionStart;
          const value = element.value.slice(0, start) + char + element.value.slice(element.selectionEnd);
          // Native setter also notifies controlled inputs (for example React).
          const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
          element.setSelectionRange(start + char.length, start + char.length);
          element.dispatchEvent(new InputEvent('input', {bubbles: true, composed: true, inputType: 'insertText', data: char}));
          if (element.value !== value) throw new Error('The page rejected the inserted text.');
        }
      };
    }
    if (element.isContentEditable) {
      return {
        element,
        insert(char) {
          if (!element.isContentEditable) throw new Error('The field is no longer editable.');
          const selection = element.getRootNode().getSelection?.() || document.getSelection();
          if (!selection?.rangeCount || !element.contains(selection.anchorNode) || !element.contains(selection.focusNode)) {
            throw new Error('The cursor moved outside the chosen field.');
          }
          // Browser editing preserves rich-text editor input events and undo handling.
          if (!document.execCommand(char === '\n' ? 'insertLineBreak' : 'insertText', false, char === '\n' ? null : char)) {
            throw new Error('This rich text editor does not support text insertion.');
          }
        }
      };
    }
    throw new Error('Click a writable text field before the countdown ends.');
  };
  const tick = () => {
    if (state.phase !== 'typing') return;
    try {
      if (!target.element.isConnected) throw new Error('The chosen field was removed.');
      if (!target.element.contains(activeElement())) throw new Error('Typing stopped because the cursor moved to another field.');
      target.insert(characters[state.typed]);
      // A page may synchronously dispatch Escape while handling an input event.
      if (state.phase !== 'typing') return;
      state.typed++;
      if (state.typed === state.total) return finish('completed', 'Typing complete.');
      const delay = settings.minDelay + Math.random() * (settings.maxDelay - settings.minDelay);
      timer = setTimeout(tick, delay);
    }
    catch (e) {
      finish('error', e.message);
    }
  };
  globalThis.__alwaysActiveTyper = {
    status,
    start(options) {
      if (state.phase === 'typing') throw new Error('Typing is already running in this frame.');
      target = findTarget();
      settings = options;
      characters = Array.from(options.text.replace(/\r\n?/g, '\n'));
      state = {phase: 'typing', typed: 0, total: characters.length, startedAt: Date.now(), message: ''};
      timer = setTimeout(tick, 0);
      return status();
    },
    stop() {
      if (state.phase === 'typing') finish('stopped', 'Typing stopped.');
      return status();
    }
  };
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.phase === 'typing') finish('stopped', 'Typing stopped with Escape.');
  }, true);
})();
