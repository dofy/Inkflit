#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
qa_dir=$(mktemp -d "${TMPDIR%/}/inkflit-block-calc.XXXXXX")
qa_app="$qa_dir/Test.app"
ditto build/Inkflit.app "$qa_app"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier local.seven.inkflit.calculation.$(basename "$qa_dir" | tr -cd '[:alnum:]')" "$qa_app/Contents/Info.plist"
swiftc -D INKFLIT_NATIVE_TEST Sources/main.swift Sources/Automation.swift Sources/Settings.swift Sources/NoteStorage.swift Sources/Localization.swift Sources/Onboarding.swift tests/NativeCodeEditingTest.swift -o "$qa_app/Contents/MacOS/Inkflit" -framework Cocoa -framework WebKit -framework Carbon -framework ServiceManagement
codesign --force --sign - --timestamp=none "$qa_app"
python3 - "$qa_dir/notes.json" <<'PY'
import json,sys
notes=[{'id':'first','content':':::quicknote math\nprice: 80\nprice * 2 =\n10 km to mi =\n:::end','updated':'1'}]
with open(sys.argv[1],'w') as f:json.dump({'notes':notes,'selected':'first'},f)
PY
for appearance in light dark; do
QUICKNOTE_ISOLATED_TEST=1 INKFLIT_TEST_APPEARANCE="$appearance" QUICKNOTE_DATA_PATH="$qa_dir/notes.json" INKFLIT_BLOCK_CALC_TEST=1 INKFLIT_TEST_UI_LANGUAGE=en python3 - "$qa_app/Contents/MacOS/Inkflit" <<'PY'
import subprocess,sys
try: result=subprocess.run([sys.argv[1]],timeout=20)
except subprocess.TimeoutExpired: sys.exit('FAIL: block calculation test timed out')
if result.returncode: sys.exit(result.returncode)
PY
done
