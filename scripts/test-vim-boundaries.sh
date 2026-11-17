#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
qa_dir=$(mktemp -d "${TMPDIR%/}/inkflit-vim-boundaries.XXXXXX")
qa_app="$qa_dir/Test.app"
ditto build/Inkflit.app "$qa_app"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier local.seven.inkflit.boundary.$(basename "$qa_dir" | tr -cd '[:alnum:]')" "$qa_app/Contents/Info.plist"
swiftc -D INKFLIT_NATIVE_TEST Sources/main.swift Sources/Automation.swift Sources/Settings.swift Sources/NoteStorage.swift Sources/Localization.swift Sources/Onboarding.swift tests/NativeCodeEditingTest.swift -o "$qa_app/Contents/MacOS/Inkflit" -framework Cocoa -framework WebKit -framework Carbon -framework ServiceManagement
codesign --force --sign - --timestamp=none "$qa_app"
python3 - "$qa_dir/notes.json" <<'PY'
import json,sys
notes=[{'id':'plain','content':'abc','updated':'1'},{'id':'list','content':':::quicknote list\nfirst\n\n:::end','updated':'2'},{'id':'code','content':':::quicknote code json\nfirst\n\n:::end','updated':'3'}]
with open(sys.argv[1],'w') as f:json.dump({'notes':notes,'selected':'plain'},f)
PY
QUICKNOTE_ISOLATED_TEST=1 QUICKNOTE_DATA_PATH="$qa_dir/notes.json" INKFLIT_VIM_BOUNDARIES_TEST=1 python3 - "$qa_app/Contents/MacOS/Inkflit" <<'PY'
import subprocess,sys
try: result=subprocess.run([sys.argv[1]],timeout=25)
except subprocess.TimeoutExpired: sys.exit('FAIL: Vim boundary test timed out')
if result.returncode: sys.exit(result.returncode)
PY
