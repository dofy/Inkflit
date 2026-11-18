# Shared by the native test entry points, which run from the repository root.
cleanup_native_test() {
  if [[ -n "${test_bundle_id:-}" ]]; then
    defaults delete "$test_bundle_id" >/dev/null 2>&1 || true
    rm -f -- "$HOME/Library/Preferences/$test_bundle_id.plist"
  fi
  if [[ -n "${test_dir:-}" ]]; then rm -rf -- "$test_dir"; fi
}

setup_native_test() {
  local template=$1 id_prefix=$2 bundle_name=$3 temp_base=${4:-${TMPDIR:-/tmp}}
  test_dir=
  test_bundle_id=
  trap cleanup_native_test EXIT
  npm run build
  test_dir=$(mktemp -d "${temp_base%/}/$template.XXXXXX")
  test_app="$test_dir/$bundle_name"
  test_bundle_id="local.seven.inkflit.$id_prefix.$(basename "$test_dir" | tr -cd '[:alnum:]')"
  ditto build/Inkflit.app "$test_app"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $test_bundle_id" "$test_app/Contents/Info.plist"
  swiftc -D INKFLIT_NATIVE_TEST \
    Sources/main.swift Sources/Automation.swift Sources/Settings.swift \
    Sources/NoteStorage.swift Sources/Localization.swift Sources/Onboarding.swift \
    tests/NativeCodeEditingTest.swift -o "$test_app/Contents/MacOS/Inkflit" \
    -framework Cocoa -framework WebKit -framework Carbon -framework ServiceManagement
  codesign --force --sign - --timestamp=none "$test_app"
}
