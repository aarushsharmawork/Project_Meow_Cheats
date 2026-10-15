#!/bin/bash
set -euo pipefail
task_native_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
task_binary="$task_native_dir/build/meowtantra Keyboard.app/Contents/MacOS/meowtantra-keyboard"
task_detect_only=false
if [[ "${1:-}" == '--detect-only' ]]; then
  task_detect_only=true
  shift
fi
if [[ $# -gt 2 ]]; then
  printf 'Usage: install.command [EXTENSION_ID [chrome|edge|chromium|testing]]\n' >&2
  exit 1
fi
if [[ -n "${1:-}" ]]; then
  task_extension_id="$1"
  task_browser="${2:-chrome}"
  if [[ ! "$task_extension_id" =~ ^[a-p]{32}$ ]]; then
    printf 'Invalid extension ID. Copy the 32-letter ID from the MeowCheats menu.\n' >&2
    exit 1
  fi
  case "$task_browser" in
    chrome|edge|chromium|testing) ;;
    *) printf 'Supported browsers: chrome, edge, chromium, testing.\n' >&2; exit 1 ;;
  esac
  task_matches="$(printf '%s\t%s' "$task_browser" "$task_extension_id")"
else
  task_support_dir="${MEOWCHEATS_PROFILE_ROOT:-$HOME/Library/Application Support}"
  task_matches="$(/usr/bin/osascript -l JavaScript "$task_native_dir/detect-extension.js" "$task_native_dir/../v3" "$task_support_dir")"
  if [[ -z "$task_matches" ]]; then
    printf 'Load this project’s v3 folder in Chrome or Edge and open MeowCheats, then run this installer again.\nIf it was just loaded, close and reopen the browser so its profile settings are saved.\nFor a custom browser profile, use: bash native/install.command EXTENSION_ID chrome\n' >&2
    exit 1
  fi
fi
if [[ "$task_detect_only" == true ]]; then
  printf '%s\n' "$task_matches"
  exit 0
fi
if [[ ! -x "$task_binary" ]]; then
  if ! /usr/bin/xcode-select -p >/dev/null 2>&1; then
    printf 'Apple’s Command Line Tools are needed to build the helper.\nRun xcode-select --install in Terminal, complete Apple’s installer, then double-click this file again.\n' >&2
    exit 1
  fi
  printf 'Building the keyboard helper…\n'
  /bin/bash "$task_native_dir/build.command"
fi
while IFS=$'\t' read -r task_browser task_extension_id; do
  /usr/bin/osascript -l JavaScript "$task_native_dir/save-setup.js" "$task_native_dir/../v3" "$task_extension_id"
  "$task_binary" --install "$task_extension_id" "$task_browser"
done <<< "$task_matches"
printf '\nSetup complete. Open MeowCheats → Keyboard helper → Request macOS keyboard permission.\nApprove access in macOS Accessibility settings, then click Check keyboard helper.\n'
