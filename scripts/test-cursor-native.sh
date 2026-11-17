#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Each run uses a throwaway bundle ID and folder; remove both when the script exits.
cleanup_ids=(); cleanup_dirs=()
cleanup() {
  for id in ${cleanup_ids[@]+"${cleanup_ids[@]}"}; do defaults delete "$id" >/dev/null 2>&1; rm -f "$HOME/Library/Preferences/$id.plist"; done
  for dir in ${cleanup_dirs[@]+"${cleanup_dirs[@]}"}; do rm -rf "$dir"; done
}
trap cleanup EXIT
npm run build
case_dir=$(mktemp -d "${TMPDIR%/}/inkflit-cursor-test.XXXXXX"); cleanup_dirs+=("$case_dir")
test_app="$case_dir/InkflitCursorTest.app"
ditto build/Inkflit.app "$test_app"
bundle_id="local.seven.inkflit.cursortest.$(basename "$case_dir" | tr -cd '[:alnum:]')"; cleanup_ids+=("$bundle_id")
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $bundle_id" "$test_app/Contents/Info.plist"
swiftc -D INKFLIT_NATIVE_TEST Sources/main.swift Sources/Automation.swift Sources/Settings.swift Sources/NoteStorage.swift Sources/Localization.swift tests/NativeCodeEditingTest.swift -o "$test_app/Contents/MacOS/Inkflit" -framework Cocoa -framework WebKit -framework Carbon -framework ServiceManagement
codesign --force --sign - --timestamp=none "$test_app"
for appearance in light dark; do
  printf '%s\n' '{"notes":[{"id":"test","content":"hello","updated":"2026-01-01"}],"selected":"test"}' > "$case_dir/notes.json"
  INKFLIT_ISOLATED_TEST=1 INKFLIT_DATA_PATH="$case_dir/notes.json" INKFLIT_CURSOR_TEST=1 INKFLIT_TEST_APPEARANCE="$appearance" python3 - "$test_app/Contents/MacOS/Inkflit" <<'PY'
import subprocess, sys
try:
    result = subprocess.run([sys.argv[1]], timeout=15)
except subprocess.TimeoutExpired:
    sys.exit('FAIL: native cursor test timed out')
if result.returncode:
    sys.exit(result.returncode)
PY
done
