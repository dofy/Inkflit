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
qa_dir=$(mktemp -d "${TMPDIR%/}/inkflit-toolbar-drag.XXXXXX"); cleanup_dirs+=("$qa_dir")
qa_app="$qa_dir/Test.app"
ditto build/Inkflit.app "$qa_app"
bundle_id="local.seven.inkflit.toolbar.$(basename "$qa_dir" | tr -cd '[:alnum:]')"; cleanup_ids+=("$bundle_id")
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $bundle_id" "$qa_app/Contents/Info.plist"
swiftc -D INKFLIT_NATIVE_TEST Sources/main.swift Sources/Automation.swift Sources/Settings.swift Sources/NoteStorage.swift Sources/Localization.swift Sources/Onboarding.swift tests/NativeCodeEditingTest.swift -o "$qa_app/Contents/MacOS/Inkflit" -framework Cocoa -framework WebKit -framework Carbon -framework ServiceManagement
codesign --force --sign - --timestamp=none "$qa_app"
printf '%s' '{"notes":[{"id":"first","content":"first","updated":"1"},{"id":"second","content":"second","updated":"2"}],"selected":"first"}' > "$qa_dir/notes.json"
for mode in regions real cursor; do
 INKFLIT_ISOLATED_TEST=1 INKFLIT_DATA_PATH="$qa_dir/notes.json" INKFLIT_HEADER_DRAG_TEST="$([[ "$mode" == regions ]] && echo 1 || echo 0)" INKFLIT_REAL_DRAG_TEST="$([[ "$mode" == real ]] && echo 1 || echo 0)" INKFLIT_TOOLBAR_CURSOR_TEST="$([[ "$mode" == cursor ]] && echo 1 || echo 0)" python3 - "$qa_app/Contents/MacOS/Inkflit" <<'PY'
import subprocess,sys
try: result=subprocess.run([sys.argv[1]],timeout=20)
except subprocess.TimeoutExpired: sys.exit('FAIL: toolbar test timed out')
if result.returncode: sys.exit(result.returncode)
PY
done
