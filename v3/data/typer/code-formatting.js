/* Native keys still supply the text. Public editor settings prevent the editor
 * adding a second indentation or paired character; readback checks each edit. */
(() => {
  if (self.__meowCodeFormatting) return;
  let run;
  const copy = value => value && typeof value === 'object' ? (Array.isArray(value) ? value.map(copy) :
    Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]))) : value;
  const same = (a, b) => a === b || (!!a && !!b && typeof a === 'object' && typeof b === 'object' &&
    Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && same(a[key], b[key])));
  const active = () => {
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    return element;
  };
  const stop = ({token} = {}) => {
    if (!run || (token && token !== run.token)) return;
    const old = run;
    run = null;
    clearInterval(old.timer);
    for (const restore of old.restore.reverse()) {
      try { restore(); }
      catch (e) { console.debug('[MeowCheats] Could not restore an editor setting', e); }
    }
  };
  const setting = (get, set, value, restoreValue = get()) => {
    // Some editor option objects are mutated in place by updateOptions().
    const original = copy(restoreValue);
    set(value);
    const installed = copy(get());
    run.restore.push(() => { if (same(get(), installed)) set(original); });
  };
  const unsupported = name => {
    throw new Error(`${name} does not expose the editor API needed to preserve code formatting. No source text was sent. Use Browser editing if supported, or disable the editor's auto-indent and auto-pairing before turning off Preserve code formatting (Unstable).`);
  };
  const adapter = (element, hasTabs) => {
    const monacoNode = element.closest('.monaco-editor');
    if (monacoNode) {
      const api = self.monaco?.editor;
      const editor = api?.getEditors?.().find(editor => editor.getDomNode() === monacoNode);
      if (!editor || !api.EditorOption) return unsupported('This Monaco editor');
      const model = editor.getModel();
      if (!model || editor.getRawOptions().readOnly) throw new Error('The editor is read-only.');
      const patch = {autoIndent: 'none', autoClosingBrackets: 'never', autoClosingQuotes: 'never',
        autoClosingComments: 'never', autoSurround: 'never', formatOnType: false,
        acceptSuggestionOnEnter: 'off', tabCompletion: 'off', quickSuggestions: false,
        suggestOnTriggerCharacters: false};
      for (const [key, value] of Object.entries(patch)) {
        const option = api.EditorOption[key];
        if (option === undefined) continue;
        const resolved = editor.getOption(option);
        const original = editor.getRawOptions()[key] ?? (key === 'autoIndent' ?
          ['none', 'keep', 'brackets', 'advanced', 'full'][resolved] : resolved);
        setting(() => editor.getOption(option), value => editor.updateOptions({[key]: value}), value, original);
      }
      setting(() => model.getOptions().trimAutoWhitespace,
        value => model.updateOptions({trimAutoWhitespace: value}), false);
      if (hasTabs) setting(() => model.getOptions().insertSpaces,
        value => model.updateOptions({insertSpaces: value}), false);
      return {read() {
        if (editor.getModel() !== model || editor.getSelections()?.length !== 1 || editor.getRawOptions().readOnly) {
          throw new Error('The editor model, selection, or write permission changed.');
        }
        const selection = editor.getSelection();
        return {value: model.getValue().replace(/\r\n?/g, '\n'),
          start: offset(model, selection.getStartPosition()), end: offset(model, selection.getEndPosition())};
      }};
    }
    const aceNode = element.closest('.ace_editor');
    if (aceNode) {
      const editor = aceNode.env?.editor;
      if (!editor?.keyBinding?.addKeyboardHandler || !editor.keyBinding.removeKeyboardHandler) return unsupported('This Ace editor');
      const session = editor.session;
      const options = editor.getOptions();
      for (const [key, value] of Object.entries({enableAutoIndent: false, behavioursEnabled: false,
        wrapBehavioursEnabled: false, enableLiveAutocompletion: false, overwrite: false,
        ...(hasTabs ? {useSoftTabs: false} : {})})) {
        if (key in options) setting(() => editor.getOption(key), value => editor.setOption(key, value), value);
      }
      // Older Ace releases lack enableAutoIndent. A temporary per-editor key
      // handler gives Enter/Tab literal meanings without patching shared modes.
      const handler = {handleKeyboard(data, modifiers, key) {
        if (modifiers !== 0 || !['return', 'tab'].includes(key)) return;
        return {command: {name: 'meowcheats-literal-whitespace', exec() {
          if (editor.session !== session || editor.getReadOnly()) return false;
          const position = session.replace(editor.getSelectionRange(), key === 'return' ? '\n' : '\t');
          editor.selection.moveCursorToPosition(position);
          editor.clearSelection();
        }}};
      }};
      editor.keyBinding.addKeyboardHandler(handler);
      run.restore.push(() => editor.keyBinding.removeKeyboardHandler(handler));
      return {read() {
        if (editor.session !== session || editor.getReadOnly() || editor.selection.getAllRanges().length !== 1) {
          throw new Error('The editor session, selection, or write permission changed.');
        }
        const range = editor.getSelectionRange();
        const lines = session.getDocument().getAllLines();
        const index = point => lines.slice(0, point.row).reduce((sum, line) => sum + line.length + 1, 0) + point.column;
        return {value: lines.join('\n'), start: index(range.start), end: index(range.end)};
      }};
    }
    const cmNode = element.closest('.CodeMirror');
    if (cmNode) {
      const editor = cmNode.CodeMirror;
      if (!editor) return unsupported('This CodeMirror editor');
      const doc = editor.getDoc();
      for (const [key, value] of Object.entries({smartIndent: false, electricChars: false, autoCloseBrackets: false})) {
        setting(() => editor.getOption(key), value => editor.setOption(key, value), value);
      }
      const extraKeys = {...editor.getOption('extraKeys'),
        Enter: cm => cm.replaceSelection('\n', 'end', '+input'),
        Tab: cm => cm.replaceSelection('\t', 'end', '+input')};
      setting(() => editor.getOption('extraKeys'), value => editor.setOption('extraKeys', value), extraKeys);
      return {read() {
        if (editor.getDoc() !== doc || editor.getOption('readOnly') || doc.listSelections().length !== 1) {
          throw new Error('The editor document, selection, or write permission changed.');
        }
        const selection = doc.listSelections()[0];
        const index = point => doc.getRange({line: 0, ch: 0}, point, '\n').length;
        const a = index(selection.anchor), b = index(selection.head);
        return {value: doc.getValue('\n'), start: Math.min(a, b), end: Math.max(a, b)};
      }};
    }
    if (element.closest('.cm-editor')) return unsupported('This CodeMirror 6 editor');
    if (element instanceof HTMLTextAreaElement ||
        (element instanceof HTMLInputElement && ['text', 'search', 'url', 'tel'].includes(element.type))) {
      if (hasTabs) throw new Error('Native Tab can leave a standard text field. Use Browser editing to preserve literal tabs there. No source text was sent.');
      return {read() {
        if (element.disabled || element.readOnly) throw new Error('The field is read-only or disabled.');
        return {value: element.value, start: element.selectionStart, end: element.selectionEnd};
      }};
    }
    return unsupported('This field');
  };
  // Monaco offsets count the model's CRLF as two units. Compare normalized text
  // so a Windows-style model and the normalized source have identical offsets.
  const offset = (model, position) => model.getValueInRange({startLineNumber: 1, startColumn: 1,
    endLineNumber: position.lineNumber, endColumn: position.column}).replace(/\r\n?/g, '\n').length;
  const session = token => {
    if (!run || run.token !== token) throw new Error('Code-formatting protection expired. Start again.');
    run.lease = Date.now();
    if (!run.element.isConnected || active() !== run.element) throw new Error('The focused field changed.');
    return run;
  };
  self.__meowCodeFormatting = {
    start({token, hasTabs}) {
      stop();
      run = {token, element: active(), restore: [], lease: Date.now()};
      try {
        run.adapter = adapter(run.element, hasTabs);
        run.expected = run.adapter.read();
        run.timer = setInterval(() => { if (run && Date.now() - run.lease > 10000) stop(); }, 1000);
        return true;
      }
      catch (e) { stop(); throw e; }
    },
    prepare({token, character}) {
      const current = session(token);
      const actual = current.adapter.read();
      if (!same(actual, current.expected)) throw new Error('The editor changed the text or cursor. Typing stopped to protect code formatting.');
      const {value, start, end} = actual;
      current.pending = {value: value.slice(0, start) + character + value.slice(end),
        start: start + character.length, end: start + character.length};
      return true;
    },
    verify({token}) {
      const current = session(token);
      const actual = current.adapter.read();
      if (same(actual, current.pending)) {
        current.expected = current.pending;
        return true;
      }
      return false;
    },
    stop
  };
  window.addEventListener('pagehide', () => stop(), true);
  window.addEventListener('keydown', event => { if (event.key === 'Escape') stop(); }, true);
})();
