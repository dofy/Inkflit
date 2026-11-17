#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
qa_dir=$(mktemp -d "${TMPDIR%/}/inkflit-delete.XXXXXX")
qa_app="$qa_dir/Test.app"
ditto build/Inkflit.app "$qa_app"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier local.seven.inkflit.delete.$(basename "$qa_dir" | tr -cd '[:alnum:]')" "$qa_app/Contents/Info.plist"
swiftc -D INKFLIT_NATIVE_TEST Sources/main.swift Sources/Automation.swift Sources/Settings.swift Sources/NoteStorage.swift Sources/Localization.swift Sources/Onboarding.swift tests/NativeCodeEditingTest.swift -o "$qa_app/Contents/MacOS/Inkflit" -framework Cocoa -framework WebKit -framework Carbon -framework ServiceManagement
codesign --force --sign - --timestamp=none "$qa_app"
python3 - "$qa_dir/store" <<'PY'
import pathlib,json,base64,sys
p=pathlib.Path(sys.argv[1]);[(p/n).mkdir(parents=True,exist_ok=True) for n in ('notes','backups','trash')]
notes=[{'id':c,'content':text,'updated':'1'} for c,text in [('a','alpha'),('b','beta'),('c','gamma')]]
for n in notes:(p/'notes'/(base64.urlsafe_b64encode(n['id'].encode()).decode().rstrip('=')+'.md')).write_text(n['content'])
(p/'index.json').write_text(json.dumps({'version':1,'notes':[{'id':n['id'],'updated':n['updated']} for n in notes],'selected':'a'}))
PY
INKFLIT_ISOLATED_TEST=1 INKFLIT_FILE_STORAGE_TEST=1 INKFLIT_DATA_PATH="$qa_dir/store/index.json" INKFLIT_DELETE_NOTICES_TEST=1 python3 - "$qa_app/Contents/MacOS/Inkflit" <<'PY'
import subprocess,sys
try: result=subprocess.run([sys.argv[1]],timeout=30)
except subprocess.TimeoutExpired: sys.exit('FAIL: deletion notice test timed out')
if result.returncode: sys.exit(result.returncode)
PY
