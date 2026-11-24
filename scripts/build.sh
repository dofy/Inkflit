#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build:web
APP="$PWD/build/Inkflit.app"
# The version lives in package.json only.
VERSION="$(node -p "require('./package.json').version")"
SPARKLE="$(bash scripts/sparkle.sh)"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Frameworks" "$APP/Contents/Resources/web/textures"
rsync -a --delete "$SPARKLE/Sparkle.framework/" "$APP/Contents/Frameworks/Sparkle.framework/"
swiftc -target arm64-apple-macos13.0 -O -whole-module-optimization Sources/*.swift \
  -o "$APP/Contents/MacOS/Inkflit" -framework Cocoa -framework WebKit -framework Carbon -framework ServiceManagement \
  -F "$APP/Contents/Frameworks" -framework Sparkle -Xlinker -rpath -Xlinker '@loader_path/../Frameworks'
cp Resources/Inkflit.icns "$APP/Contents/Resources/Inkflit.icns"
cp "$SPARKLE/LICENSE" "$APP/Contents/Resources/Sparkle-LICENSE.txt"
python3 scripts/build-help.py
rm -f "$APP/Contents/Resources/"Help*.html
cp Resources/Help.html "$APP/Contents/Resources/Help.html"
cp Resources/CodeThemes.json "$APP/Contents/Resources/CodeThemes.json"
cp Resources/CodeThemes-NOTICES.txt "$APP/Contents/Resources/CodeThemes-NOTICES.txt"
cp Resources/Translations.json "$APP/Contents/Resources/Translations.json"
cp Resources/UIThemes.json "$APP/Contents/Resources/UIThemes.json"
cp Resources/Onboarding.*.json "$APP/Contents/Resources/"
cp web/index.html web/style.css "$APP/Contents/Resources/web/"
rsync -r --delete web/textures/ "$APP/Contents/Resources/web/textures/"
cp web/dist/editor.js "$APP/Contents/Resources/web/editor.js"
cp node_modules/prettier/LICENSE "$APP/Contents/Resources/Prettier-LICENSE.txt"
cp node_modules/prettier/THIRD-PARTY-NOTICES.md "$APP/Contents/Resources/Prettier-THIRD-PARTY-NOTICES.md"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>Inkflit</string><key>CFBundleIdentifier</key><string>xyz.phpz.app.inkflit</string><key>CFBundleName</key><string>Inkflit</string><key>CFBundleDisplayName</key><string>Inkflit</string><key>CFBundleIconFile</key><string>Inkflit</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>$VERSION</string><key>CFBundleURLTypes</key><array><dict><key>CFBundleURLName</key><string>Inkflit notes</string><key>CFBundleURLSchemes</key><array><string>inkflit</string></array></dict></array><key>LSMinimumSystemVersion</key><string>13.0</string><key>LSUIElement</key><true/><key>NSHighResolutionCapable</key><true/>
<key>CFBundleVersion</key><string>$VERSION</string>
<key>SUFeedURL</key><string>https://github.com/dofy/Inkflit/releases/latest/download/appcast.xml</string>
<key>SUPublicEDKey</key><string>4IlCbzkLwdV+HP9QcJnGEUEk3htT8NyF2YRAfJ37Rf4=</string>
<key>SUEnableAutomaticChecks</key><true/>
<key>SUAllowsAutomaticUpdates</key><false/>
<key>SUVerifyUpdateBeforeExtraction</key><true/>
<key>SURequireSignedFeed</key><true/>
</dict></plist>
PLIST
codesign --force --deep --sign "${INKFLIT_CODESIGN_IDENTITY:--}" --timestamp=none "$APP/Contents/Frameworks/Sparkle.framework"
codesign --force --sign "${INKFLIT_CODESIGN_IDENTITY:--}" --timestamp=none "$APP"
codesign --verify --deep --strict "$APP"
printf 'Built and signed %s\n' "$APP"
