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
test_dir=$(mktemp -d "${TMPDIR%/}/inkflit-vim-test.XXXXXX"); cleanup_dirs+=("$test_dir")
test_app="$test_dir/InkflitVimTest.app"
ditto build/Inkflit.app "$test_app"
bundle_id="local.seven.inkflit.vimtest.$(basename "$test_dir" | tr -cd '[:alnum:]')"; cleanup_ids+=("$bundle_id")
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $bundle_id" "$test_app/Contents/Info.plist"
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
