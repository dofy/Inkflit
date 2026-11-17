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
qa_dir=$(mktemp -d "${TMPDIR%/}/inkflit-block-calc.XXXXXX"); cleanup_dirs+=("$qa_dir")
qa_app="$qa_dir/Test.app"
ditto build/Inkflit.app "$qa_app"
bundle_id="local.seven.inkflit.calculation.$(basename "$qa_dir" | tr -cd '[:alnum:]')"; cleanup_ids+=("$bundle_id")
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $bundle_id" "$qa_app/Contents/Info.plist"
swiftc -D INKFLIT_NATIVE_TEST Sources/main.swift Sources/Automation.swift Sources/Settings.swift Sources/NoteStorage.swift Sources/Localization.swift Sources/Onboarding.swift tests/NativeCodeEditingTest.swift -o "$qa_app/Contents/MacOS/Inkflit" -framework Cocoa -framework WebKit -framework Carbon -framework ServiceManagement
codesign --force --sign - --timestamp=none "$qa_app"
python3 - "$qa_dir/notes.json" <<'PY'
import json,sys
notes=[{'id':'first','content':':::inkflit math\nprice: 80\nprice * 2 =\n10 km to mi =\n:::end','updated':'1'}]
with open(sys.argv[1],'w') as f:json.dump({'notes':notes,'selected':'first'},f)
PY
for appearance in light dark; do
INKFLIT_ISOLATED_TEST=1 INKFLIT_TEST_APPEARANCE="$appearance" INKFLIT_DATA_PATH="$qa_dir/notes.json" INKFLIT_BLOCK_CALC_TEST=1 INKFLIT_TEST_UI_LANGUAGE=en python3 - "$qa_app/Contents/MacOS/Inkflit" <<'PY'
import subprocess,sys
try: result=subprocess.run([sys.argv[1]],timeout=20)
except subprocess.TimeoutExpired: sys.exit('FAIL: block calculation test timed out')
if result.returncode: sys.exit(result.returncode)
PY
done
