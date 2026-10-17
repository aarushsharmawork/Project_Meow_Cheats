# MeowCheats 1.0

An auto typer with a browser side panel and per-site always-active controls.

## 1. Install the extension

1. Download the project and save it into a permanent folder.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge (version 116 or newer).
3. Enable **Developer mode**, click **Load unpacked**, and select the **v3** folder.
4. Pin **MeowCheats** to the browser toolbar.

Safari is not supported by this package. The simulated keyboard method requires macOS; Browser editing works on supported Chromium browsers without the helper.

## 2. Set up the macOS keyboard helper

1. Open **MeowCheats** once after loading it. It remembers its extension ID in browser storage.
2. In Finder, double-click **native/install.command**. It detects the loaded extension, saves **v3/setup-<extension-ID>.json** inside the extension folder, and connects the helper automatically. No setup file is downloaded.
3. Open MeowCheats → **Keyboard helper** → **Request macOS keyboard permission**. In **System Settings → Privacy & Security → Accessibility**, enable **MeowCheats Keyboard** and the browser if requested. This approval must be given by you.
4. Reopen the browser if needed, then click **Check keyboard helper**. Continue when it confirms permissions are enabled.
5. You are good to go

## 3. Fixing the errors (Optional if any error occur than move ahead)

If building requires Apple’s Command Line Tools, run `xcode-select --install` in Terminal once, then rerun the installer. If detection finds nothing, close and reopen the browser and try again. For custom profiles, use `bash native/install.command YOUR_EXTENSION_ID chrome` (replace `chrome` with `edge` for Edge). Browser editing does not need this setup.

Keep the project in the same location. If you move it or your extension ID changes, run the installer again.

Installed but not connected? Remove **MeowCheats Keyboard** from Accessibility, rerun **native/install.command**, then click **Request macOS keyboard permission** again.

The setup JSON contains a public extension ID, not a password or your text. The installer creates it because Chrome cannot write directly into its own extension folder. These files are ignored by Git; you do not need to edit or publish them.

## 4. Paste your text

1. Open the destination website and click **MeowCheats**.
2. Paste your text into **Your text**. Your draft and settings save automatically.
3. Choose a typing method and set the start delay (default **3 seconds**) and character delays. On macOS, **macOS simulated keyboard** and **Preserve code formatting (Stable)** are the defaults. **Keep this site active** is enabled when you open the panel. Saved formatting choices and custom delays are preserved.
4. Click **Start typing**, then click the destination field before the countdown ends. Keep that browser and field focused.
5. Press **Escape** in the page or click **Stop** to cancel.

If **Preserve code formatting (Unstable)** reports that the editor API is unavailable, you can instead select **Preserve code formatting (Stable)**, shown above it, in keyboard mode. Stable skips complete groups of four leading spaces after each newline and uses the pasted code to send corrective Backspaces when the next nonblank line moves out of a block. Blank lines retain the previous source level. This requires four-space auto-indent. Actual tabs stay unchanged; automatic outdent correction is skipped across tab/mixed indentation. The first line and leftover spaces are retained. It does not read the editor's source or verify the result, so check the destination. Your saved draft stays unchanged. Browser editing inserts the original text.

After updating, double-click **native/install.command** once to rebuild an older keyboard helper for corrective Backspace keys. Runs requiring correction stop before typing if the helper is outdated. If macOS asks, re-enable its Accessibility permission as described above.

Backspace handling is automatic: CodeMirror 5 uses four Backspaces per level; other editors use one. Test a short sample if your editor uses custom key bindings.

Opening the menu or starting typing enables **Keep this site active** for the current website. You can turn it off under **Site controls**. Fullscreen and cursor controls are optional, marked **Unsafe**, and may disrupt website behavior. Reload the webpage after enabling controls for earliest coverage.

**Reduce idle mouse tracking** filters page-wide idle mouse listeners while preserving drags, resizing, touch, pen and element handlers. It cannot stop all tracking or guarantee compatibility with every menu. The panel reports **Limited availability** when a page or frame prevents a control from installing. Fullscreen/cursor-lock blocking refuses requests; it may prevent a site from continuing. Use only one always-active extension at a time to avoid conflicting hooks.

## Shortcuts and panels

- **Command+Shift+U** on Mac / **Ctrl+Shift+U** elsewhere: open or close the side panel.
- **Command+Shift+Y** on Mac / **Ctrl+Shift+Y** elsewhere: start the saved draft; press again to stop the countdown or active typing. Press once more to start a new run.
- Clicking the toolbar icon opens or closes the browser side panel. The right-hand buttons jump to typing settings or site controls. Escape also stops typing.

The extension uses only the browser's side panel; no floating controls are inserted into websites. Browser fullscreen and website policies can still affect panel availability.

## Gemini

1. Open MeowCheats's side panel and click the **Gemini sparkle** button.
2. Click **Enable Gemini** and approve its optional permission. This allows MeowCheats to remove framing and content-security headers only for the Gemini app it embeds.
3. Use your Google account; no API key is needed. If sign-in is required, use **⋯ → Sign in**, then return and select **Reload Gemini**.

Gemini stays loaded when switching views or hiding the panel. Your typing draft is saved and typing stops when opening Gemini; your draft is never sent automatically. Use **⋯ → Disable Gemini** to unload it and revoke its optional permission. Google can still restrict embedded sign-in or connections; the extension does not bypass those checks.

To attach the current webpage, click **Add screenshot**, review the image, then **Attach to Gemini**. The browser side panel is not part of the webpage capture. This does not change your clipboard or send your message. Confirm that Gemini displays an attachment preview before sending. If capture permission has expired, click MeowCheats’s toolbar icon on that webpage and try again.
