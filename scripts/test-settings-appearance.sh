#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/native-test-common.sh
setup_native_test inkflit-settings-test settings Test.app
run_settings_test() {
 env INKFLIT_ISOLATED_TEST=1 INKFLIT_DATA_PATH="$test_dir/notes.json" INKFLIT_SETTINGS_ACCENT_TEST=1 INKFLIT_TEST_APPEARANCE="$appearance" "$@" python3 - "$test_app/Contents/MacOS/Inkflit" <<'PY'
import subprocess,sys
try: result=subprocess.run([sys.argv[1]],timeout=20)
except subprocess.TimeoutExpired: sys.exit('FAIL: settings test timed out')
if result.returncode: sys.exit(result.returncode)
PY
}
for appearance in light dark; do
 printf '%s' '{"notes":[{"id":"test","content":":::inkflit code json\n{\"name\":\"Inkflit\"}\n:::end","updated":"1"}],"selected":"test"}' > "$test_dir/notes.json"
 run_settings_test INKFLIT_SETTINGS_CAPTURE="$test_dir/settings-$appearance.png" INKFLIT_TEST_COLOR_SCHEME_RESTART=1
 if [[ "$appearance" == light ]]; then expected=dark; else expected=light; fi
 run_settings_test INKFLIT_TEST_EXPECT_COLOR_SCHEME="$expected"
done
run_settings_test INKFLIT_SETTINGS_ACCENT_TEST=0 INKFLIT_NOTE_PAPER_TEST=1

appearance=light
for restart in 0 1; do
 printf '%s' '{"notes":[{"id":"numbers","content":"intro\n:::inkflit code js\nfirst()\n\nsecond()\nthird()\n:::end\nplain text\n```js\nfenced()\nend()\n```\n:::inkflit math\n1+2=\n:::end","updated":"1"},{"id":"whole-code","content":"code js\none()\ntwo()\nthree()","updated":"2"}],"selected":"numbers"}' > "$test_dir/notes.json"
 run_settings_test INKFLIT_SETTINGS_ACCENT_TEST=0 INKFLIT_CODE_LINE_NUMBERS_TEST=1 INKFLIT_TEST_NUMBER_PREFS_RESTART="$restart"
done
