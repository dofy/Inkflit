#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
test_dir=$(mktemp -d "${TMPDIR%/}/inkflit-native-test.XXXXXX")
test_app="$test_dir/InkflitNativeTest.app"
ditto build/Inkflit.app "$test_app"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier local.seven.quicknote.nativetest.$(basename "$test_dir" | tr -cd '[:alnum:]')" "$test_app/Contents/Info.plist"
swiftc -D INKFLIT_NATIVE_TEST Sources/main.swift Sources/Settings.swift Sources/NoteStorage.swift Sources/Localization.swift tests/NativeCodeEditingTest.swift -o "$test_app/Contents/MacOS/Quicknote" -framework Cocoa -framework WebKit -framework Carbon -framework ServiceManagement
codesign --force --sign - --timestamp=none "$test_app"
for indentation in spaces2 spaces4 tabs; do
  python3 - "$test_dir/notes.json" <<'PY'
import json, sys
with open(sys.argv[1], 'w', encoding='utf-8') as f:
    json.dump({'notes': [{'id': 'test', 'content': ':::quicknote code json\n\n:::end', 'updated': '2026-01-01'}, {'id': 'pairs', 'content': ':::quicknote code json\n\n:::end', 'updated': '2026-01-01'}, {'id': 'plain', 'content': '', 'updated': '2026-01-01'}, {'id': 'gap', 'content': '// comment\n\n:::quicknote code json\n{}\n:::end', 'updated': '2026-01-01'}, {'id': 'open', 'content': ':::quicknote code json\n{}\n:::end', 'updated': '2026-01-01'}, {'id': 'checklist', 'content': ':::quicknote list\nroot\n  parent\napple\n[x] done\n- [ ] task\n:::end', 'updated': '2026-01-01'}], 'selected': 'test'}, f)
PY
  appearance=dark
  if [[ "$indentation" == spaces2 ]]; then appearance=light; fi
  QUICKNOTE_ISOLATED_TEST=1 QUICKNOTE_DATA_PATH="$test_dir/notes.json" INKFLIT_NATIVE_TEST=1 INKFLIT_NATIVE_INDENT="$indentation" INKFLIT_TEST_APPEARANCE="$appearance" python3 - "$test_app/Contents/MacOS/Quicknote" <<'PY'
import subprocess, sys
try:
    result = subprocess.run([sys.argv[1]], timeout=30)
except subprocess.TimeoutExpired:
    sys.exit('FAIL: native test timed out')
if result.returncode:
    sys.exit(result.returncode)
PY
done
python3 - "$test_dir/notes.json" <<'PY'
import json, sys, time
json.dump({'notes':[{'id':'legacy','content':':::quicknote timer\ntimer 5: tea\n:::end','updated':'2026-01-01'}],'selected':'legacy','timer':{'duration':0.3,'rest':0,'title':'legacy','phase':'work','startedAt':time.time()*1000,'elapsed':0,'paused':False,'done':False}},open(sys.argv[1],'w'))
PY
QUICKNOTE_ISOLATED_TEST=1 QUICKNOTE_DATA_PATH="$test_dir/notes.json" INKFLIT_LEGACY_TEST=1 python3 - "$test_app/Contents/MacOS/Quicknote" <<'PY'
import subprocess, sys
try:
    result=subprocess.run([sys.argv[1]], timeout=15)
except subprocess.TimeoutExpired:
    sys.exit('FAIL: legacy note test timed out')
if result.returncode:
    sys.exit(result.returncode)
PY
python3 - "$test_dir/notes.json" <<'PY'
import json, sys
content='// body note\n# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six\n:::quicknote list\n// list note\n:::end\n:::quicknote code js\n// code note\n# code heading\n:::end'
with open(sys.argv[1], 'w', encoding='utf-8') as f:
    json.dump({'notes':[{'id':'test','content':content,'updated':'2026-01-01'}],'selected':'test'}, f)
PY
for appearance in light dark; do
  QUICKNOTE_ISOLATED_TEST=1 QUICKNOTE_DATA_PATH="$test_dir/notes.json" INKFLIT_TYPOGRAPHY_TEST=1 INKFLIT_TEST_APPEARANCE="$appearance" python3 - "$test_app/Contents/MacOS/Quicknote" <<'PY'
import subprocess, sys
try:
    result=subprocess.run([sys.argv[1]], timeout=15)
except subprocess.TimeoutExpired:
    sys.exit('FAIL: native typography test timed out')
if result.returncode:
    sys.exit(result.returncode)
PY
done
python3 - "$test_dir/notes.json" <<'PY'
import json, sys
content='// body note\n# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six'
with open(sys.argv[1], 'w', encoding='utf-8') as f:
    json.dump({'notes':[{'id':'test','content':content,'updated':'2026-01-01'}],'selected':'test'}, f)
PY
QUICKNOTE_ISOLATED_TEST=1 QUICKNOTE_DATA_PATH="$test_dir/notes.json" INKFLIT_TYPOGRAPHY_VIM_TEST=1 python3 - "$test_app/Contents/MacOS/Quicknote" <<'PY'
import subprocess, sys
try:
    result=subprocess.run([sys.argv[1]], timeout=35)
except subprocess.TimeoutExpired:
    sys.exit('FAIL: native typography Vim test timed out')
if result.returncode:
    sys.exit(result.returncode)
PY
mkdir -p "$test_dir/file-storage"
mkdir -p "$test_dir/file-storage/notes" "$test_dir/file-storage/backups" "$test_dir/file-storage/trash"
printf '%s' first > "$test_dir/file-storage/notes/Zmlyc3Q.md"
printf '%s' second > "$test_dir/file-storage/notes/c2Vjb25k.md"
printf '%s' '{"version":1,"notes":[{"id":"first","updated":"1"},{"id":"second","updated":"2"}],"selected":"first"}' > "$test_dir/file-storage/index.json"
QUICKNOTE_ISOLATED_TEST=1 QUICKNOTE_DATA_PATH="$test_dir/file-storage/index.json" INKFLIT_FILE_STORAGE_TEST=1 python3 - "$test_app/Contents/MacOS/Quicknote" <<'PY'
import subprocess, sys
try:
    result=subprocess.run([sys.argv[1]], timeout=20)
except subprocess.TimeoutExpired:
    sys.exit('FAIL: native file storage test timed out')
if result.returncode:
    sys.exit(result.returncode)
PY
