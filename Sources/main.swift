import Cocoa
import WebKit
import Carbon
import ServiceManagement

final class NotePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}
final class DragWebView: WKWebView {
    override var isOpaque: Bool { false }
}
final class WindowDragView: NSView {
    override func mouseDown(with event: NSEvent) { window?.performDrag(with: event) }
}
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    var window: NotePanel!
    var web: WKWebView!
    var backdrop: NSVisualEffectView!
    var status: NSStatusItem!
    var hotKey: EventHotKeyRef?
    var hotKeyID: UInt32 = 0
    var hotKeyItem: NSMenuItem!
    var settingsController: SettingsController?
    var reopenLanguageSettings = false
    var activationObserver: NSObjectProtocol?
    let isolatedTest = ProcessInfo.processInfo.environment["QUICKNOTE_ISOLATED_TEST"] == "1"
    var usesNoteFiles: Bool {
        #if INKFLIT_NATIVE_TEST
        return !isolatedTest || ProcessInfo.processInfo.environment["INKFLIT_FILE_STORAGE_TEST"] == "1"
        #else
        return true
        #endif
    }
    var insertMode = false
    var savedInputSource: TISInputSource?
    var forcedInputSourceID: String?
    var hotKeyCode: UInt32 = 49
    var hotKeyModifiers: UInt32 = UInt32(controlKey | optionKey)
    var hotKeyDisabled = false
    var testLoginStatus: SMAppService.Status = .notRegistered
    var storageURL: URL!
    var loadedSnapshot: NoteSnapshot?
    private struct PendingSave { let data: Data; let revision: Int }
    private var pendingSave: PendingSave?
    private var saveWork: DispatchWorkItem?
    private var firstPendingAt: TimeInterval?
    private var lastSavedRevision = 0
    private var hideGeneration = 0
    private var hidePending = false
    private var terminationPending = false
    private let saveDelay: TimeInterval = 0.5
    private let maximumSaveDelay: TimeInterval = 2
    #if INKFLIT_NATIVE_TEST
    var testSuccessfulSaves = 0
    var testSaveTimes: [TimeInterval] = []
    #endif
    var requireExistingStorage = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        #if INKFLIT_NATIVE_TEST
        if isolatedTest, let appearance = ProcessInfo.processInfo.environment["INKFLIT_TEST_APPEARANCE"] {
            NSApp.appearance = NSAppearance(named: appearance == "dark" ? .darkAqua : .aqua)
        }
        if isolatedTest, let value = ProcessInfo.processInfo.environment["INKFLIT_NATIVE_INDENT"] {
            UserDefaults.standard.set(value, forKey: "codeIndentation")
        }
        if isolatedTest, let value = ProcessInfo.processInfo.environment["INKFLIT_TEST_UI_LANGUAGE"] {
            UserDefaults.standard.set(value, forKey: "language")
        }
        #endif
        configureStorage()
        // Accessory apps still need the standard edit responder actions for WKWebView.
        let mainMenu = NSMenu()
        let appRoot = NSMenuItem(title: "Inkflit", action: nil, keyEquivalent: "")
        let appMenu = NSMenu(title: "Inkflit")
        let settingsItem = appMenu.addItem(withTitle: L("设置…"), action: #selector(showSettings), keyEquivalent: ",")
        settingsItem.target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: L("退出 Inkflit"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appRoot.submenu = appMenu; mainMenu.addItem(appRoot)
        let editRoot = NSMenuItem(title: L("编辑"), action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: L("编辑"))
        editMenu.addItem(withTitle: L("剪切"), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: L("复制"), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: L("粘贴"), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: L("全选"), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editRoot.submenu = editMenu; mainMenu.addItem(editRoot)
        let windowRoot = NSMenuItem(title: L("窗口"), action: nil, keyEquivalent: "")
        let windowMenu = NSMenu(title: L("窗口"))
        windowMenu.addItem(withTitle: L("关闭窗口"), action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowRoot.submenu = windowMenu; mainMenu.addItem(windowRoot); NSApp.mainMenu = mainMenu
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "quicknote")
        web = DragWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self; web.uiDelegate = self
        web.underPageBackgroundColor = .clear
        // WebKit's transparent drawing switch is not public on macOS; probe it
        // first so a future WebKit without it does not fail at startup.
        if web.responds(to: NSSelectorFromString("_setDrawsBackground:")) { web.setValue(false, forKey: "drawsBackground") }
        web.wantsLayer = true; web.layer?.cornerRadius = 12; web.layer?.masksToBounds = true
        let visible = NSScreen.main?.visibleFrame.size ?? NSSize(width: 800, height: 832)
        let defaultWidth = max(1, min(480, (visible.height - 32) * 2 / 3, visible.width - 32))
        window = NotePanel(contentRect: NSRect(x: 0, y: 0, width: defaultWidth, height: defaultWidth * 3 / 2), styleMask: [.borderless, .resizable], backing: .buffered, defer: false)
        window.title = "Inkflit"; window.minSize = NSSize(width: min(300, defaultWidth), height: min(280, defaultWidth * 3 / 2))
        // Keep the note below system overlays such as macOS screenshot selection.
        window.isFloatingPanel = false; window.level = .normal; window.hidesOnDeactivate = false
        window.isOpaque = false; window.backgroundColor = .clear; window.hasShadow = true
        let container = NSView(frame: NSRect(origin: .zero, size: window.frame.size))
        container.wantsLayer = true; container.layer?.cornerRadius = 12; container.layer?.masksToBounds = true
        backdrop = NSVisualEffectView(frame: container.bounds); backdrop.blendingMode = .behindWindow; backdrop.material = .underWindowBackground; backdrop.state = .active
        backdrop.autoresizingMask = [.width, .height]; web.frame = container.bounds; web.autoresizingMask = [.width, .height]
        container.addSubview(backdrop); container.addSubview(web)
        let drag = WindowDragView(frame: NSRect(x: 0, y: container.bounds.height - 10, width: container.bounds.width, height: 10))
        drag.autoresizingMask = [.width, .minYMargin]; container.addSubview(drag)
        let headerDrag = WindowDragView(frame: NSRect(x: 130, y: container.bounds.height - 46, width: max(0, container.bounds.width - 230), height: 36))
        headerDrag.autoresizingMask = [.width, .minYMargin]; container.addSubview(headerDrag)
        window.contentView = container; window.delegate = self; window.center()
        applyWindowAppearance()
        activationObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { [weak self] notification in
            guard let self, !self.isolatedTest, self.window.isVisible,
                  let activated = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication,
                  activated.processIdentifier != ProcessInfo.processInfo.processIdentifier else { return }
            self.hideWindow()
        }
        let url = Bundle.main.resourceURL!.appendingPathComponent("web/index.html")
        web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        let defaults = UserDefaults.standard
        if defaults.object(forKey: "hotKeyCode") != nil { hotKeyCode = UInt32(defaults.integer(forKey: "hotKeyCode")); hotKeyModifiers = UInt32(defaults.integer(forKey: "hotKeyModifiers")) }
        hotKeyDisabled = defaults.bool(forKey: "hotKeyDisabled")
        if !isolatedTest {
            status = NSStatusBar.system.statusItem(withLength: 24)
            if let button = status.button {
                button.image = makeStatusIcon()
                button.title = ""
            }
            let menu = NSMenu()
            menu.addItem(withTitle: L("打开 Inkflit"), action: #selector(showWindow), keyEquivalent: "")
            hotKeyItem = menu.addItem(withTitle: L("设置…"), action: #selector(showSettings), keyEquivalent: ",")
            menu.addItem(.separator()); menu.addItem(withTitle: L("退出 Inkflit"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
            status.menu = menu
            var eventType = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
            let handlerStatus = InstallEventHandler(GetApplicationEventTarget(), { _, _, data in
                guard let data else { return OSStatus(eventNotHandledErr) }
                Unmanaged<AppDelegate>.fromOpaque(data).takeUnretainedValue().toggleWindow()
                return noErr
            }, 1, &eventType, Unmanaged.passUnretained(self).toOpaque(), nil)
            if hotKeyDisabled { updateHotKeyLabel() }
            else if handlerStatus != noErr || !registerHotKey(code: hotKeyCode, modifiers: hotKeyModifiers) { reportHotKeyFailure() }
        }
        showWindow()
        if isolatedTest && ProcessInfo.processInfo.environment["QUICKNOTE_TEST_SETTINGS"] == "1" { showSettings() }
    }
    func configureStorage() {
        if let override = ProcessInfo.processInfo.environment["QUICKNOTE_DATA_PATH"] {
            storageURL = URL(fileURLWithPath: override)
            requireExistingStorage = usesNoteFiles && FileManager.default.fileExists(atPath: storageURL.path)
            return
        }
        let defaults = UserDefaults.standard
        let directory = defaults.string(forKey: "notesDirectory").map { URL(fileURLWithPath: $0, isDirectory: true) }
            ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Inkflit", isDirectory: true)
        storageURL = NoteFiles.index(directory)
        requireExistingStorage = defaults.string(forKey: "notesDirectory") != nil || FileManager.default.fileExists(atPath: storageURL.path)
    }
    func changeStorageDirectory(_ directory: URL, completion: @escaping (String?) -> Void) {
        let directory = directory.standardizedFileURL
        let destination = NoteFiles.index(directory)
        if destination == storageURL.standardizedFileURL { completion(nil); return }
        requestFlush { [weak self] success, message in
            guard let self else { completion(L("设置窗口不可用。")); return }
            guard success else { completion(message ?? L("保存失败")); return }
            self.copyStorageDirectory(directory, destination: destination, completion: completion)
        }
    }
    private func copyStorageDirectory(_ directory: URL, destination: URL, completion: @escaping (String?) -> Void) {
        web.evaluateJavaScript("window.exportNotesJSON?.()") { [weak self] value, error in
            guard let self else { completion(L("设置窗口不可用。")); return }
            guard error == nil, let json = value as? String, let data = json.data(using: .utf8) else { completion(NoteStorageError.invalidSnapshot.localizedDescription); return }
            do {
                let snapshot = try NoteFiles.decode(data)
                let source = self.storageURL.deletingLastPathComponent()
                if FileManager.default.fileExists(atPath: NoteFiles.index(source).path) {
                    try NoteFiles.copy(snapshot, from: source, to: directory)
                } else if self.requireExistingStorage {
                    throw NSError(domain: "Inkflit", code: 1, userInfo: [NSLocalizedDescriptionKey: L("笔记文件不存在或位置不可用，请恢复文件后重试。")])
                } else { try NoteFiles.create(snapshot, in: directory) }
                self.storageURL = destination; self.requireExistingStorage = true
                self.loadedSnapshot = snapshot
                if !self.isolatedTest { UserDefaults.standard.set(directory.path, forKey: "notesDirectory") }
                completion(nil)
            } catch { completion(error.localizedDescription) }
        }
    }
    func generateOnboarding(completion: @escaping (String?) -> Void) {
        let data: Data
        do { data = try JSONEncoder().encode(Onboarding.contents(language: Localization.current)) }
        catch { completion(error.localizedDescription); return }
        requestFlush { [weak self] success, message in
            guard let self else { completion(L("设置窗口不可用。")); return }
            guard success else { completion(message ?? L("保存失败")); return }
            do {
                if let expected = self.loadedSnapshot, try NoteFiles.read(self.storageURL.deletingLastPathComponent()) != expected {
                    completion(L("笔记文件已在外部更改，请先保存当前内容并重新启动应用。")); return
                }
            } catch { completion(L("无法读取笔记：") + error.localizedDescription); return }
            self.web.evaluateJavaScript("window.addOnboardingNotesBase64('\(data.base64EncodedString())')") { [weak self] value, error in
                guard let self else { completion(L("设置窗口不可用。")); return }
                guard error == nil, (value as? NSNumber)?.intValue ?? 0 > 0 else {
                    completion(error?.localizedDescription ?? OnboardingError.unavailable.localizedDescription); return
                }
                self.requestFlush { success, message in completion(success ? nil : (message ?? L("保存失败"))) }
            }
        }
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
        let keys: [UInt32: String] = [0:"A",1:"S",2:"D",3:"F",4:"H",5:"G",6:"Z",7:"X",8:"C",9:"V",11:"B",12:"Q",13:"W",14:"E",15:"R",16:"Y",17:"T",18:"1",19:"2",20:"3",21:"4",22:"6",23:"5",24:"=",25:"9",26:"7",27:"-",28:"8",29:"0",30:"]",31:"O",32:"U",33:"[",34:"I",35:"P",36:"Return",37:"L",38:"J",39:"'",40:"K",41:";",42:"\\",43:",",44:"/",45:"N",46:"M",47:".",48:"Tab",49:"Space",50:"`",51:"Delete",53:"Esc",96:"F5",97:"F6",98:"F7",99:"F3",100:"F8",101:"F9",103:"F11",109:"F10",111:"F12",118:"F4",120:"F2",122:"F1",123:"←",124:"→",125:"↓",126:"↑"]
        return text + (keys[hotKeyCode] ?? "Key \(hotKeyCode)")
    }
    func updateHotKeyLabel() {
        let label = hotKeyDisabled ? L("未设置") : shortcutLabel()
        status?.button?.toolTip = hotKeyDisabled ? L("全局快捷键未设置") : L("全局快捷键") + " " + label
        hotKeyItem?.title = L("设置…")
        if let data = try? JSONSerialization.data(withJSONObject: [label]), let json = String(data: data, encoding: .utf8) { web.evaluateJavaScript("window.setShortcutLabel?.(\(json)[0])", completionHandler: nil) }
    }
    func reportHotKeyFailure() {
        status?.button?.toolTip = L("全局快捷键不可用，请在设置中重新设置")
        hotKeyItem?.title = L("设置…（快捷键不可用）")
        if let data = try? JSONSerialization.data(withJSONObject: [L("快捷键不可用")]), let json = String(data: data, encoding: .utf8) { web.evaluateJavaScript("window.setShortcutLabel?.(\(json)[0])", completionHandler: nil) }
    }
    func saveShortcut(code: UInt32, modifiers: UInt32) -> String? {
        if code == hotKeyCode && modifiers == hotKeyModifiers && hotKey != nil { return nil }
        guard registerHotKey(code: code, modifiers: modifiers) else { return L("这个快捷键不可用，请换一个。") }
        hotKeyDisabled = false
        let defaults = UserDefaults.standard
        defaults.set(Int(code), forKey: "hotKeyCode"); defaults.set(Int(modifiers), forKey: "hotKeyModifiers"); defaults.set(false, forKey: "hotKeyDisabled")
        updateHotKeyLabel(); return nil
    }
    func clearShortcut() {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        hotKey = nil; hotKeyDisabled = true
        UserDefaults.standard.set(true, forKey: "hotKeyDisabled")
        updateHotKeyLabel()
    }
    func codeIndentation() -> String {
        let value = UserDefaults.standard.string(forKey: "codeIndentation") ?? "spaces2"
        return ["spaces2", "spaces4", "tabs"].contains(value) ? value : "spaces2"
    }
    func updateCodeIndentation(_ value: String) {
        guard ["spaces2", "spaces4", "tabs"].contains(value) else { return }
        UserDefaults.standard.set(value, forKey: "codeIndentation")
        syncCodeIndentation()
    }
    func syncCodeIndentation() {
        let value = codeIndentation()
        web.evaluateJavaScript("window.setCodeIndentation?.('\(value)')", completionHandler: nil)
    }
    func codeTheme() -> String { CodeThemes.validID(UserDefaults.standard.string(forKey: "codeTheme")) }
    func updateCodeTheme(_ value: String) {
        guard CodeThemes.all.contains(where: { $0.id == value }) else { return }
        UserDefaults.standard.set(value, forKey: "codeTheme"); syncCodeTheme()
    }
    func syncCodeTheme() {
        guard let data = try? JSONSerialization.data(withJSONObject: [codeTheme()]), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.setCodeTheme?.(\(json)[0])", completionHandler: nil)
    }
    func windowAppearance() -> WindowAppearance {
        let defaults = UserDefaults.standard
        let opacity = defaults.object(forKey: "windowOpacity") == nil ? 100 : defaults.integer(forKey: "windowOpacity")
        let blur = defaults.object(forKey: "windowBlur") == nil ? 0 : defaults.integer(forKey: "windowBlur")
        return WindowAppearance(theme: UIThemes.validID(defaults.string(forKey: "uiTheme")), opacity: max(50, min(100, opacity)), blur: max(0, min(100, blur)))
    }
    func updateWindowAppearance(_ appearance: WindowAppearance) {
        let defaults = UserDefaults.standard
        defaults.set(UIThemes.validID(appearance.theme), forKey: "uiTheme")
        defaults.set(max(50, min(100, appearance.opacity)), forKey: "windowOpacity")
        defaults.set(max(0, min(100, appearance.blur)), forKey: "windowBlur")
        applyWindowAppearance()
    }
    func applyWindowAppearance() {
        let appearance = windowAppearance()
        backdrop?.isHidden = appearance.blur == 0; backdrop?.alphaValue = CGFloat(appearance.blur) / 100
        guard let data = try? JSONSerialization.data(withJSONObject: [appearance.theme, appearance.opacity]), let json = String(data: data, encoding: .utf8) else { return }
        web?.evaluateJavaScript("window.setUIAppearance?.(...\(json))", completionHandler: nil)
    }
    func syncLanguage() {
        guard let data = try? JSONSerialization.data(withJSONObject: [Localization.current]), let json = String(data: data, encoding: .utf8) else { return }
        web?.evaluateJavaScript("window.setLanguage?.(\(json)[0])", completionHandler: nil)
        if let menu = NSApp.mainMenu, menu.items.count >= 3 {
            if let app = menu.items[0].submenu, app.items.count >= 3 { app.items[0].title = L("设置…"); app.items[2].title = L("退出 Inkflit") }
            menu.items[1].title = L("编辑"); menu.items[1].submenu?.title = L("编辑")
            if let edit = menu.items[1].submenu { for (i, key) in ["剪切", "复制", "粘贴", "全选"].enumerated() where i < edit.items.count { edit.items[i].title = L(key) } }
            menu.items[2].title = L("窗口"); menu.items[2].submenu?.title = L("窗口"); menu.items[2].submenu?.items.first?.title = L("关闭窗口")
        }
        if let menu = status?.menu, menu.items.count >= 4 { menu.items[0].title = L("打开 Inkflit"); menu.items[1].title = L("设置…"); menu.items[3].title = L("退出 Inkflit") }
        if !isolatedTest { if hotKey != nil || hotKeyDisabled { updateHotKeyLabel() } else { reportHotKeyFailure() } }
    }
    @objc func showSettings() {
        hideWindow()
        if settingsController == nil {
            settingsController = SettingsController(
                getShortcut: { [weak self] in guard let self else { return "" }; return self.hotKeyDisabled ? "" : self.shortcutLabel() },
                saveShortcut: { [weak self] code, modifiers in guard let self else { return L("设置窗口不可用。") }; return self.saveShortcut(code: code, modifiers: modifiers) },
                clearShortcut: { [weak self] in self?.clearShortcut() },
                resetShortcut: { [weak self] in guard let self else { return L("设置窗口不可用。") }; return self.saveShortcut(code: 49, modifiers: UInt32(controlKey | optionKey)) },
                getStorage: { [weak self] in self?.storageURL.path ?? "" },
                changeStorage: { [weak self] url, completion in guard let self else { completion(L("设置窗口不可用。")); return }; self.changeStorageDirectory(url, completion: completion) },
                getIndentation: { [weak self] in self?.codeIndentation() ?? "spaces2" },
                setIndentation: { [weak self] value in self?.updateCodeIndentation(value) },
                getTheme: { [weak self] in self?.codeTheme() ?? "amber" },
                setTheme: { [weak self] value in self?.updateCodeTheme(value) },
                getAppearance: { [weak self] in self?.windowAppearance() ?? WindowAppearance(theme: "orange", opacity: 100, blur: 0) },
                setAppearance: { [weak self] value in self?.updateWindowAppearance(value) },
                loginStatus: { [weak self] in guard let self else { return .notFound }; return self.isolatedTest && ProcessInfo.processInfo.environment["QUICKNOTE_TEST_LOGIN_REAL"] != "1" ? self.testLoginStatus : SMAppService.mainApp.status },
                setLogin: { [weak self] enabled in
                    guard let self else { return L("设置窗口不可用。") }
                    if self.isolatedTest && ProcessInfo.processInfo.environment["QUICKNOTE_TEST_LOGIN_REAL"] != "1" { self.testLoginStatus = enabled ? .enabled : .notRegistered; return nil }
                    do { if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }; return nil }
                    catch { return L("无法更改开机启动：") + error.localizedDescription }
                })
            settingsController?.restoreNote = { [weak self] data in
                guard let self else { return }
                self.web.evaluateJavaScript("window.restoreNoteBase64('\(data.base64EncodedString())')") { [weak self] _, error in
                    if let error { self?.showError(L("恢复失败：") + error.localizedDescription) }
                    else { self?.settingsController?.window?.orderOut(nil); self?.showWindow() }
                }
            }
            settingsController?.generateOnboarding = { [weak self] completion in
                guard let self else { completion(L("设置窗口不可用。")); return }
                self.generateOnboarding { [weak self] error in
                    if error == nil { self?.settingsController?.window?.orderOut(nil); self?.showWindow() }
                    completion(error)
                }
            }
            settingsController?.rebuildIndex = { [weak self] in
                guard let self else { return L("设置窗口不可用。") }
                do {
                    let snapshot = try NoteFiles.rebuildIndex(self.storageURL.deletingLastPathComponent())
                    let data = try JSONEncoder().encode(snapshot)
                    self.loadedSnapshot = snapshot; self.requireExistingStorage = true
                    self.web.evaluateJavaScript("window.loadNotesBase64('\(data.base64EncodedString())')", completionHandler: nil)
                    if !self.isolatedTest { UserDefaults.standard.set(self.storageURL.deletingLastPathComponent().path, forKey: "notesDirectory") }
                    return nil
                } catch { return L("恢复失败：") + error.localizedDescription }
            }
            settingsController?.languageChanged = { [weak self] in
                guard let self else { return }
                self.syncLanguage()
                self.reopenLanguageSettings = true
                self.settingsController?.window?.close(); self.settingsController = nil
                DispatchQueue.main.async { [weak self] in self?.showSettings() }
            }
        }
        if reopenLanguageSettings { settingsController?.selectLanguageTab(); reopenLanguageSettings = false }
        settingsController?.show()
    }
    @objc func showWindow() { hideGeneration += 1; hidePending = false; NSApp.activate(ignoringOtherApps: true); window.makeKeyAndOrderFront(nil); web.evaluateJavaScript("window.focusEditor?.()", completionHandler: nil) }
    func toggleWindow() { if hidePending { showWindow() } else if window.isVisible && window.isKeyWindow { hideWindow() } else { showWindow() } }
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
        if !isolatedTest && window?.isVisible == true { hideWindow() }
    }
    func windowDidBecomeKey(_ notification: Notification) { useVimInputSource() }
    func windowDidResignKey(_ notification: Notification) { restoreInputSource() }
    func applicationWillTerminate(_ notification: Notification) {
        if let activationObserver { NSWorkspace.shared.notificationCenter.removeObserver(activationObserver) }
        restoreInputSource()
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if terminationPending { return .terminateLater }
        terminationPending = true
        requestFlush { [weak self] success, _ in
            self?.terminationPending = false
            if !success { self?.showWindow() }
            sender.reply(toApplicationShouldTerminate: success)
        }
        return .terminateLater
    }
    func hideWindow() {
        hideGeneration += 1; hidePending = true; let request = hideGeneration
        requestFlush { [weak self] success, _ in
            guard let self, self.hideGeneration == request else { return }
            self.hidePending = false
            if success { self.restoreInputSource(); self.window.orderOut(nil) }
            else { self.showWindow() }
        }
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool { hideWindow(); return false }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        syncLanguage()
        syncCodeIndentation()
        syncCodeTheme()
        applyWindowAppearance()
        do {
            let directory = storageURL.deletingLastPathComponent()
            if usesNoteFiles && FileManager.default.fileExists(atPath: NoteFiles.index(directory).path) {
                let snapshot = try NoteFiles.read(directory); loadedSnapshot = snapshot
                let data = try JSONEncoder().encode(snapshot); let base64 = data.base64EncodedString()
                web.evaluateJavaScript("window.loadNotesBase64('\(base64)')", completionHandler: nil)
            } else if !usesNoteFiles && FileManager.default.fileExists(atPath: storageURL.path) {
                let data = try Data(contentsOf: storageURL); let base64 = data.base64EncodedString()
                web.evaluateJavaScript("window.loadNotesBase64('\(base64)')", completionHandler: nil)
            } else if requireExistingStorage {
                showError(L("笔记文件不存在或位置不可用，请恢复文件后重新启动。"))
            } else if usesNoteFiles && (!isolatedTest || ProcessInfo.processInfo.environment["INKFLIT_ONBOARDING_TEST"] == "1") {
                var languages = Locale.preferredLanguages
                #if INKFLIT_NATIVE_TEST
                if let testLanguage = ProcessInfo.processInfo.environment["INKFLIT_TEST_SYSTEM_LANGUAGE"] { languages = [testLanguage] }
                #endif
                let snapshot = try Onboarding.snapshot(language: Localization.resolve(languages))
                try NoteFiles.create(snapshot, in: directory)
                loadedSnapshot = snapshot; requireExistingStorage = true
                if !isolatedTest { UserDefaults.standard.set(directory.path, forKey: "notesDirectory") }
                let data = try JSONEncoder().encode(snapshot)
                web.evaluateJavaScript("window.loadNotesBase64('\(data.base64EncodedString())')", completionHandler: nil)
            } else { web.evaluateJavaScript("window.loadNotesBase64(null)", completionHandler: nil) }
            if !isolatedTest { if hotKey != nil || hotKeyDisabled { updateHotKeyLabel() } else { reportHotKeyFailure() } }
        } catch { showError(L("无法读取笔记：") + error.localizedDescription) }
        #if INKFLIT_NATIVE_TEST
        if isolatedTest && ProcessInfo.processInfo.environment["INKFLIT_TEST_BACKDROP"] == "1" {
            NativeCodeEditingTest.installBackdrop(self)
        }
        if isolatedTest && ProcessInfo.processInfo.environment["INKFLIT_NATIVE_TEST"] == "1" {
            NativeCodeEditingTest.start(self)
        }
        if isolatedTest && ProcessInfo.processInfo.environment["INKFLIT_CURSOR_TEST"] == "1" {
            NativeCodeEditingTest.testCursorColors(self)
        }
        if isolatedTest && ProcessInfo.processInfo.environment["INKFLIT_CHECKLIST_TEST"] == "1" {
            NativeCodeEditingTest.startChecklist(self)
        }
        if isolatedTest && ProcessInfo.processInfo.environment["INKFLIT_TYPOGRAPHY_TEST"] == "1" {
            NativeCodeEditingTest.testTypography(self)
        }
        if isolatedTest && ProcessInfo.processInfo.environment["INKFLIT_TYPOGRAPHY_VIM_TEST"] == "1" {
            NativeCodeEditingTest.startTypographyVim(self)
        }
        if isolatedTest && ProcessInfo.processInfo.environment["INKFLIT_COMMENT_VIM_TEST"] == "1" {
            NativeCodeEditingTest.startCommentVim(self)
        }
        if isolatedTest && ProcessInfo.processInfo.environment["INKFLIT_COMMENT_LAYOUT_TEST"] == "1" {
            NativeCodeEditingTest.testCommentLayout(self)
        }
        if isolatedTest && ProcessInfo.processInfo.environment["INKFLIT_COMMENT_GROUP_VIM_TEST"] == "1" {
            NativeCodeEditingTest.startCommentGroupVim(self)
        }
        if isolatedTest && ProcessInfo.processInfo.environment["INKFLIT_BLOCK_BOUNDARY_TEST"] == "1" {
            NativeCodeEditingTest.startBlockBoundary(self)
        }
        if isolatedTest && ProcessInfo.processInfo.environment["INKFLIT_PLAIN_TEXT_TEST"] == "1" {
            NativeCodeEditingTest.startPlainText(self)
        }
        if isolatedTest && ProcessInfo.processInfo.environment["INKFLIT_FILE_STORAGE_TEST"] == "1" && ProcessInfo.processInfo.environment["INKFLIT_AUTOSAVE_TEST"] != "1" && ProcessInfo.processInfo.environment["INKFLIT_AUTOSAVE_STREAM_TEST"] != "1" && ProcessInfo.processInfo.environment["INKFLIT_ONBOARDING_TEST"] != "1" {
            NativeCodeEditingTest.startFileStorage(self)
        }
        if isolatedTest && ProcessInfo.processInfo.environment["INKFLIT_AUTOSAVE_TEST"] == "1" {
            NativeCodeEditingTest.startAutosave(self)
        }
        if isolatedTest && ProcessInfo.processInfo.environment["INKFLIT_AUTOSAVE_STREAM_TEST"] == "1" {
            NativeCodeEditingTest.startAutosaveStream(self)
        }
        if isolatedTest && ProcessInfo.processInfo.environment["INKFLIT_ONBOARDING_TEST"] == "1" && ProcessInfo.processInfo.environment["INKFLIT_ONBOARDING_COLLISION_TEST"] != "1" {
            NativeCodeEditingTest.startOnboarding(self)
        }
        if isolatedTest && ProcessInfo.processInfo.environment["INKFLIT_ONBOARDING_COLLISION_TEST"] == "1" {
            NativeCodeEditingTest.testOnboardingCollision(self)
        }
        #endif
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.navigationType == .linkActivated { if let url = action.request.url, ["https", "http"].contains(url.scheme?.lowercased() ?? "") { NSWorkspace.shared.open(url) }; decisionHandler(.cancel); return }; decisionHandler(.allow)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert(); alert.messageText = message; alert.addButton(withTitle: L("删除")); alert.addButton(withTitle: L("取消"))
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
    private func queueSave(_ data: Data, revision: Int, force: Bool) {
        guard revision > lastSavedRevision else {
            if force { reportSaveResult(true, error: nil, revision: revision) }
            return
        }
        if let pendingSave, revision < pendingSave.revision {
            if force { let (ok, message) = flushPending(); reportSaveResult(ok, error: message, revision: revision) }
            return
        }
        pendingSave = PendingSave(data: data, revision: revision)
        let now = ProcessInfo.processInfo.systemUptime
        if firstPendingAt == nil { firstPendingAt = now }
        saveWork?.cancel(); saveWork = nil
        if force { _ = flushPending(); return }
        let remaining = max(0, maximumSaveDelay - (now - (firstPendingAt ?? now)))
        let work = DispatchWorkItem { [weak self] in _ = self?.flushPending() }
        saveWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + min(saveDelay, remaining), execute: work)
    }
    @discardableResult private func flushPending() -> (Bool, String?) {
        saveWork?.cancel(); saveWork = nil
        guard let pending = pendingSave else { firstPendingAt = nil; return (true, nil) }
        do {
            try writeSnapshot(pending.data)
            #if INKFLIT_NATIVE_TEST
            testSuccessfulSaves += 1
            testSaveTimes.append(ProcessInfo.processInfo.systemUptime)
            #endif
            lastSavedRevision = pending.revision; pendingSave = nil; firstPendingAt = nil
            reportSaveResult(true, error: nil, revision: pending.revision)
            return (true, nil)
        } catch {
            let message = L("保存失败：") + error.localizedDescription
            reportSaveResult(false, error: message, revision: pending.revision)
            return (false, message)
        }
    }
    private func reportSaveResult(_ ok: Bool, error: String?, revision: Int) {
        guard let data = try? JSONSerialization.data(withJSONObject: [ok, error as Any? ?? NSNull(), revision]),
              let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.saveResult(...\(json))", completionHandler: nil)
    }
    func requestFlush(_ completion: @escaping (Bool, String?) -> Void) {
        web.evaluateJavaScript("window.snapshotForFlush?.()") { [weak self] value, error in
            guard let self else { completion(false, L("设置窗口不可用。")); return }
            if let error {
                let message = L("保存失败：") + error.localizedDescription
                self.showError(message); completion(false, message); return
            }
            if let snapshot = value as? [String: Any] {
                guard let json = snapshot["json"] as? String, let revision = (snapshot["revision"] as? NSNumber)?.intValue,
                      revision >= 0, let data = json.data(using: .utf8) else {
                    let message = L("无法读取当前笔记，保存位置未更改。")
                    self.showError(message); completion(false, message); return
                }
                if revision > self.lastSavedRevision && (self.pendingSave == nil || revision >= self.pendingSave!.revision) {
                    self.pendingSave = PendingSave(data: data, revision: revision)
                    if self.firstPendingAt == nil { self.firstPendingAt = ProcessInfo.processInfo.systemUptime }
                }
            } else if value != nil && !(value is NSNull) {
                let message = L("无法读取当前笔记，保存位置未更改。")
                self.showError(message); completion(false, message); return
            }
            let (success, message) = self.flushPending(); completion(success, message)
        }
    }
    private func writeSnapshot(_ data: Data) throws {
        if usesNoteFiles {
            let directory = storageURL.deletingLastPathComponent(), snapshot = try NoteFiles.decode(data)
            if FileManager.default.fileExists(atPath: NoteFiles.index(directory).path) {
                guard let expected = loadedSnapshot, try NoteFiles.read(directory) == expected else {
                    throw NSError(domain: "Inkflit", code: 3, userInfo: [NSLocalizedDescriptionKey: L("笔记文件已在外部更改，请先保存当前内容并重新启动应用。")])
                }
                let defaults = UserDefaults.standard
                let limit = defaults.object(forKey: "backupVersionLimit") == nil ? 20 : defaults.integer(forKey: "backupVersionLimit")
                try NoteFiles.save(snapshot, directory: directory, backupLimit: max(-1, limit))
            } else if requireExistingStorage {
                throw NSError(domain: "Inkflit", code: 1, userInfo: [NSLocalizedDescriptionKey: L("笔记文件不存在或位置不可用，请恢复文件后重试。")])
            } else { try NoteFiles.create(snapshot, in: directory) }
            loadedSnapshot = snapshot
            if !isolatedTest { UserDefaults.standard.set(directory.path, forKey: "notesDirectory") }
            requireExistingStorage = true; return
        }
        if requireExistingStorage && !FileManager.default.fileExists(atPath: storageURL.path) {
            throw NSError(domain: "Inkflit", code: 1, userInfo: [NSLocalizedDescriptionKey: L("笔记文件不存在或位置不可用，请恢复文件后重试。")])
        }
        try FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try data.write(to: storageURL, options: .atomic)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        if type == "hide" { hideWindow(); return }
        if type == "copyCode", let content = body["content"] as? String {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(content, forType: .string)
            return
        }
        if type == "mode", let mode = body["mode"] as? String {
            setEditorMode(mode)
            return
        }
        guard type == "save", let json = body["json"] as? String, let data = json.data(using: .utf8),
              let revision = (body["revision"] as? NSNumber)?.intValue, revision > 0 else { return }
        queueSave(data, revision: revision, force: body["force"] as? Bool == true)
    }
    func showError(_ message: String) {
        if let data = try? JSONSerialization.data(withJSONObject: [message]), let text = String(data: data, encoding: .utf8) { web.evaluateJavaScript("window.saveResult(false, \(text)[0])", completionHandler: nil) }
    }
}
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
