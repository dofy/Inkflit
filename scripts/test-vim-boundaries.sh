#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/native-test-common.sh
setup_native_test inkflit-vim-boundaries boundary Test.app
python3 - "$test_dir/notes.json" <<'PY'
import json,sys
notes=[{'id':'plain','content':'abc','updated':'1'},{'id':'list','content':':::inkflit list\nfirst\n\n:::end','updated':'2'},{'id':'code','content':':::inkflit code json\nfirst\n\n:::end','updated':'3'}]
with open(sys.argv[1],'w') as f:json.dump({'notes':notes,'selected':'plain'},f)
PY
INKFLIT_ISOLATED_TEST=1 INKFLIT_DATA_PATH="$test_dir/notes.json" INKFLIT_VIM_BOUNDARIES_TEST=1 python3 - "$test_app/Contents/MacOS/Inkflit" <<'PY'
import subprocess,sys
try: result=subprocess.run([sys.argv[1]],timeout=25)
except subprocess.TimeoutExpired: sys.exit('FAIL: Vim boundary test timed out')
if result.returncode: sys.exit(result.returncode)
PY
