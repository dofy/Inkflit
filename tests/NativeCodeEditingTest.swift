import AppKit
import WebKit

// Compiled only by scripts/test-native.sh. Drives the real app's NSWindow and
// WKWebView with AppKit keyboard events while using an isolated data file.
final class NativeCodeEditingTest {
    private let app: AppDelegate
    private let unit: String
    private var completedText = ""
    private static var running: NativeCodeEditingTest?
    private static var backdropWindow: NSWindow?

    static func installBackdrop(_ app: AppDelegate) {
        final class Pattern: NSView {
            override func draw(_ dirtyRect: NSRect) {
                NSColor.systemBlue.setFill(); bounds.fill()
                NSColor.systemRed.setFill()
                for x in stride(from: CGFloat(0), through: bounds.width, by: 120) { NSRect(x: x, y: 0, width: 60, height: bounds.height).fill() }
            }
        }
        let window = NSWindow(contentRect: app.window.frame, styleMask: .borderless, backing: .buffered, defer: false)
        window.contentView = Pattern(frame: NSRect(origin: .zero, size: app.window.frame.size)); window.isReleasedWhenClosed = false
        window.orderFront(nil); app.window.makeKeyAndOrderFront(nil); backdropWindow = window
        if let path = ProcessInfo.processInfo.environment["INKFLIT_TEST_CAPTURE"] {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                guard app.window.isVisible,
                      let windows = CGWindowListCopyWindowInfo(.optionIncludingWindow, CGWindowID(app.window.windowNumber)) as? [[String: Any]],
                      let bounds = windows.first?[kCGWindowBounds as String] as? [String: NSNumber],
                      let x = bounds["X"], let y = bounds["Y"], let width = bounds["Width"], let height = bounds["Height"] else { fputs("FAIL: could not locate backdrop fixture\n", stderr); exit(1) }
                let process = Process(); process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
                process.arguments = ["-x", "-R\(x.intValue),\(y.intValue),\(width.intValue),\(height.intValue)", path]
                do { try process.run(); process.waitUntilExit(); if process.terminationStatus != 0 { throw NSError(domain: "Screenshot", code: Int(process.terminationStatus)) }; print("Saved fixture screenshot \(path)") }
                catch { fputs("FAIL: fixture screenshot could not be saved\n", stderr); exit(1) }
                app.restoreInputSource(); exit(0)
            }
        }
    }

    init(_ app: AppDelegate) {
        self.app = app
        switch app.codeIndentation() { case "spaces4": unit = "    "; case "tabs": unit = "\t"; default: unit = "  " }
    }
    static func start(_ app: AppDelegate) {
        running = NativeCodeEditingTest(app)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { running?.run() }
    }
    static func testCursorColors(_ app: AppDelegate) {
        let script = """
        (() => {
          const host=document.createElement('div'); host.className='cm-editor cm-focused';
          const block=document.createElement('div'); block.className='cm-fat-cursor'; block.style.color='rgb(1, 2, 3)';
          const bar=document.createElement('div'); bar.className='cm-cursor'; host.append(block,bar); document.body.append(host);
          const errors=[];
          for(const theme of ['orange','blue','green']) {
            window.setUIAppearance(theme,100);
            const root=getComputedStyle(document.documentElement), probe=document.createElement('span'); document.body.append(probe);
            probe.style.color=root.getPropertyValue('--ui-cursor'); const cursor=getComputedStyle(probe).color;
            probe.style.color=root.getPropertyValue('--ui-paper'); const paper=getComputedStyle(probe).color; probe.remove();
            const b=getComputedStyle(block), c=getComputedStyle(bar);
            if(b.backgroundColor!==cursor || b.color!==paper || c.borderLeftColor!==cursor) errors.push(theme+': focused cursor mismatch');
            block.style.color='transparent'; if(getComputedStyle(block).color!=='rgba(0, 0, 0, 0)') errors.push(theme+': partial cursor text must stay transparent');
            block.style.color='rgb(1, 2, 3)';
            host.classList.remove('cm-focused'); const inactive=getComputedStyle(block);
            if(inactive.outlineColor!==cursor || inactive.backgroundColor!=='rgba(0, 0, 0, 0)') errors.push(theme+': inactive cursor mismatch');
            host.classList.add('cm-focused');
          }
          host.remove(); return errors;
        })()
        """
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            app.web.evaluateJavaScript(script) { result, error in
                guard error == nil, let errors = result as? [String], errors.isEmpty else {
                    fputs("FAIL native cursor colors: \(String(describing: error)) \(String(describing: result))\n", stderr); exit(1)
                }
                print("PASS native cursor colors for all three themes")
                app.restoreInputSource(); exit(0)
            }
        }
    }
    private func fail(_ message: String) -> Never { app.restoreInputSource(); fputs("FAIL: \(message)\n", stderr); exit(1) }
    private func key(_ code: UInt16, _ text: String, _ unmodified: String? = nil, _ flags: NSEvent.ModifierFlags = []) {
        for type in [NSEvent.EventType.keyDown, .keyUp] {
            guard let event = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: app.window.windowNumber, context: nil, characters: text, charactersIgnoringModifiers: unmodified ?? text, isARepeat: false, keyCode: code) else { fail("could not create keyboard event") }
            app.window.sendEvent(event)
        }
    }
    private func later(_ block: @escaping () -> Void) { DispatchQueue.main.asyncAfter(deadline: .now() + 0.15, execute: block) }
    private func sequence(_ actions: [() -> Void], _ completion: @escaping () -> Void) {
        guard let first = actions.first else { later(completion); return }
        first()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { [self] in sequence(Array(actions.dropFirst()), completion) }
    }
    private func content(_ block: @escaping (String) -> Void) {
        app.web.evaluateJavaScript("window.exportNotesJSON?.()") { [self] result, error in
            guard error == nil, let json = result as? String, let data = json.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let notes = object["notes"] as? [[String: Any]], let selected = object["selected"] as? String,
                  let note = notes.first(where: { ($0["id"] as? String) == selected }),
                  let text = note["content"] as? String else { fail("could not read isolated note") }
            block(text)
        }
    }
    private func expect(_ actual: String, _ expected: String, _ label: String) {
        if actual != expected { fail("\(label): expected \(String(reflecting: expected)), got \(String(reflecting: actual))") }
        print("PASS \(label)")
    }
    private func run() {
        app.showWindow()
        if app.web.isOpaque { fail("WebKit view is opaque") }
        if app.web.responds(to: NSSelectorFromString("_setDrawsBackground:")) && (app.web.value(forKey: "drawsBackground") as? Bool) != false { fail("WebKit still draws an opaque page background") }
        if abs(app.window.frame.width * 3 - app.window.frame.height * 2) > 2 { fail("default window is not 2:3") }
        print("PASS native default window aspect ratio")
        guard let root = app.window.contentView,
              root.hitTest(NSPoint(x: root.bounds.midX, y: root.bounds.maxY - 5)) is WindowDragView,
              root.hitTest(NSPoint(x: root.bounds.midX, y: root.bounds.maxY - 28)) is WindowDragView,
              !(root.hitTest(NSPoint(x: 30, y: root.bounds.maxY - 28)) is WindowDragView),
              !(root.hitTest(NSPoint(x: root.bounds.maxX - 30, y: root.bounds.maxY - 28)) is WindowDragView) else { fail("drag areas or toolbar hit testing incorrect") }
        print("PASS native drag and toolbar hit testing")
        app.web.evaluateJavaScript("window.focusEditor?.()") { [self] _, _ in
            later { [self] in
                sequence([{ self.key(34, "i") }, { self.key(33, "{", "[", .shift) }]) { [self] in content { [self] text in
                    expect(text, ":::quicknote code json\n{}\n:::end", "native brace pair")
                    key(36, "\r")
                    later { [self] in content { [self] text in
                        expect(text, ":::quicknote code json\n{\n\(unit)\n}\n:::end", "native indentation")
                        sequence([{ self.key(39, "\"", "'", .shift) }, { self.key(40, "k") }, { self.key(14, "e") }, { self.key(16, "y") }, { self.key(39, "\"", "'", .shift) }, { self.key(41, ":", ";", .shift) }, { self.key(49, " ") }, { self.key(18, "1") }]) { [self] in content { [self] text in
                            completedText = ":::quicknote code json\n{\n\(unit)\"key\": 1\n}\n:::end"
                            expect(text, completedText, "native quote pair and closer")
                            sequence([{ self.key(53, "\u{1b}") }, { self.key(32, "u") }]) { [self] in content { [self] undone in
                                if undone == completedText { fail("Vim undo did not change the note") }
                                print("PASS native Vim undo")
                                key(15, "\u{12}", "r", .control)
                                later { [self] in content { [self] redone in
                                    expect(redone, completedText, "native Vim redo")
                                    testPairDeletionAndTab()
                                } }
                            } }
                        } }
                    } }
                } }
            }
        }
    }
    private func testPairDeletionAndTab() {
        sequence([{ self.key(33, "[", "[", .command) }, { self.key(34, "i") }, { self.key(33, "[") }, { self.key(51, "\u{7f}") }]) { [self] in content { [self] text in
            expect(text, ":::quicknote code json\n\n:::end", "native paired backspace")
            key(48, "\t")
            later { [self] in content { [self] text in
                expect(text, ":::quicknote code json\n\(unit)\n:::end", "native Tab indentation")
                key(48, "\u{19}", "\t", .shift)
                later { [self] in content { [self] text in
                    expect(text, ":::quicknote code json\n\n:::end", "native Shift-Tab outdent")
                    sequence([{ self.key(25, "(", "9", .shift) }, { self.key(29, ")", "0", .shift) }]) { [self] in content { [self] text in
                        expect(text, ":::quicknote code json\n()\n:::end", "native bracket closer skips existing character")
                        sequence([{ self.key(53, "\u{1b}") }, { self.key(33, "[", "[", .command) }, { self.key(34, "i") }, { self.key(33, "{", "[", .shift) }]) { [self] in content { [self] text in
                            expect(text, "{", "ordinary text does not auto-pair")
                            sequence([{ self.key(53, "\u{1b}") }, { self.key(30, "]", "]", .command) }, { self.key(30, "]", "]", .command) }]) { [self] in
                                app.showSettings(); testCodeThemes(0)
                            }
                        } }
                    } }
                } }
            } }
        } }
    }
    private func testCodeThemes(_ index: Int) {
        if index == CodeThemes.all.count {
            testAppearance(0)
            return
        }
        let theme = CodeThemes.all[index]
        let dark = app.window.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        guard let expected = (dark ? theme.darkColors : theme.colors)["property"], let settings = app.settingsController,
              let preview = settings.testSelectCodeTheme(theme.id) else { fail("could not select theme or render preview") }
        expect(preview.lowercased(), expected.lowercased(), "native theme preview \(theme.id)")
        guard app.codeTheme() == theme.id else { fail("native theme preference was not saved") }
        later { [self] in
            let script = """
            (() => {
              const p=document.querySelector('.cm-content .tok-propertyName');
              const v=getComputedStyle(document.documentElement).getPropertyValue('--syntax-property').trim();
              const probe=document.createElement('span'); probe.style.color=v; document.body.append(probe);
              const expected=getComputedStyle(probe).color; probe.remove();
              return {id:document.documentElement.dataset.codeTheme, value:v, actual:p ? getComputedStyle(p).color : null, expected};
            })()
            """
            app.web.evaluateJavaScript(script) { [self] result, error in
                guard error == nil, let values = result as? [String: Any],
                      let id = values["id"] as? String, let value = values["value"] as? String,
                      let actual = values["actual"] as? String, let rgb = values["expected"] as? String else { fail("code theme or JSON property was not rendered") }
                expect(id, theme.id, "native applied theme")
                expect(value.lowercased(), expected.lowercased(), "native theme palette")
                expect(actual, rgb, "native JSON property color")
                testCodeThemes(index + 1)
            }
        }
    }
    private func testAppearance(_ index: Int) {
        let variants = [WindowAppearance(theme: "blue", opacity: 70, blur: 65), WindowAppearance(theme: "green", opacity: 85, blur: 0), WindowAppearance(theme: "orange", opacity: 100, blur: 0)]
        if index == variants.count {
            testLanguages(0); return
        }
        let expected = variants[index]
        guard let settings = app.settingsController, settings.testSetAppearance(expected) else { fail("could not set appearance") }
        settings.testSelectSettingsTab(1)
        let saved = app.windowAppearance()
        guard saved.theme == expected.theme && saved.opacity == expected.opacity && saved.blur == expected.blur else { fail("appearance preference mismatch") }
        guard app.backdrop.isHidden == (expected.blur == 0), abs(app.backdrop.alphaValue - CGFloat(expected.blur) / 100) < 0.001 else { fail("backdrop state mismatch") }
        later { [self] in
            app.web.evaluateJavaScript("[document.documentElement.dataset.uiTheme, document.documentElement.style.getPropertyValue('--ui-opacity'), getComputedStyle(document.querySelector('.app')).backgroundColor, getComputedStyle(document.querySelector('header')).height, getComputedStyle(document.querySelector('.drag-bar')).height]") { [self] value, error in
                guard error == nil, let values = value as? [String], values.count == 5 else { fail("could not read applied appearance") }
                expect(values[0], expected.theme, "native UI color")
                guard let opacity = Double(values[1]), abs(opacity - Double(expected.opacity) / 100) < 0.001 else { fail("web opacity mismatch") }
                guard values[2].contains(expected.opacity == 100 ? "rgb(" : "rgba(") else { fail("window background opacity missing") }
                expect(values[3], "36px", "native compact toolbar")
                expect(values[4], "10px", "native drag strip")
                print("PASS native opacity and blur \(expected.opacity)/\(expected.blur)")
                testCursorAppearance(index)
            }
        }
    }
    private func testCursorAppearance(_ index: Int) {
        app.showWindow()
        later { [self] in
            let script = """
            (() => {
              const root = getComputedStyle(document.documentElement), probe = document.createElement('span');
              probe.style.color = root.getPropertyValue('--ui-cursor'); document.body.append(probe);
              const expected = getComputedStyle(probe).color;
              probe.style.color = root.getPropertyValue('--ui-paper'); const text = getComputedStyle(probe).color; probe.remove();
              const cursor = document.querySelector('.cm-fat-cursor');
              return cursor ? [expected,text,getComputedStyle(cursor).backgroundColor,getComputedStyle(cursor).color] : null;
            })()
            """
            app.web.evaluateJavaScript(script) { [self] value, error in
                guard error == nil, let colors = value as? [String], colors.count == 4 else { fail("Vim block cursor was not rendered") }
                expect(colors[2], colors[0], "Vim block cursor theme color")
                expect(colors[3], colors[1], "Vim block cursor text contrast")
                key(34, "i")
                later { [self] in
                    app.web.evaluateJavaScript("(() => { const cursor=document.querySelector('.cm-cursorLayer:not(.cm-vimCursorLayer) .cm-cursor-primary'); return cursor ? getComputedStyle(cursor).borderLeftColor : null; })()") { [self] value, error in
                        guard error == nil, let color = value as? String else { fail("insert cursor was not rendered") }
                        expect(color, colors[0], "insert cursor theme color")
                        key(53, "\u{1b}")
                        testAppearance(index + 1)
                    }
                }
            }
        }
    }
    private func testLanguages(_ index: Int) {
        let cases = [("en", "New note"), ("zh-Hans", "新建笔记"), ("zh-Hant", "新增筆記"), ("ja", "新規ノート")]
        if index == cases.count {
            content { [self] text in
                expect(text, completedText, "language changes preserve note content")
                testDeleteBeforeBlock()
            }
            return
        }
        let (language, label) = cases[index]
        guard let settings = app.settingsController, settings.testSelectLanguage(language) else { fail("could not select language \(language)") }
        later { [self] in
            app.web.evaluateJavaScript("[document.documentElement.lang, document.getElementById('new').getAttribute('aria-label')]") { [self] value, error in
                guard error == nil, let values = value as? [String], values.count == 2 else { fail("could not read language") }
                expect(values[0], language, "native language preference")
                expect(values[1], label, "native translated editor")
                guard Localization.preference == language, self.app.settingsController != nil else { fail("language did not persist or settings did not reopen") }
                testLanguages(index + 1)
            }
        }
    }
    private func testDeleteBeforeBlock() {
        app.showWindow()
        sequence([{ self.key(33, "[", "[", .command) }, { self.key(33, "[", "[", .command) }, { self.key(33, "[", "[", .command) }]) { [self] in
            content { [self] text in
                let original = "// comment\n\n:::quicknote code json\n{}\n:::end"
                expect(text, original, "native block spacing fixture")
                sequence([{ self.key(5, "g") }, { self.key(5, "g") }, { self.key(2, "d") }, { self.key(2, "d") }]) { [self] in content { [self] text in
                    expect(text, "\n:::quicknote code json\n{}\n:::end", "Vim delete preceding text line")
                    sequence([{ self.key(2, "d") }, { self.key(2, "d") }]) { [self] in content { [self] text in
                        expect(text, ":::quicknote code json\n{}\n:::end", "Vim delete blank line before block")
                        sequence([{ self.key(32, "u") }, { self.key(32, "u") }]) { [self] in content { [self] text in
                            expect(text, original, "Vim undo deleted lines before block")
                            print("PASS native configuration \(app.codeIndentation())")
                            app.restoreInputSource(); exit(0)
                        } }
                    } }
                } }
            }
        }
    }
}
