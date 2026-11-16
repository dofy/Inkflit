import Cocoa
import WebKit
import Carbon

final class NotePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}
final class DragWebView: WKWebView {
    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        if point.y >= bounds.height - 18 { window?.performDrag(with: event) }
        else { super.mouseDown(with: event) }
    }
}
final class ShortcutRecorder: NSWindow {
    var onKey: ((NSEvent) -> Bool)?
    override var canBecomeKey: Bool { true }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 { close(); return }
        if onKey?(event) == true { close() } else { NSSound.beep() }
    }
}
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    var window: NotePanel!
    var web: WKWebView!
    var status: NSStatusItem!
    var hotKey: EventHotKeyRef?
    var hotKeyID: UInt32 = 0
    var hotKeyItem: NSMenuItem!
    var recorder: ShortcutRecorder?
    var activationObserver: NSObjectProtocol?
    var timerAlert: Timer?
    let isolatedTest = ProcessInfo.processInfo.environment["QUICKNOTE_ISOLATED_TEST"] == "1"
    var insertMode = false
    var savedInputSource: TISInputSource?
    var forcedInputSourceID: String?
    var hotKeyCode: UInt32 = 49
    var hotKeyModifiers: UInt32 = UInt32(controlKey | optionKey)
    let storageURL = ProcessInfo.processInfo.environment["QUICKNOTE_DATA_PATH"].map { URL(fileURLWithPath: $0) } ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Quicknote/notes.json")

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        // Accessory apps still need the standard edit responder actions for WKWebView.
        let mainMenu = NSMenu()
        let editRoot = NSMenuItem(title: "编辑", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editRoot.submenu = editMenu; mainMenu.addItem(editRoot); NSApp.mainMenu = mainMenu
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "quicknote")
        web = DragWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self; web.uiDelegate = self
        web.underPageBackgroundColor = .clear
        web.wantsLayer = true; web.layer?.cornerRadius = 12; web.layer?.masksToBounds = true
        window = NotePanel(contentRect: NSRect(x: 0, y: 0, width: 580, height: 560), styleMask: [.borderless, .resizable], backing: .buffered, defer: false)
        window.title = "Quicknote"; window.minSize = NSSize(width: 380, height: 320)
        window.isFloatingPanel = true; window.level = .floating; window.hidesOnDeactivate = false
        window.isOpaque = false; window.backgroundColor = .clear; window.hasShadow = true
        window.contentView = web; window.delegate = self; window.center()
        activationObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { [weak self] notification in
            guard let self, self.window.isVisible,
                  let activated = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                  activated.processIdentifier != ProcessInfo.processInfo.processIdentifier else { return }
            self.hideWindow()
        }
        let url = Bundle.main.resourceURL!.appendingPathComponent("web/index.html")
        web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        if !isolatedTest {
            status = NSStatusBar.system.statusItem(withLength: 24)
            if let button = status.button {
                button.image = makeStatusIcon()
                button.title = ""
            }
            let menu = NSMenu()
            menu.addItem(withTitle: "打开 Quicknote", action: #selector(showWindow), keyEquivalent: "")
            hotKeyItem = menu.addItem(withTitle: "设置全局快捷键…", action: #selector(recordShortcut), keyEquivalent: "")
            menu.addItem(.separator()); menu.addItem(withTitle: "退出 Quicknote", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
            status.menu = menu
            var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
            let handlerStatus = InstallEventHandler(GetApplicationEventTarget(), { _, _, data in
                guard let data else { return OSStatus(eventNotHandledErr) }
                Unmanaged<AppDelegate>.fromOpaque(data).takeUnretainedValue().toggleWindow()
                return noErr
            }, 1, &eventType, Unmanaged.passUnretained(self).toOpaque(), nil)
            let defaults = UserDefaults.standard
            if defaults.object(forKey: "hotKeyCode") != nil { hotKeyCode = UInt32(defaults.integer(forKey: "hotKeyCode")); hotKeyModifiers = UInt32(defaults.integer(forKey: "hotKeyModifiers")) }
            if handlerStatus != noErr || !registerHotKey(code: hotKeyCode, modifiers: hotKeyModifiers) { reportHotKeyFailure() }
        }
        showWindow()
    }
    func makeStatusIcon() -> NSImage {
        let icon = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { _ in
            NSColor.black.setStroke()
            let outline = NSBezierPath(roundedRect: NSRect(x: 3, y: 2.5, width: 12, height: 13), xRadius: 2, yRadius: 2)
            outline.lineWidth = 1.5; outline.stroke()
            let lines = NSBezierPath(); lines.lineWidth = 1.4; lines.lineCapStyle = .round
            lines.move(to: NSPoint(x: 6, y: 10.5)); lines.line(to: NSPoint(x: 12, y: 10.5))
            lines.move(to: NSPoint(x: 6, y: 7.5)); lines.line(to: NSPoint(x: 11, y: 7.5)); lines.stroke()
            return true
        }
        icon.isTemplate = true
        return icon
    }
    func registerHotKey(code: UInt32, modifiers: UInt32) -> Bool {
        var candidate: EventHotKeyRef?
        hotKeyID &+= 1
        let result = RegisterEventHotKey(code, modifiers, EventHotKeyID(signature: 0x514e4f54, id: hotKeyID), GetApplicationEventTarget(), UInt32(kEventHotKeyExclusive), &candidate)
        guard result == noErr else { return false }
        if let hotKey { UnregisterEventHotKey(hotKey) }
        hotKey = candidate; hotKeyCode = code; hotKeyModifiers = modifiers
        updateHotKeyLabel(); return true
    }
    func shortcutLabel() -> String {
        var text = ""
        if hotKeyModifiers & UInt32(controlKey) != 0 { text += "⌃" }
        if hotKeyModifiers & UInt32(optionKey) != 0 { text += "⌥" }
        if hotKeyModifiers & UInt32(shiftKey) != 0 { text += "⇧" }
        if hotKeyModifiers & UInt32(cmdKey) != 0 { text += "⌘" }
        let keys: [UInt32: String] = [49:"Space",0:"A",1:"S",2:"D",3:"F",4:"H",5:"G",6:"Z",7:"X",8:"C",9:"V",11:"B",12:"Q",13:"W",14:"E",15:"R",16:"Y",17:"T",31:"O",32:"U",34:"I",35:"P",37:"L",38:"J",40:"K",45:"N",46:"M"]
        return text + (keys[hotKeyCode] ?? "Key \(hotKeyCode)")
    }
    func updateHotKeyLabel() {
        let label = shortcutLabel()
        status.button?.toolTip = "全局快捷键 \(label)"
        hotKeyItem.title = "设置全局快捷键…（\(label)）"
        if let data = try? JSONSerialization.data(withJSONObject: [label]), let json = String(data: data, encoding: .utf8) { web.evaluateJavaScript("window.setShortcutLabel?.(\(json)[0])", completionHandler: nil) }
    }
    func reportHotKeyFailure() {
        status.button?.toolTip = "全局快捷键不可用，请在菜单中重新设置"
        hotKeyItem.title = "设置全局快捷键…（不可用）"
        web.evaluateJavaScript("window.setShortcutLabel?.('快捷键不可用')", completionHandler: nil)
    }
    @objc func recordShortcut() {
        let panel = ShortcutRecorder(contentRect: NSRect(x: 0, y: 0, width: 360, height: 145), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        panel.title = "设置全局快捷键"; panel.center(); panel.level = .floating
        let label = NSTextField(labelWithString: "按下新的快捷键，需包含 ⌘、⌥ 或 ⌃。\n按 Esc 取消。")
        label.frame = NSRect(x: 24, y: 55, width: 312, height: 55); label.lineBreakMode = .byWordWrapping
        panel.contentView?.addSubview(label)
        panel.onKey = { [weak self] event in
            guard let self else { return false }
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            var mods: UInt32 = 0
            if flags.contains(.control) { mods |= UInt32(controlKey) }; if flags.contains(.option) { mods |= UInt32(optionKey) }
            if flags.contains(.shift) { mods |= UInt32(shiftKey) }; if flags.contains(.command) { mods |= UInt32(cmdKey) }
            guard mods & UInt32(controlKey | optionKey | cmdKey) != 0 else { label.stringValue = "请包含 ⌘、⌥ 或 ⌃。"; return false }
            if UInt32(event.keyCode) == self.hotKeyCode && mods == self.hotKeyModifiers && self.hotKey != nil { return true }
            guard self.registerHotKey(code: UInt32(event.keyCode), modifiers: mods) else { label.stringValue = "这个快捷键不可用，请换一个。"; return false }
            UserDefaults.standard.set(Int(self.hotKeyCode), forKey: "hotKeyCode"); UserDefaults.standard.set(Int(self.hotKeyModifiers), forKey: "hotKeyModifiers")
            return true
        }
        recorder = panel; NSApp.activate(ignoringOtherApps: true); panel.makeKeyAndOrderFront(nil)
    }
    @objc func showWindow() { NSApp.activate(ignoringOtherApps: true); window.makeKeyAndOrderFront(nil); web.evaluateJavaScript("window.focusEditor?.()", completionHandler: nil) }
    func toggleWindow() { if window.isVisible && window.isKeyWindow { hideWindow() } else { showWindow() } }
    func inputSourceID(_ source: TISInputSource) -> String? {
        guard let pointer = TISGetInputSourceProperty(source, kTISPropertyInputSourceID) else { return nil }
        return Unmanaged<CFString>.fromOpaque(pointer).takeUnretainedValue() as String
    }
    func useVimInputSource() {
        guard window.isKeyWindow, !insertMode, savedInputSource == nil else { return }
        let previous = TISCopyCurrentKeyboardInputSource().takeRetainedValue()
        let ascii = TISCopyCurrentASCIICapableKeyboardInputSource().takeRetainedValue()
        guard let previousID = inputSourceID(previous), let asciiID = inputSourceID(ascii), previousID != asciiID else { return }
        if TISSelectInputSource(ascii) == noErr { savedInputSource = previous; forcedInputSourceID = asciiID }
    }
    func restoreInputSource() {
        guard let previous = savedInputSource else { return }
        let current = TISCopyCurrentKeyboardInputSource().takeRetainedValue()
        if inputSourceID(current) == forcedInputSourceID { _ = TISSelectInputSource(previous) }
        savedInputSource = nil; forcedInputSourceID = nil
    }
    func applicationDidResignActive(_ notification: Notification) {
        if window?.isVisible == true { hideWindow() }
    }
    func windowDidBecomeKey(_ notification: Notification) { useVimInputSource() }
    func windowDidResignKey(_ notification: Notification) { restoreInputSource() }
    func applicationWillTerminate(_ notification: Notification) {
        if let activationObserver { NSWorkspace.shared.notificationCenter.removeObserver(activationObserver) }
        restoreInputSource()
    }
    func hideWindow() { restoreInputSource(); window.orderOut(nil) }
    func windowShouldClose(_ sender: NSWindow) -> Bool { sender.orderOut(nil); return false }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        do {
            if FileManager.default.fileExists(atPath: storageURL.path) {
                let data = try Data(contentsOf: storageURL); let base64 = data.base64EncodedString()
                web.evaluateJavaScript("window.loadNotesBase64('\(base64)')", completionHandler: nil)
            } else { web.evaluateJavaScript("window.loadNotesBase64(null)", completionHandler: nil) }
            if !isolatedTest { if hotKey != nil { updateHotKeyLabel() } else { reportHotKeyFailure() } }
        } catch { showError("无法读取笔记：\(error.localizedDescription)") }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.navigationType == .linkActivated { if let url = action.request.url, ["https", "http"].contains(url.scheme?.lowercased() ?? "") { NSWorkspace.shared.open(url) }; decisionHandler(.cancel); return }; decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle: "删除"); alert.addButton(withTitle: "取消")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }
    func setEditorMode(_ mode: String) {
        insertMode = mode == "insert" || mode == "replace"
        if insertMode { restoreInputSource() } else { useVimInputSource() }
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        if prompt == "quicknote-input-mode", let mode = defaultText { setEditorMode(mode); completionHandler(""); return }
        completionHandler(nil)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        if type == "hide" { hideWindow(); return }
        if type == "copyCode", let content = body["content"] as? String {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(content, forType: .string)
            return
        }
        if type == "timer" {
            timerAlert?.invalidate(); timerAlert = nil
            if let deadline = body["deadline"] as? Double, deadline > 0 {
                let delay = max(0.01, deadline / 1000 - Date().timeIntervalSince1970)
                timerAlert = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
                    NSSound.beep()
                    self?.web.evaluateJavaScript("window.timerFinished?.()", completionHandler: nil)
                }
            }
            return
        }
        if type == "mode", let mode = body["mode"] as? String {
            setEditorMode(mode)
            return
        }
        guard type == "save", let json = body["json"] as? String, let data = json.data(using: .utf8) else { return }
        do {
            try FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try data.write(to: storageURL, options: .atomic); web.evaluateJavaScript("window.saveResult(true)", completionHandler: nil)
        } catch { showError("保存失败：\(error.localizedDescription)") }
    }
    func showError(_ message: String) {
        if let data = try? JSONSerialization.data(withJSONObject: [message]), let text = String(data: data, encoding: .utf8) { web.evaluateJavaScript("window.saveResult(false, \(text)[0])", completionHandler: nil) }
    }
}
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
