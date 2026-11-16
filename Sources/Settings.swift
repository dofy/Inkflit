import Cocoa
import Carbon
import ServiceManagement
import WebKit

/// A compact switch with an app-colored on state and standard button behavior.
final class OrangeSwitch: NSButton {
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setButtonType(.toggle); isBordered = false; title = ""
        setAccessibilityRole(NSAccessibility.Role(rawValue: "AXSwitch"))
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override var intrinsicContentSize: NSSize { NSSize(width: 50, height: 26) }
    override func draw(_ dirtyRect: NSRect) {
        let track = bounds.insetBy(dx: 1, dy: 2)
        (state == .on ? NSColor.systemOrange : NSColor.quaternaryLabelColor).setFill()
        NSBezierPath(roundedRect: track, xRadius: track.height / 2, yRadius: track.height / 2).fill()
        let size = track.height - 4
        let x = state == .on ? track.maxX - size - 2 : track.minX + 2
        NSColor.white.setFill()
        NSBezierPath(ovalIn: NSRect(x: x, y: track.minY + 2, width: size, height: size)).fill()
        if window?.firstResponder === self {
            NSColor.keyboardFocusIndicatorColor.setStroke()
            let focus = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: bounds.height / 2, yRadius: bounds.height / 2)
            focus.lineWidth = 1; focus.stroke()
        }
    }
}

/// A native keyboard shortcut field. Recording stays focused until a valid
/// shortcut is accepted or the user presses Escape.
final class ShortcutField: NSButton {
    var onCapture: ((UInt32, UInt32) -> String?)?
    var onCancel: (() -> Void)?
    var recording = false { didSet { refresh() } }
    var displayValue = "" { didSet { if !recording { refresh() } } }
    var onMessage: ((String) -> Void)?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        bezelStyle = .rounded; font = .monospacedSystemFont(ofSize: 13, weight: .medium)
        target = self; action = #selector(startRecording)
        setAccessibilityLabel("全局快捷键")
        refresh()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override var acceptsFirstResponder: Bool { true }
    @objc private func startRecording() {
        recording = true; onMessage?("按下组合键，按 Esc 取消。")
        window?.makeFirstResponder(self)
    }
    private func refresh() {
        title = recording ? "输入快捷键…" : (displayValue.isEmpty ? "添加快捷键" : displayValue)
        setAccessibilityValue(title)
    }
    override func keyDown(with event: NSEvent) {
        guard recording else { super.keyDown(with: event); return }
        if event.keyCode == 53 { recording = false; onCancel?(); return }
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        var mods: UInt32 = 0
        if flags.contains(.control) { mods |= UInt32(controlKey) }
        if flags.contains(.option) { mods |= UInt32(optionKey) }
        if flags.contains(.shift) { mods |= UInt32(shiftKey) }
        if flags.contains(.command) { mods |= UInt32(cmdKey) }
        guard mods & UInt32(controlKey | optionKey | cmdKey) != 0 else {
            onMessage?("请包含 ⌘、⌥ 或 ⌃。")
            NSSound.beep(); return
        }
        if let message = onCapture?(UInt32(event.keyCode), mods) {
            onMessage?(message); NSSound.beep(); return
        }
        recording = false
        onMessage?("快捷键已更新。")
    }
}
final class SettingsWindow: NSWindow {
    weak var shortcutField: ShortcutField?
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if let field = shortcutField, field.recording, firstResponder === field {
            field.keyDown(with: event); return true
        }
        if event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command, event.charactersIgnoringModifiers?.lowercased() == "w" {
            performClose(nil); return true
        }
        return super.performKeyEquivalent(with: event)
    }
}
final class SettingsController: NSWindowController {
    private let shortcut = ShortcutField(frame: .zero)
    private let shortcutMessage = NSTextField(wrappingLabelWithString: "点击快捷键，然后按下新的组合键。")
    private let loginSwitch = OrangeSwitch(frame: .zero)
    private let loginMessage = NSTextField(wrappingLabelWithString: "当前为手动启动。")
    private let loginSettings = NSButton(title: "打开系统设置", target: nil, action: nil)
    private let storageMessage = NSTextField(wrappingLabelWithString: "")
    private let indentation = NSPopUpButton(frame: .zero, pullsDown: false)
    private let getIndentation: () -> String
    private let setIndentation: (String) -> Void
    private let getStorage: () -> String
    private let changeStorage: (URL, @escaping (String?) -> Void) -> Void
    private var helpWindow: NSWindowController?
    private let getShortcut: () -> String
    private let saveShortcut: (UInt32, UInt32) -> String?
    private let clearShortcut: () -> Void
    private let resetShortcut: () -> String?
    private let loginStatus: () -> SMAppService.Status
    private let setLogin: (Bool) -> String?

    init(getShortcut: @escaping () -> String, saveShortcut: @escaping (UInt32, UInt32) -> String?, clearShortcut: @escaping () -> Void, resetShortcut: @escaping () -> String?, getStorage: @escaping () -> String, changeStorage: @escaping (URL, @escaping (String?) -> Void) -> Void, getIndentation: @escaping () -> String, setIndentation: @escaping (String) -> Void, loginStatus: @escaping () -> SMAppService.Status, setLogin: @escaping (Bool) -> String?) {
        self.getShortcut = getShortcut; self.saveShortcut = saveShortcut; self.clearShortcut = clearShortcut
        self.resetShortcut = resetShortcut; self.loginStatus = loginStatus; self.setLogin = setLogin
        self.getStorage = getStorage; self.changeStorage = changeStorage
        self.getIndentation = getIndentation; self.setIndentation = setIndentation
        let window = SettingsWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 570), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Inkflit 设置"; window.isReleasedWhenClosed = false; window.center()
        super.init(window: window)
        window.shortcutField = shortcut
        buildUI(window)
        shortcut.onCapture = { [weak self] code, mods in
            guard let self else { return "设置窗口不可用。" }
            let error = self.saveShortcut(code, mods)
            if error == nil { self.shortcut.displayValue = self.getShortcut() }
            return error
        }
        shortcut.onCancel = { [weak self] in self?.shortcutMessage.stringValue = "已取消，原快捷键保持不变。" }
        shortcut.onMessage = { [weak self] in self?.shortcutMessage.stringValue = $0 }
        NotificationCenter.default.addObserver(self, selector: #selector(windowBecameKey), name: NSWindow.didBecomeKeyNotification, object: window)
        refresh()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    deinit { NotificationCenter.default.removeObserver(self) }
    private func label(_ text: String, size: CGFloat, weight: NSFont.Weight = .regular, color: NSColor = .labelColor) -> NSTextField {
        let field = NSTextField(labelWithString: text); field.font = .systemFont(ofSize: size, weight: weight); field.textColor = color; return field
    }
    private func section(_ title: String, icon: String, detail: String, controls: NSView, message: NSTextField) -> NSView {
        let heading = label(title, size: 14, weight: .semibold)
        let subtitle = label(detail, size: 12, color: .secondaryLabelColor)
        let textStack = NSStackView(views: [heading, subtitle]); textStack.orientation = .vertical; textStack.alignment = .leading; textStack.spacing = 4
        let symbol = NSImageView(); symbol.image = NSImage(systemSymbolName: icon, accessibilityDescription: nil)
        symbol.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 18, weight: .medium)
        symbol.contentTintColor = .systemOrange
        symbol.imageScaling = .scaleProportionallyDown; symbol.setAccessibilityElement(false)
        symbol.widthAnchor.constraint(equalToConstant: 32).isActive = true; symbol.heightAnchor.constraint(equalToConstant: 32).isActive = true
        textStack.widthAnchor.constraint(equalToConstant: 160).isActive = true
        let spacer = NSView(); spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
        let row = NSStackView(views: [symbol, textStack, controls, spacer]); row.orientation = .horizontal; row.alignment = .centerY; row.distribution = .fill; row.spacing = 12
        controls.setContentHuggingPriority(.required, for: .horizontal)
        message.font = .systemFont(ofSize: 12); message.textColor = .secondaryLabelColor
        let container = NSView(); row.translatesAutoresizingMaskIntoConstraints = false; message.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(row); container.addSubview(message)
        NSLayoutConstraint.activate([
            row.topAnchor.constraint(equalTo: container.topAnchor), row.leadingAnchor.constraint(equalTo: container.leadingAnchor), row.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            message.topAnchor.constraint(equalTo: row.bottomAnchor, constant: 8), message.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 44),
            message.trailingAnchor.constraint(equalTo: container.trailingAnchor), message.bottomAnchor.constraint(equalTo: container.bottomAnchor)
        ])
        return container
    }
    private func buildUI(_ window: SettingsWindow) {
        let title = label("设置", size: 20, weight: .semibold)
        let description = label("按你的习惯使用 Inkflit", size: 12, color: .secondaryLabelColor)
        let header = NSStackView(views: [title, description]); header.orientation = .vertical; header.alignment = .leading; header.spacing = 4
        let clear = NSButton(title: "清除", target: self, action: #selector(clearPressed)); clear.bezelStyle = .rounded; clear.setAccessibilityLabel("清除全局快捷键")
        let reset = NSButton(title: "恢复默认", target: self, action: #selector(resetPressed)); reset.bezelStyle = .rounded
        shortcut.widthAnchor.constraint(greaterThanOrEqualToConstant: 112).isActive = true
        let shortcutControls = NSStackView(views: [shortcut, clear, reset]); shortcutControls.orientation = .horizontal; shortcutControls.alignment = .centerY; shortcutControls.spacing = 4
        let shortcutSection = section("全局快捷键", icon: "keyboard", detail: "随时唤起或收起笔记", controls: shortcutControls, message: shortcutMessage)
        loginSwitch.target = self; loginSwitch.action = #selector(loginChanged); loginSwitch.setAccessibilityLabel("开机启动")
        loginSettings.target = self; loginSettings.action = #selector(openLoginSettings); loginSettings.bezelStyle = .rounded; loginSettings.isHidden = true
        let loginControls = NSStackView(views: [loginSettings, loginSwitch]); loginControls.orientation = .horizontal; loginControls.alignment = .centerY; loginControls.spacing = 8
        let loginSection = section("开机启动", icon: "power", detail: "登录 Mac 后自动运行", controls: loginControls, message: loginMessage)
        let chooseStorage = NSButton(title: "选择文件夹…", target: self, action: #selector(chooseStoragePressed)); chooseStorage.bezelStyle = .rounded
        storageMessage.lineBreakMode = .byTruncatingMiddle; storageMessage.maximumNumberOfLines = 1
        let storageSection = section("笔记保存位置", icon: "folder", detail: "更改时保留原文件", controls: chooseStorage, message: storageMessage)
        for (title, value) in [("2 个空格", "spaces2"), ("4 个空格", "spaces4"), ("Tab", "tabs")] {
            indentation.addItem(withTitle: title); indentation.lastItem?.representedObject = value
        }
        indentation.target = self; indentation.action = #selector(indentationChanged); indentation.setAccessibilityLabel("代码缩进")
        let indentMessage = NSTextField(wrappingLabelWithString: "回车自动缩进；Tab 插入缩进。")
        let indentSection = section("代码缩进", icon: "increase.indent", detail: "代码块使用的缩进方式", controls: indentation, message: indentMessage)
        let separator = NSBox(); separator.boxType = .separator
        let help = NSButton(title: "打开使用帮助", target: self, action: #selector(openHelp)); help.bezelStyle = .rounded
        let copyright = label("© 2026 phpz.org", size: 11, color: .secondaryLabelColor)
        let footer = NSStackView(views: [copyright, help]); footer.orientation = .horizontal; footer.alignment = .centerY; footer.distribution = .gravityAreas
        let stack = NSStackView(views: [header, separator, loginSection, shortcutSection, indentSection, storageSection, footer]); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 24
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView?.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 24),
            separator.widthAnchor.constraint(equalTo: stack.widthAnchor), shortcutSection.widthAnchor.constraint(equalTo: stack.widthAnchor), loginSection.widthAnchor.constraint(equalTo: stack.widthAnchor), indentSection.widthAnchor.constraint(equalTo: stack.widthAnchor), storageSection.widthAnchor.constraint(equalTo: stack.widthAnchor), footer.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])
    }
    @objc private func windowBecameKey() { refresh() }
    func refresh() {
        shortcut.displayValue = getShortcut()
        if let index = indentation.itemArray.firstIndex(where: { ($0.representedObject as? String) == getIndentation() }) { indentation.selectItem(at: index) }
        storageMessage.stringValue = getStorage(); storageMessage.toolTip = getStorage()
        let status = loginStatus()
        loginSwitch.state = status == .enabled || status == .requiresApproval ? .on : .off
        loginSwitch.setAccessibilityValue(loginSwitch.state == .on ? 1 : 0); loginSwitch.needsDisplay = true
        loginSettings.isHidden = status != .requiresApproval
        switch status {
        case .enabled: loginMessage.stringValue = "已在登录时自动启动。"
        case .requiresApproval: loginMessage.stringValue = "需要在系统设置中允许 Inkflit。"
        case .notFound: loginMessage.stringValue = "当前为手动启动。"
        default: loginMessage.stringValue = "当前为手动启动。"
        }
    }
    @objc private func clearPressed() { shortcut.recording = false; clearShortcut(); refresh(); shortcutMessage.stringValue = "全局快捷键已清除。" }
    @objc private func resetPressed() { shortcut.recording = false; let error = resetShortcut(); refresh(); shortcutMessage.stringValue = error ?? "已恢复默认快捷键。" }
    @objc private func loginChanged() {
        let requested = loginSwitch.state == .on
        let error = setLogin(requested)
        refresh()
        if let error { loginMessage.stringValue = error }
    }
    @objc private func openLoginSettings() { SMAppService.openSystemSettingsLoginItems() }
    @objc private func indentationChanged() {
        guard let value = indentation.selectedItem?.representedObject as? String else { return }
        setIndentation(value)
    }
    @objc private func chooseStoragePressed() {
        guard let window else { return }
        let panel = NSOpenPanel(); panel.title = "选择笔记保存文件夹"; panel.message = "Inkflit 会将当前笔记复制为 notes.json，原文件会保留。"
        panel.canChooseDirectories = true; panel.canChooseFiles = false; panel.allowsMultipleSelection = false; panel.canCreateDirectories = true
        panel.directoryURL = URL(fileURLWithPath: getStorage()).deletingLastPathComponent()
        panel.beginSheetModal(for: window) { [weak self] result in
            guard result == .OK, let self, let directory = panel.url else { return }
            self.changeStorage(directory) { [weak self] error in
                guard let self else { return }
                self.refresh()
                if let error { self.storageMessage.stringValue = error; self.storageMessage.toolTip = error }
            }
        }
    }
    @objc private func openHelp() {
        guard let url = Bundle.main.url(forResource: "Help", withExtension: "html") else { NSSound.beep(); return }
        if helpWindow == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 760, height: 680), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            window.title = "Inkflit 使用帮助"; window.isReleasedWhenClosed = false; window.center()
            let web = WKWebView(frame: .zero)
            window.contentView = web
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
            helpWindow = NSWindowController(window: window)
        }
        helpWindow?.showWindow(nil); helpWindow?.window?.makeKeyAndOrderFront(nil)
    }
    func show() { refresh(); showWindow(nil); NSApp.activate(ignoringOtherApps: true); window?.makeKeyAndOrderFront(nil) }
}
