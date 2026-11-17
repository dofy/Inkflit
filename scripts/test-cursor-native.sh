#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
case_dir=$(mktemp -d "${TMPDIR%/}/inkflit-cursor-test.XXXXXX")
test_app="$case_dir/InkflitCursorTest.app"
ditto build/Inkflit.app "$test_app"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier local.seven.quicknote.cursortest.$(basename "$case_dir" | tr -cd '[:alnum:]')" "$test_app/Contents/Info.plist"
swiftc -D INKFLIT_NATIVE_TEST Sources/main.swift Sources/Automation.swift Sources/Settings.swift Sources/NoteStorage.swift Sources/Localization.swift tests/NativeCodeEditingTest.swift -o "$test_app/Contents/MacOS/Inkflit" -framework Cocoa -framework WebKit -framework Carbon -framework ServiceManagement
codesign --force --sign - --timestamp=none "$test_app"
for appearance in light dark; do
  printf '%s\n' '{"notes":[{"id":"test","content":"hello","updated":"2026-01-01"}],"selected":"test"}' > "$case_dir/notes.json"
  QUICKNOTE_ISOLATED_TEST=1 QUICKNOTE_DATA_PATH="$case_dir/notes.json" INKFLIT_CURSOR_TEST=1 INKFLIT_TEST_APPEARANCE="$appearance" python3 - "$test_app/Contents/MacOS/Inkflit" <<'PY'
import subprocess, sys
try:
    result = subprocess.run([sys.argv[1]], timeout=15)
except subprocess.TimeoutExpired:
    sys.exit('FAIL: native cursor test timed out')
if result.returncode:
    sys.exit(result.returncode)
PY
done
