#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
test_dir=$(mktemp -d "${TMPDIR%/}/inkflit-vim-test.XXXXXX")
test_app="$test_dir/InkflitVimTest.app"
ditto build/Inkflit.app "$test_app"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier local.seven.inkflit.vimtest.$(basename "$test_dir" | tr -cd '[:alnum:]')" "$test_app/Contents/Info.plist"
swiftc -D INKFLIT_NATIVE_TEST Sources/main.swift Sources/Automation.swift Sources/Settings.swift Sources/NoteStorage.swift Sources/Localization.swift Sources/Onboarding.swift tests/NativeCodeEditingTest.swift -o "$test_app/Contents/MacOS/Inkflit" -framework Cocoa -framework WebKit -framework Carbon -framework ServiceManagement
codesign --force --sign - --timestamp=none "$test_app"
for restart in 0 1; do
  printf '%s' '{"notes":[{"id":"first","content":"","updated":"1"},{"id":"second","content":"","updated":"2"},{"id":"code","content":":::inkflit code json\n\n:::end","updated":"3"}],"selected":"first"}' > "$test_dir/notes.json"
  INKFLIT_ISOLATED_TEST=1 INKFLIT_DATA_PATH="$test_dir/notes.json" INKFLIT_VIM_TOGGLE_TEST=1 INKFLIT_VIM_RESTART_TEST="$restart" python3 - "$test_app/Contents/MacOS/Inkflit" <<'PY'
import subprocess,sys
try:
    result=subprocess.run([sys.argv[1]],timeout=25)
except subprocess.TimeoutExpired:
    sys.exit('FAIL: native Vim toggle test timed out')
if result.returncode:
    sys.exit(result.returncode)
PY
done
