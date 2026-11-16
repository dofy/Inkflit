import AppKit
import WebKit

// Compiled only by scripts/test-native.sh. Drives the real app's NSWindow and
// WKWebView with AppKit keyboard events while using an isolated data file.
final class NativeCodeEditingTest {
    private let app: AppDelegate
    private let unit: String
    private var completedText = ""
    private static var running: NativeCodeEditingTest?

    init(_ app: AppDelegate) {
        self.app = app
        switch app.codeIndentation() { case "spaces4": unit = "    "; case "tabs": unit = "\t"; default: unit = "  " }
    }
    static func start(_ app: AppDelegate) {
        running = NativeCodeEditingTest(app)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { running?.run() }
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
                            print("PASS native configuration \(app.codeIndentation())")
                            app.restoreInputSource()
                            exit(0)
                        } }
                    } }
                } }
            } }
        } }
    }
}
