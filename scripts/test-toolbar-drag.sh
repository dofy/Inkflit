#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
qa_dir=$(mktemp -d "${TMPDIR%/}/inkflit-toolbar-drag.XXXXXX")
qa_app="$qa_dir/Test.app"
ditto build/Inkflit.app "$qa_app"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier local.seven.inkflit.toolbar.$(basename "$qa_dir" | tr -cd '[:alnum:]')" "$qa_app/Contents/Info.plist"
swiftc -D INKFLIT_NATIVE_TEST Sources/main.swift Sources/DefaultsMigration.swift Sources/Automation.swift Sources/Settings.swift Sources/NoteStorage.swift Sources/Localization.swift Sources/Onboarding.swift tests/NativeCodeEditingTest.swift -o "$qa_app/Contents/MacOS/Inkflit" -framework Cocoa -framework WebKit -framework Carbon -framework ServiceManagement
codesign --force --sign - --timestamp=none "$qa_app"
printf '%s' '{"notes":[{"id":"first","content":"first","updated":"1"},{"id":"second","content":"second","updated":"2"}],"selected":"first"}' > "$qa_dir/notes.json"
for mode in regions real cursor; do
 QUICKNOTE_ISOLATED_TEST=1 QUICKNOTE_DATA_PATH="$qa_dir/notes.json" INKFLIT_HEADER_DRAG_TEST="$([[ "$mode" == regions ]] && echo 1 || echo 0)" INKFLIT_REAL_DRAG_TEST="$([[ "$mode" == real ]] && echo 1 || echo 0)" INKFLIT_TOOLBAR_CURSOR_TEST="$([[ "$mode" == cursor ]] && echo 1 || echo 0)" python3 - "$qa_app/Contents/MacOS/Inkflit" <<'PY'
import subprocess,sys
try: result=subprocess.run([sys.argv[1]],timeout=20)
except subprocess.TimeoutExpired: sys.exit('FAIL: toolbar test timed out')
if result.returncode: sys.exit(result.returncode)
PY
done
