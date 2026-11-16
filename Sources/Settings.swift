import Cocoa
import Carbon
import ServiceManagement

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
        return super.performKeyEquivalent(with: event)
    }
}
final class SettingsController: NSWindowController {
    private let shortcut = ShortcutField(frame: .zero)
    private let shortcutMessage = NSTextField(wrappingLabelWithString: "点击快捷键，然后按下新的组合键。")
    private let loginSwitch = NSSwitch()
    private let loginMessage = NSTextField(wrappingLabelWithString: "登录 Mac 时自动启动 Inkflit。")
    private let loginSettings = NSButton(title: "打开系统设置", target: nil, action: nil)
    private let getShortcut: () -> String
    private let saveShortcut: (UInt32, UInt32) -> String?
    private let clearShortcut: () -> Void
    private let resetShortcut: () -> String?
    private let loginStatus: () -> SMAppService.Status
    private let setLogin: (Bool) -> String?

    init(getShortcut: @escaping () -> String, saveShortcut: @escaping (UInt32, UInt32) -> String?, clearShortcut: @escaping () -> Void, resetShortcut: @escaping () -> String?, loginStatus: @escaping () -> SMAppService.Status, setLogin: @escaping (Bool) -> String?) {
        self.getShortcut = getShortcut; self.saveShortcut = saveShortcut; self.clearShortcut = clearShortcut
        self.resetShortcut = resetShortcut; self.loginStatus = loginStatus; self.setLogin = setLogin
        let window = SettingsWindow(contentRect: NSRect(x: 0, y: 0, width: 500, height: 340), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
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
    private func section(_ title: String, detail: String, controls: NSView, message: NSTextField) -> NSView {
        let heading = label(title, size: 14, weight: .semibold)
        let subtitle = label(detail, size: 12, color: .secondaryLabelColor)
        let textStack = NSStackView(views: [heading, subtitle]); textStack.orientation = .vertical; textStack.alignment = .leading; textStack.spacing = 4
        let row = NSStackView(views: [textStack, controls]); row.orientation = .horizontal; row.alignment = .centerY; row.distribution = .fill; row.spacing = 16
        textStack.setContentHuggingPriority(.defaultLow, for: .horizontal); controls.setContentHuggingPriority(.required, for: .horizontal)
        message.font = .systemFont(ofSize: 12); message.textColor = .secondaryLabelColor
        let stack = NSStackView(views: [row, message]); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 8
        row.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true
        return stack
    }
    private func buildUI(_ window: SettingsWindow) {
        let title = label("设置", size: 22, weight: .semibold)
        let description = label("让 Inkflit 按你的习惯工作。", size: 12, color: .secondaryLabelColor)
        let header = NSStackView(views: [title, description]); header.orientation = .vertical; header.alignment = .leading; header.spacing = 4
        let clear = NSButton(title: "清除", target: self, action: #selector(clearPressed)); clear.bezelStyle = .rounded; clear.setAccessibilityLabel("清除全局快捷键")
        let reset = NSButton(title: "恢复默认", target: self, action: #selector(resetPressed)); reset.bezelStyle = .rounded
        shortcut.widthAnchor.constraint(greaterThanOrEqualToConstant: 112).isActive = true
        let shortcutControls = NSStackView(views: [shortcut, clear, reset]); shortcutControls.orientation = .horizontal; shortcutControls.alignment = .centerY; shortcutControls.spacing = 4
        let shortcutSection = section("全局快捷键", detail: "随时唤起或收起笔记", controls: shortcutControls, message: shortcutMessage)
        loginSwitch.target = self; loginSwitch.action = #selector(loginChanged); loginSwitch.setAccessibilityLabel("开机启动")
        loginSettings.target = self; loginSettings.action = #selector(openLoginSettings); loginSettings.bezelStyle = .rounded; loginSettings.isHidden = true
        let loginControls = NSStackView(views: [loginSettings, loginSwitch]); loginControls.orientation = .horizontal; loginControls.alignment = .centerY; loginControls.spacing = 8
        let loginSection = section("开机启动", detail: "登录后在菜单栏运行", controls: loginControls, message: loginMessage)
        let separator = NSBox(); separator.boxType = .separator
        let stack = NSStackView(views: [header, separator, shortcutSection, loginSection]); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 24
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView?.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 24),
            separator.widthAnchor.constraint(equalTo: stack.widthAnchor), shortcutSection.widthAnchor.constraint(equalTo: stack.widthAnchor), loginSection.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])
    }
    @objc private func windowBecameKey() { refresh() }
    func refresh() {
        shortcut.displayValue = getShortcut()
        let status = loginStatus()
        loginSwitch.state = status == .enabled || status == .requiresApproval ? .on : .off
        loginSettings.isHidden = status != .requiresApproval
        switch status {
        case .enabled: loginMessage.stringValue = "登录时自动启动已开启。"
        case .requiresApproval: loginMessage.stringValue = "需要在系统设置中允许 Inkflit。"
        case .notFound: loginMessage.stringValue = "登录 Mac 时自动启动 Inkflit。"
        default: loginMessage.stringValue = "登录 Mac 时自动启动 Inkflit。"
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
    func show() { refresh(); showWindow(nil); NSApp.activate(ignoringOtherApps: true); window?.makeKeyAndOrderFront(nil) }
}
