#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/native-test-common.sh
setup_native_test inkflit-block-calc calculation Test.app
for appearance in light dark; do
python3 - "$test_dir/notes.json" <<'PY'
import json,sys
notes=[
    {'id':'first','content':':::inkflit math\nprice: 80\nprice * 2 =\n10 km to mi =\n:::end','updated':'1'},
    {'id':'style','content':':::inkflit code javascript\nconst price = 80;\nprice * 2;\n:::end\n:::inkflit math\nprice: 80\nprice * 2 =\n10 USD to EUR =\n10 km to mi =\n:::end','updated':'1'},
]
with open(sys.argv[1],'w') as f:json.dump({'notes':notes,'selected':'first'},f)
PY
INKFLIT_ISOLATED_TEST=1 INKFLIT_TEST_APPEARANCE="$appearance" INKFLIT_DATA_PATH="$test_dir/notes.json" INKFLIT_BLOCK_CALC_TEST=1 INKFLIT_TEST_UI_LANGUAGE=en python3 - "$test_app/Contents/MacOS/Inkflit" <<'PY'
import subprocess,sys
try: result=subprocess.run([sys.argv[1]],timeout=20)
except subprocess.TimeoutExpired: sys.exit('FAIL: block calculation test timed out')
if result.returncode: sys.exit(result.returncode)
PY
done
