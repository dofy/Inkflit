#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
test_dir=$(mktemp -d "${TMPDIR%/}/inkflit-native-test.XXXXXX")
test_app="$test_dir/InkflitNativeTest.app"
ditto build/Inkflit.app "$test_app"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier local.seven.quicknote.nativetest.$(basename "$test_dir" | tr -cd '[:alnum:]')" "$test_app/Contents/Info.plist"
swiftc -D INKFLIT_NATIVE_TEST Sources/main.swift Sources/Settings.swift Sources/NoteStorage.swift Sources/Localization.swift Sources/Onboarding.swift tests/NativeCodeEditingTest.swift -o "$test_app/Contents/MacOS/Quicknote" -framework Cocoa -framework WebKit -framework Carbon -framework ServiceManagement
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
for appearance in light dark; do
  for theme in orange blue green; do
    python3 - "$test_dir/notes.json" <<'PY'
import json, sys
with open(sys.argv[1], 'w', encoding='utf-8') as f:
    json.dump({'notes':[{'id':'test','content':'// body note','updated':'2026-01-01'}],'selected':'test'}, f)
PY
    QUICKNOTE_ISOLATED_TEST=1 QUICKNOTE_DATA_PATH="$test_dir/notes.json" INKFLIT_COMMENT_VIM_TEST=1 INKFLIT_TEST_UI_THEME="$theme" INKFLIT_TEST_APPEARANCE="$appearance" python3 - "$test_app/Contents/MacOS/Quicknote" <<'PY'
import subprocess, sys
try:
    result=subprocess.run([sys.argv[1]], timeout=15)
except subprocess.TimeoutExpired:
    sys.exit('FAIL: native comment Vim test timed out')
if result.returncode:
    sys.exit(result.returncode)
PY
  done
done
python3 - "$test_dir/notes.json" <<'PY'
import json, sys
content='// first\n// second\n// third\n:::quicknote code js\n// code comment\nconst x = 3;\n:::end\n// after code\n// next\n:::quicknote list\n// inside list\napple\n:::end\n// after list'
with open(sys.argv[1], 'w', encoding='utf-8') as f:
    json.dump({'notes':[{'id':'test','content':content,'updated':'2026-01-01'}],'selected':'test'}, f)
PY
for appearance in light dark; do
  QUICKNOTE_ISOLATED_TEST=1 QUICKNOTE_DATA_PATH="$test_dir/notes.json" INKFLIT_COMMENT_LAYOUT_TEST=1 INKFLIT_TEST_APPEARANCE="$appearance" python3 - "$test_app/Contents/MacOS/Quicknote" <<'PY'
import subprocess, sys
try:
    result=subprocess.run([sys.argv[1]], timeout=15)
except subprocess.TimeoutExpired:
    sys.exit('FAIL: native comment layout test timed out')
if result.returncode:
    sys.exit(result.returncode)
PY
done
QUICKNOTE_ISOLATED_TEST=1 QUICKNOTE_DATA_PATH="$test_dir/notes.json" INKFLIT_COMMENT_GROUP_VIM_TEST=1 python3 - "$test_app/Contents/MacOS/Quicknote" <<'PY'
import subprocess, sys
try:
    result=subprocess.run([sys.argv[1]], timeout=15)
except subprocess.TimeoutExpired:
    sys.exit('FAIL: native grouped comment Vim test timed out')
if result.returncode:
    sys.exit(result.returncode)
PY
python3 - "$test_dir/notes.json" <<'PY'
import json, sys
notes=[{'id':'nav','content':':::quicknote sum\n12\n\n:::end\nplain','updated':'1'},{'id':'enter','content':':::quicknote sum\n12\n:::end','updated':'2'}]
with open(sys.argv[1], 'w', encoding='utf-8') as f:
    json.dump({'notes':notes,'selected':'nav'},f)
PY
QUICKNOTE_ISOLATED_TEST=1 QUICKNOTE_DATA_PATH="$test_dir/notes.json" INKFLIT_BLOCK_BOUNDARY_TEST=1 python3 - "$test_app/Contents/MacOS/Quicknote" <<'PY'
import subprocess, sys
try:
    result=subprocess.run([sys.argv[1]], timeout=20)
except subprocess.TimeoutExpired:
    sys.exit('FAIL: native block boundary test timed out')
if result.returncode:
    sys.exit(result.returncode)
PY
python3 - "$test_dir/notes.json" <<'PY'
import json, sys
notes=[{'id':'feature','content':':::quicknote sum\n12\n:::end','updated':'1'},{'id':'plain','content':'','updated':'2'}]
with open(sys.argv[1], 'w', encoding='utf-8') as f:
    json.dump({'notes':notes,'selected':'feature'},f)
PY
QUICKNOTE_ISOLATED_TEST=1 QUICKNOTE_DATA_PATH="$test_dir/notes.json" INKFLIT_PLAIN_TEXT_TEST=1 python3 - "$test_app/Contents/MacOS/Quicknote" <<'PY'
import subprocess, sys
try:
    result=subprocess.run([sys.argv[1]], timeout=20)
except subprocess.TimeoutExpired:
    sys.exit('FAIL: native plain-text conversion test timed out')
if result.returncode:
    sys.exit(result.returncode)
PY
for scenario in AUTOSAVE AUTOSAVE_STREAM; do
  data_dir="$test_dir/$scenario"
  mkdir -p "$data_dir/notes" "$data_dir/backups" "$data_dir/trash"
  printf '%s' one > "$data_dir/notes/Zmlyc3Q.md"
  printf '%s' two > "$data_dir/notes/c2Vjb25k.md"
  printf '%s' '{"version":1,"notes":[{"id":"first","updated":"1"},{"id":"second","updated":"2"}],"selected":"first"}' > "$data_dir/index.json"
  env QUICKNOTE_ISOLATED_TEST=1 QUICKNOTE_DATA_PATH="$data_dir/index.json" INKFLIT_FILE_STORAGE_TEST=1 "INKFLIT_${scenario}_TEST=1" python3 - "$test_app/Contents/MacOS/Quicknote" "$data_dir" "$scenario" <<'PY'
import pathlib, subprocess, sys
try:
    result=subprocess.run([sys.argv[1]],timeout=25)
except subprocess.TimeoutExpired:
    sys.exit('FAIL: native autosave test timed out')
if result.returncode:
    sys.exit(result.returncode)
root=pathlib.Path(sys.argv[2]); first=(root/'notes'/'Zmlyc3Q.md').read_text(); second=(root/'notes'/'c2Vjb25k.md').read_text()
expected=('abcdone','xyztwo') if sys.argv[3]=='AUTOSAVE' else ('x'*15+'one','two')
if (first,second)!=expected:
    sys.exit('FAIL: final saved content differs after quit')
print('PASS final saved content after',sys.argv[3])
PY
done
for locale in en-US zh-CN zh-TW ja-JP fr-FR; do
  data_dir="$test_dir/onboarding-$locale"
  mkdir -p "$data_dir"
  QUICKNOTE_ISOLATED_TEST=1 QUICKNOTE_DATA_PATH="$data_dir/index.json" INKFLIT_FILE_STORAGE_TEST=1 INKFLIT_ONBOARDING_TEST=1 INKFLIT_ONBOARDING_LOCALE_ONLY=1 INKFLIT_TEST_SYSTEM_LANGUAGE="$locale" python3 - "$test_app/Contents/MacOS/Quicknote" <<'PY'
import subprocess, sys
try:
    result=subprocess.run([sys.argv[1]],timeout=15)
except subprocess.TimeoutExpired:
    sys.exit('FAIL: native onboarding locale test timed out')
if result.returncode:
    sys.exit(result.returncode)
PY
done
data_dir="$test_dir/onboarding-regeneration"
mkdir -p "$data_dir"
QUICKNOTE_ISOLATED_TEST=1 QUICKNOTE_DATA_PATH="$data_dir/index.json" INKFLIT_FILE_STORAGE_TEST=1 INKFLIT_ONBOARDING_TEST=1 INKFLIT_TEST_SYSTEM_LANGUAGE=ja-JP INKFLIT_TEST_UI_LANGUAGE=en python3 - "$test_app/Contents/MacOS/Quicknote" <<'PY'
import subprocess, sys
try:
    result=subprocess.run([sys.argv[1]],timeout=30)
except subprocess.TimeoutExpired:
    sys.exit('FAIL: native onboarding regeneration test timed out')
if result.returncode:
    sys.exit(result.returncode)
PY
python3 - "$test_dir/onboarding-en-US/index.json" "$test_dir/onboarding-original-ids.json" <<'PY'
import json,sys
index=json.load(open(sys.argv[1]));json.dump([note['id'] for note in index['notes']],open(sys.argv[2],'w'))
PY
QUICKNOTE_ISOLATED_TEST=1 QUICKNOTE_DATA_PATH="$test_dir/onboarding-en-US/index.json" INKFLIT_FILE_STORAGE_TEST=1 INKFLIT_ONBOARDING_TEST=1 INKFLIT_ONBOARDING_LOCALE_ONLY=1 INKFLIT_TEST_SYSTEM_LANGUAGE=ja-JP INKFLIT_TEST_EXPECT_LANGUAGE=en python3 - "$test_app/Contents/MacOS/Quicknote" <<'PY'
import subprocess, sys
try:
    result=subprocess.run([sys.argv[1]],timeout=15)
except subprocess.TimeoutExpired:
    sys.exit('FAIL: native onboarding restart test timed out')
if result.returncode:
    sys.exit(result.returncode)
PY
python3 - "$test_dir/onboarding-en-US/index.json" "$test_dir/onboarding-original-ids.json" <<'PY'
import json,sys
index=json.load(open(sys.argv[1]));original=json.load(open(sys.argv[2]))
if [note['id'] for note in index['notes']]!=original:sys.exit('FAIL: restart changed existing guide notes')
print('PASS restart preserves existing note IDs and language')
PY
collision_dir="$test_dir/onboarding-conflict"
mkdir -p "$collision_dir/notes"
printf '%s' 'existing data' > "$collision_dir/notes/existing.md"
QUICKNOTE_ISOLATED_TEST=1 QUICKNOTE_DATA_PATH="$collision_dir/index.json" INKFLIT_FILE_STORAGE_TEST=1 INKFLIT_ONBOARDING_TEST=1 INKFLIT_ONBOARDING_COLLISION_TEST=1 python3 - "$test_app/Contents/MacOS/Quicknote" <<'PY'
import subprocess,sys
try:
    result=subprocess.run([sys.argv[1]],timeout=15)
except subprocess.TimeoutExpired:
    sys.exit('FAIL: native onboarding conflict test timed out')
if result.returncode:
    sys.exit(result.returncode)
PY
for appearance in light dark; do
  python3 - "$test_dir/notes.json" <<'PY'
import json,sys
content='# Title\nShortcut ⌘[ / ⌘]\n**粗體** and [link](https://example.com)\n:::quicknote code json\n{"name":"value","enabled":true}\n:::end'
notes=[{'id':'first','content':content,'updated':'1'},{'id':'second','content':'second','updated':'2'},{'id':'third','content':'third','updated':'3'}]
with open(sys.argv[1],'w',encoding='utf8') as f:json.dump({'notes':notes,'selected':'first'},f,ensure_ascii=False)
PY
  QUICKNOTE_ISOLATED_TEST=1 QUICKNOTE_DATA_PATH="$test_dir/notes.json" INKFLIT_READING_NAV_TEST=1 INKFLIT_TEST_APPEARANCE="$appearance" python3 - "$test_app/Contents/MacOS/Quicknote" <<'PY'
import subprocess,sys
try:
    result=subprocess.run([sys.argv[1]],timeout=20)
except subprocess.TimeoutExpired:
    sys.exit('FAIL: native reading and navigation test timed out')
if result.returncode:
    sys.exit(result.returncode)
PY
done
