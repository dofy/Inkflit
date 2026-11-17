#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
qa_dir=$(mktemp -d "${TMPDIR%/}/inkflit-placement.XXXXXX")
qa_app="$qa_dir/Test.app"
ditto build/Inkflit.app "$qa_app"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier local.seven.inkflit.placement.$(basename "$qa_dir" | tr -cd '[:alnum:]')" "$qa_app/Contents/Info.plist"
swiftc -D INKFLIT_NATIVE_TEST Sources/main.swift Sources/Automation.swift Sources/Settings.swift Sources/NoteStorage.swift Sources/Localization.swift Sources/Onboarding.swift tests/NativeCodeEditingTest.swift -o "$qa_app/Contents/MacOS/Inkflit" -framework Cocoa -framework WebKit -framework Carbon -framework ServiceManagement
codesign --force --sign - --timestamp=none "$qa_app"
printf '%s' '{"notes":[{"id":"first","content":"test","updated":"1"}],"selected":"first"}' > "$qa_dir/notes.json"
for restart in 0 1 legacy v2; do
 QUICKNOTE_ISOLATED_TEST=1 QUICKNOTE_DATA_PATH="$qa_dir/notes.json" INKFLIT_PLACEMENT_TEST=1 INKFLIT_PLACEMENT_RESTART="$restart" python3 - "$qa_app/Contents/MacOS/Inkflit" <<'PY'
import subprocess,sys
try: result=subprocess.run([sys.argv[1]],timeout=25)
except subprocess.TimeoutExpired: sys.exit('FAIL: placement test timed out')
if result.returncode: sys.exit(result.returncode)
PY
done
