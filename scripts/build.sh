#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build:web
APP="$PWD/build/QuickNote.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"
swiftc -O -whole-module-optimization Sources/main.swift -o "$APP/Contents/MacOS/Quicknote" -framework Cocoa -framework WebKit -framework Carbon
cp Resources/Quicknote.icns "$APP/Contents/Resources/Quicknote.icns"
cp web/index.html web/style.css "$APP/Contents/Resources/web/"
cp web/dist/editor.js "$APP/Contents/Resources/web/editor.js"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>Quicknote</string><key>CFBundleIdentifier</key><string>local.seven.quicknote</string><key>CFBundleName</key><string>QuickNote</string><key>CFBundleDisplayName</key><string>QuickNote</string><key>CFBundleIconFile</key><string>Quicknote</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>0.1.1</string><key>LSMinimumSystemVersion</key><string>13.0</string><key>LSUIElement</key><true/><key>NSHighResolutionCapable</key><true/></dict></plist>
PLIST
codesign --force --sign "${QUICKNOTE_CODESIGN_IDENTITY:--}" --timestamp=none "$APP"
codesign --verify --strict "$APP"
printf 'Built and signed %s\n' "$APP"
