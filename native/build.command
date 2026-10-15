#!/bin/bash
set -euo pipefail
task_native_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
task_app="$task_native_dir/build/meowtantra Keyboard.app"
task_module_cache="$(mktemp -d "${TMPDIR:-/tmp}/meowcheats-swift-cache.XXXXXX")"
trap 'rm -rf -- "$task_module_cache"' EXIT
mkdir -p "$task_app/Contents/MacOS"
xcrun swiftc -O -module-cache-path "$task_module_cache" "$task_native_dir/KeyboardHost.swift" -o "$task_app/Contents/MacOS/meowtantra-keyboard"
cat > "$task_app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.meowtantra.keyboard</string>
<key>CFBundleName</key><string>MeowCheats Keyboard</string>
<key>CFBundleExecutable</key><string>meowtantra-keyboard</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSBackgroundOnly</key><true/>
</dict></plist>
PLIST
codesign --force --sign - --identifier com.meowtantra.keyboard "$task_app"
"$task_app/Contents/MacOS/meowtantra-keyboard" --self-test
printf 'Built: %s\n' "$task_app"
