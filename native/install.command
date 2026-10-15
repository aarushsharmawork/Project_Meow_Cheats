#!/bin/bash
set -euo pipefail
task_native_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
task_binary="$task_native_dir/build/meowtantra Keyboard.app/Contents/MacOS/meowtantra-keyboard"
if [[ ! -x "$task_binary" ]]; then /bin/bash "$task_native_dir/build.command"; fi
task_extension_id="${1:-}"
task_browser="${2:-chrome}"
if [[ -z "$task_extension_id" ]]; then
  task_extension_id="$(osascript -e 'text returned of (display dialog "Paste the extension ID shown in MeowCheats’s macOS keyboard settings (or chrome://extensions)." default answer "" with title "Set up MeowCheats Keyboard")')"
fi
"$task_binary" --install "$task_extension_id" "$task_browser"
printf '\nReload MeowCheats in chrome://extensions, select macOS simulated keyboard, then click Request macOS keyboard permission.\n'
