#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
test_dir=$(mktemp -d "${TMPDIR%/}/inkflit-native-test.XXXXXX")
test_app="$test_dir/InkflitNativeTest.app"
ditto build/Inkflit.app "$test_app"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier local.seven.quicknote.nativetest.$(basename "$test_dir" | tr -cd '[:alnum:]')" "$test_app/Contents/Info.plist"
swiftc -D INKFLIT_NATIVE_TEST Sources/main.swift Sources/Settings.swift Sources/NoteStorage.swift tests/NativeCodeEditingTest.swift -o "$test_app/Contents/MacOS/Quicknote" -framework Cocoa -framework WebKit -framework Carbon -framework ServiceManagement
codesign --force --sign - --timestamp=none "$test_app"
for indentation in spaces2 spaces4 tabs; do
  python3 - "$test_dir/notes.json" <<'PY'
import json, sys
with open(sys.argv[1], 'w', encoding='utf-8') as f:
    json.dump({'notes': [{'id': 'test', 'content': ':::quicknote code json\n\n:::end', 'updated': '2026-01-01'}, {'id': 'pairs', 'content': ':::quicknote code json\n\n:::end', 'updated': '2026-01-01'}, {'id': 'plain', 'content': '', 'updated': '2026-01-01'}], 'selected': 'test'}, f)
PY
  QUICKNOTE_ISOLATED_TEST=1 QUICKNOTE_DATA_PATH="$test_dir/notes.json" INKFLIT_NATIVE_TEST=1 INKFLIT_NATIVE_INDENT="$indentation" python3 - "$test_app/Contents/MacOS/Quicknote" <<'PY'
import subprocess, sys
try:
    result = subprocess.run([sys.argv[1]], timeout=30)
except subprocess.TimeoutExpired:
    sys.exit('FAIL: native test timed out')
if result.returncode:
    sys.exit(result.returncode)
PY
done
