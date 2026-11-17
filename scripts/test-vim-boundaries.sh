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
qa_dir=$(mktemp -d "${TMPDIR%/}/inkflit-vim-boundaries.XXXXXX"); cleanup_dirs+=("$qa_dir")
qa_app="$qa_dir/Test.app"
ditto build/Inkflit.app "$qa_app"
bundle_id="local.seven.inkflit.boundary.$(basename "$qa_dir" | tr -cd '[:alnum:]')"; cleanup_ids+=("$bundle_id")
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $bundle_id" "$qa_app/Contents/Info.plist"
swiftc -D INKFLIT_NATIVE_TEST Sources/main.swift Sources/Automation.swift Sources/Settings.swift Sources/NoteStorage.swift Sources/Localization.swift Sources/Onboarding.swift tests/NativeCodeEditingTest.swift -o "$qa_app/Contents/MacOS/Inkflit" -framework Cocoa -framework WebKit -framework Carbon -framework ServiceManagement
codesign --force --sign - --timestamp=none "$qa_app"
python3 - "$qa_dir/notes.json" <<'PY'
import json,sys
notes=[{'id':'plain','content':'abc','updated':'1'},{'id':'list','content':':::inkflit list\nfirst\n\n:::end','updated':'2'},{'id':'code','content':':::inkflit code json\nfirst\n\n:::end','updated':'3'}]
with open(sys.argv[1],'w') as f:json.dump({'notes':notes,'selected':'plain'},f)
PY
INKFLIT_ISOLATED_TEST=1 INKFLIT_DATA_PATH="$qa_dir/notes.json" INKFLIT_VIM_BOUNDARIES_TEST=1 python3 - "$qa_app/Contents/MacOS/Inkflit" <<'PY'
import subprocess,sys
try: result=subprocess.run([sys.argv[1]],timeout=25)
except subprocess.TimeoutExpired: sys.exit('FAIL: Vim boundary test timed out')
if result.returncode: sys.exit(result.returncode)
PY
