# MeowCheats

An auto typer with a floating panel, browser side panel, and per-site always-active controls.

## 1. Install the extension

1. Download the project and save it into a permanent folder.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge (version 116 or newer).
3. Enable **Developer mode**, click **Load unpacked**, and select the **v3** folder.
4. Pin **MeowCheats** to the browser toolbar.

Safari is not supported by this package. The simulated keyboard method requires macOS; Browser editing works on supported Chromium browsers without the helper.

## 2. Set up the macOS keyboard helper

1. Copy MeowCheats’s extension ID from the browser’s extensions page.
2. Double-click `native/install.command` and enter that ID. It builds the helper if needed. If Apple’s Command Line Tools are missing, run `xcode-select --install` in Terminal first. For Edge, run `bash native/install.command YOUR_EXTENSION_ID edge` from the project folder instead.
3. Open MeowCheats, select **macOS simulated keyboard**, then open **Keyboard helper** → **Request macOS keyboard permission**. In **System Settings → Privacy & Security → Accessibility**, enable the helper and browser if requested. The helper may appear as **MeowCheats Keyboard** or **meowtantra Keyboard**.
4. Reopen the browser if needed, then click **Check keyboard helper**. Continue when it confirms permissions are enabled.

Keep the project in the same location. If you move it or your extension ID changes, run the installer again.

## 3. Paste your text

1. Open the destination website and click **MeowCheats**.
2. Paste your text into **Your text**. Your draft and settings save automatically.
3. Choose a typing method and set the start delay and character delays. On macOS, **macOS simulated keyboard** is the default. Leave **Preserve code formatting** enabled for supported code editors.
4. Click **Start typing**, then click the destination field before the countdown ends. Keep that browser and field focused.
5. Press **Escape** in the page or click **Stop** to cancel.

Opening the menu or starting typing enables **Keep this site active** for the current website. You can turn it off under **Site controls**. Fullscreen and cursor controls are optional, marked **Unsafe**, and may disrupt website behavior. Reload the webpage after enabling controls for earliest coverage.

## Shortcuts and panels

- **Command+Shift+U** on Mac / **Ctrl+Shift+U** elsewhere: show or hide the floating panel.
- **Command+Shift+Y** on Mac / **Ctrl+Shift+Y** elsewhere: start the saved draft.
- Use the header buttons to open the side panel or floating panel. The right-hand buttons jump to typing settings or site controls.
- If shortcuts do not work, assign them at `chrome://extensions/shortcuts` or `edge://extensions/shortcuts`.

After updating the files, reload MeowCheats on the extensions page, reload the website, and reopen the panel. Website compatibility varies; simulated keys do not guarantee acceptance or undetectability.

## Development files

`test/` contains optional automated checks and practice pages. It is not loaded by the extension and is ignored by Git; keeping or removing it does not affect normal use. The separate `v3/data/inject/test.js` is a runtime site-validation check and must remain included.

Tests require development dependencies only when run manually. Users do not need Node.js, Playwright, or Python packages to use the extension. The macOS helper uses Apple’s system frameworks. Generated helper builds, local secrets, caches, and test reports are also ignored by Git.
