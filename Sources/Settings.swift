import Cocoa
import Carbon
import ServiceManagement
import WebKit

struct CodeTheme: Decodable {
    let id: String
    let title: String
    let colors: [String: String]
    let darkColors: [String: String]
}
enum CodeThemes {
    static let all: [CodeTheme] = {
        guard let url = Bundle.main.url(forResource: "CodeThemes", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let themes = try? JSONDecoder().decode([CodeTheme].self, from: data), !themes.isEmpty else { return [] }
        return themes
    }()
    static func validID(_ id: String?) -> String { all.first(where: { $0.id == id })?.id ?? all.first?.id ?? "amber" }
}
struct UITheme: Decodable { let id: String; let title: String; let colors: [String: String] }
enum UIThemes {
    static let all: [UITheme] = {
        guard let url = Bundle.main.url(forResource: "UIThemes", withExtension: "json"), let data = try? Data(contentsOf: url),
              let themes = try? JSONDecoder().decode([UITheme].self, from: data), !themes.isEmpty else { return [] }
        return themes
    }()
    static func validID(_ id: String?) -> String { all.first(where: { $0.id == id })?.id ?? all.first?.id ?? "orange" }
    static func accent(_ id: String) -> NSColor {
        switch validID(id) { case "blue": return .systemBlue; case "green": return .systemGreen; default: return .systemOrange }
    }
}
struct WindowAppearance { var theme: String; var opacity: Int; var blur: Int }

/// A compact switch with an app-colored on state and standard button behavior.
final class OrangeSwitch: NSButton {
    var accentColor: NSColor = .systemOrange { didSet { needsDisplay = true } }
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        setButtonType(.toggle); isBordered = false; title = ""
        setAccessibilityRole(NSAccessibility.Role(rawValue: "AXSwitch"))
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override var intrinsicContentSize: NSSize { NSSize(width: 50, height: 26) }
    override func draw(_ dirtyRect: NSRect) {
        let track = bounds.insetBy(dx: 1, dy: 2)
        (state == .on ? accentColor : NSColor.quaternaryLabelColor).setFill()
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

/// Keep native slider interaction and accessibility while tinting its track.
final class AccentSliderCell: NSSliderCell {
    var accentColor: NSColor = .systemOrange
    override func drawBar(inside rect: NSRect, flipped: Bool) {
        let knob = knobRect(flipped: flipped)
        let track = NSRect(x: rect.minX + knob.width / 2, y: rect.midY - 2,
                           width: max(0, rect.width - knob.width), height: 4)
        NSColor.quaternaryLabelColor.setFill()
        NSBezierPath(roundedRect: track, xRadius: 2, yRadius: 2).fill()
        let fraction = maxValue > minValue ? max(0, min(1, (doubleValue - minValue) / (maxValue - minValue))) : 0
        let active = NSRect(x: track.minX, y: track.minY, width: track.width * fraction, height: track.height)
        if active.width > 0 { accentColor.setFill(); NSBezierPath(roundedRect: active, xRadius: 2, yRadius: 2).fill() }
    }
}

final class AccentSlider: NSSlider {
    private(set) var optionAtMouseDown = false
    override func mouseDown(with event: NSEvent) {
        optionAtMouseDown = event.modifierFlags.contains(.option)
        defer { optionAtMouseDown = false }
        // AppKit treats Option-click as a jump to an endpoint. Keep its native
        // tracking while reserving Option for five-percent snapping instead.
        if optionAtMouseDown,
           let adjusted = NSEvent.mouseEvent(with: .leftMouseDown, location: event.locationInWindow,
                                             modifierFlags: event.modifierFlags.subtracting(.option),
                                             timestamp: event.timestamp, windowNumber: event.windowNumber,
                                             context: nil, eventNumber: event.eventNumber,
                                             clickCount: event.clickCount, pressure: event.pressure) {
            super.mouseDown(with: adjusted)
        } else { super.mouseDown(with: event) }
    }
}

final class SliderTicks: NSView {
    var accentColor: NSColor = .systemOrange { didSet { needsDisplay = true } }
    override var intrinsicContentSize: NSSize { NSSize(width: 136, height: 8) }
    override func draw(_ dirtyRect: NSRect) {
        accentColor.withAlphaComponent(0.65).setFill()
        let left: CGFloat = 10, width = max(0, bounds.width - 20)
        for index in 0...10 {
            let x = left + width * CGFloat(index) / 10
            NSBezierPath(roundedRect: NSRect(x: x - 0.5, y: 2, width: 1, height: 4), xRadius: 0.5, yRadius: 0.5).fill()
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
        setAccessibilityLabel(L("settings.globalShortcut"))
        refresh()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override var acceptsFirstResponder: Bool { true }
    @objc private func startRecording() {
        recording = true; onMessage?(L("settings.pressShortcutOrEsc"))
        window?.makeFirstResponder(self)
    }
    private func refresh() {
        title = recording ? L("settings.pressShortcut") : (displayValue.isEmpty ? L("settings.addShortcut") : displayValue)
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
            onMessage?(L("settings.shortcutNeedsModifier"))
            NSSound.beep(); return
        }
        if let message = onCapture?(UInt32(event.keyCode), mods) {
            onMessage?(message); NSSound.beep(); return
        }
        recording = false
        onMessage?(L("settings.shortcutUpdated"))
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
final class SettingsController: NSWindowController, NSTextFieldDelegate {
    private let shortcut = ShortcutField(frame: .zero)
    private let shortcutMessage = NSTextField(wrappingLabelWithString: L("settings.globalShortcutHint"))
    private let loginSwitch = OrangeSwitch(frame: .zero)
    private let loginMessage = NSTextField(wrappingLabelWithString: L("settings.launchManually"))
    private let loginSettings = NSButton(title: L("settings.openSystemSettings"), target: nil, action: nil)
    private let storageMessage = NSTextField(wrappingLabelWithString: "")
    private let backupMode = NSPopUpButton(frame: .zero, pullsDown: false)
    private let backupCount = NSTextField(string: String(NoteFiles.defaultBackupLimit))
    private let backupMessage = NSTextField(wrappingLabelWithString: L("settings.automaticBackupsHint"))
    var restoreNote: ((Data) -> Void)?
    var loadSnippets: (() throws -> [UserSnippet])?
    var saveSnippets: (([UserSnippet]) -> String?)?
    var loadPlaceholders: ((@escaping ([[String: Any]]) -> Void) -> Void)? {
        didSet { snippetsEditor.loadPlaceholders = loadPlaceholders }
    }
    private let snippetsEditor = SnippetsEditor()
    private var snippetsLoaded = false
    /// Tabs in order; the raw value is the tab index.
    enum Tab: Int { case general, appearance, edit, snippets, data }
    var rebuildIndex: (() -> String?)?
    var generateOnboarding: ((@escaping (String?) -> Void) -> Void)?
    private let onboardingButton = NSButton(title: L("settings.restoreGuideNotes"), target: nil, action: nil)
    private let vimSwitch = OrangeSwitch(frame: .zero)
    private let indentation = NSPopUpButton(frame: .zero, pullsDown: false)
    private let themePicker = NSPopUpButton(frame: .zero, pullsDown: false)
    private let themePreview = NSTextField(labelWithString: "")
    private let previewBox = NSBox()
    private let uiThemePicker = NSPopUpButton(frame: .zero, pullsDown: false)
    private let languagePicker = NSPopUpButton(frame: .zero, pullsDown: false)
    var languageChanged: (() -> Void)?
    private let opacitySlider = AccentSlider(value: 100, minValue: 50, maxValue: 100, target: nil, action: nil)
    private let blurSlider = AccentSlider(value: 0, minValue: 0, maxValue: 100, target: nil, action: nil)
    private let opacityValue = NSTextField(labelWithString: "100%")
    private let blurValue = NSTextField(labelWithString: "0%")
    private let tabs = NSTabView()
    private var symbols: [NSImageView] = []
    private var sliderTicks: [SliderTicks] = []
    private let getAppearance: () -> WindowAppearance
    private let setAppearance: (WindowAppearance) -> Void
    private let getTheme: () -> String
    private let setTheme: (String) -> Void
    private let getVimEnabled: () -> Bool
    private let setVimEnabled: (Bool) -> Void
    private let getIndentation: () -> String
    private let setIndentation: (String) -> Void
    private let getStorage: () -> String
    private let changeStorage: (URL, @escaping (String?) -> Void) -> Void
    private var helpWindow: NSWindowController?
    private let helpLinks = HelpLinks()
    private let getShortcut: () -> String
    private let saveShortcut: (UInt32, UInt32) -> String?
    private let clearShortcut: () -> Void
    private let resetShortcut: () -> String?
    private let loginStatus: () -> SMAppService.Status
    private let setLogin: (Bool) -> String?

    init(getShortcut: @escaping () -> String, saveShortcut: @escaping (UInt32, UInt32) -> String?, clearShortcut: @escaping () -> Void, resetShortcut: @escaping () -> String?, getStorage: @escaping () -> String, changeStorage: @escaping (URL, @escaping (String?) -> Void) -> Void, getVimEnabled: @escaping () -> Bool, setVimEnabled: @escaping (Bool) -> Void, getIndentation: @escaping () -> String, setIndentation: @escaping (String) -> Void, getTheme: @escaping () -> String, setTheme: @escaping (String) -> Void, getAppearance: @escaping () -> WindowAppearance, setAppearance: @escaping (WindowAppearance) -> Void, loginStatus: @escaping () -> SMAppService.Status, setLogin: @escaping (Bool) -> String?) {
        self.getShortcut = getShortcut; self.saveShortcut = saveShortcut; self.clearShortcut = clearShortcut
        self.resetShortcut = resetShortcut; self.loginStatus = loginStatus; self.setLogin = setLogin
        self.getStorage = getStorage; self.changeStorage = changeStorage
        self.getVimEnabled = getVimEnabled; self.setVimEnabled = setVimEnabled
        self.getIndentation = getIndentation; self.setIndentation = setIndentation
        self.getTheme = getTheme; self.setTheme = setTheme
        self.getAppearance = getAppearance; self.setAppearance = setAppearance
        let window = SettingsWindow(contentRect: NSRect(x: 0, y: 0, width: 600, height: 610), styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = L("settings.windowTitle"); window.isReleasedWhenClosed = false; window.center()
        super.init(window: window)
        window.shortcutField = shortcut
        buildUI(window)
        shortcut.onCapture = { [weak self] code, mods in
            guard let self else { return L("error.settingsUnavailable") }
            let error = self.saveShortcut(code, mods)
            if error == nil { self.shortcut.displayValue = self.getShortcut() }
            return error
        }
        shortcut.onCancel = { [weak self] in self?.shortcutMessage.stringValue = L("settings.shortcutCancelled") }
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
        // Wraps to a second line instead of being cut off in longer languages.
        let subtitle = NSTextField(wrappingLabelWithString: detail); subtitle.font = .systemFont(ofSize: 12); subtitle.textColor = .secondaryLabelColor
        subtitle.maximumNumberOfLines = 2; subtitle.preferredMaxLayoutWidth = 160
        let textStack = NSStackView(views: [heading, subtitle]); textStack.orientation = .vertical; textStack.alignment = .leading; textStack.spacing = 4
        let symbol = NSImageView(); symbol.image = NSImage(systemSymbolName: icon, accessibilityDescription: nil)
        symbol.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 18, weight: .medium)
        symbol.contentTintColor = UIThemes.accent(getAppearance().theme); symbols.append(symbol)
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
    private func page(_ sections: [NSView]) -> NSView {
        let page = NSView(); let stack = NSStackView(views: sections)
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 16; stack.translatesAutoresizingMaskIntoConstraints = false
        page.addSubview(stack)
        NSLayoutConstraint.activate([stack.topAnchor.constraint(equalTo: page.topAnchor, constant: 16), stack.leadingAnchor.constraint(equalTo: page.leadingAnchor, constant: 16), stack.trailingAnchor.constraint(equalTo: page.trailingAnchor, constant: -16), stack.bottomAnchor.constraint(lessThanOrEqualTo: page.bottomAnchor, constant: -12)])
        for section in sections { section.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true }
        return page
    }
    private func sliderControls(_ slider: NSSlider, value: NSTextField, label: String) -> NSView {
        let minValue = slider.minValue, maxValue = slider.maxValue, current = slider.doubleValue
        let cell = AccentSliderCell(); cell.minValue = minValue; cell.maxValue = maxValue; cell.doubleValue = current
        slider.cell = cell; slider.numberOfTickMarks = 11; slider.tickMarkPosition = .above; slider.allowsTickMarkValuesOnly = false
        slider.target = self; slider.action = #selector(appearanceChanged(_:)); slider.isContinuous = true; slider.setAccessibilityLabel(label)
        slider.widthAnchor.constraint(equalToConstant: 136).isActive = true
        let ticks = SliderTicks(); ticks.setAccessibilityElement(false); sliderTicks.append(ticks)
        let sliderColumn = NSStackView(views: [ticks, slider]); sliderColumn.orientation = .vertical; sliderColumn.alignment = .leading; sliderColumn.spacing = 0
        value.font = .monospacedDigitSystemFont(ofSize: 12, weight: .regular); value.textColor = .secondaryLabelColor
        value.widthAnchor.constraint(equalToConstant: 36).isActive = true
        let controls = NSStackView(views: [sliderColumn, value]); controls.orientation = .horizontal; controls.alignment = .centerY; controls.spacing = 8
        return controls
    }
    private func buildUI(_ window: SettingsWindow) {
        let title = label(L("settings.title"), size: 20, weight: .semibold)
        let description = label(L("settings.subtitle"), size: 12, color: .secondaryLabelColor)
        let header = NSStackView(views: [title, description]); header.orientation = .vertical; header.alignment = .leading; header.spacing = 4
        let clear = NSButton(title: L("settings.clear"), target: self, action: #selector(clearPressed)); clear.bezelStyle = .rounded; clear.setAccessibilityLabel(L("settings.clearGlobalShortcut"))
        let reset = NSButton(title: L("settings.reset"), target: self, action: #selector(resetPressed)); reset.bezelStyle = .rounded
        shortcut.widthAnchor.constraint(greaterThanOrEqualToConstant: 112).isActive = true
        let shortcutControls = NSStackView(views: [shortcut, clear, reset]); shortcutControls.orientation = .horizontal; shortcutControls.alignment = .centerY; shortcutControls.spacing = 4
        let shortcutSection = section(L("settings.globalShortcut"), icon: "keyboard", detail: L("settings.globalShortcutDetail"), controls: shortcutControls, message: shortcutMessage)
        loginSwitch.target = self; loginSwitch.action = #selector(loginChanged); loginSwitch.setAccessibilityLabel(L("settings.launchAtLogin"))
        loginSettings.target = self; loginSettings.action = #selector(openLoginSettings); loginSettings.bezelStyle = .rounded; loginSettings.isHidden = true
        let loginControls = NSStackView(views: [loginSettings, loginSwitch]); loginControls.orientation = .horizontal; loginControls.alignment = .centerY; loginControls.spacing = 8
        let loginSection = section(L("settings.launchAtLogin"), icon: "power", detail: L("settings.launchAtLoginDetail"), controls: loginControls, message: loginMessage)
        let chooseStorage = NSButton(title: L("settings.chooseFolder"), target: self, action: #selector(chooseStoragePressed)); chooseStorage.bezelStyle = .rounded
        storageMessage.lineBreakMode = .byTruncatingMiddle; storageMessage.maximumNumberOfLines = 1
        let storageSection = section(L("settings.notesLocation"), icon: "folder", detail: L("settings.notesLocationDetail"), controls: chooseStorage, message: storageMessage)
        for (title, value) in [(L("settings.off"), "off"), (L("settings.backupLimited"), "limited"), (L("settings.backupUnlimited"), "unlimited")] { backupMode.addItem(withTitle: title); backupMode.lastItem?.representedObject = value }
        backupMode.target = self; backupMode.action = #selector(backupChanged)
        backupCount.widthAnchor.constraint(equalToConstant: 56).isActive = true
        let countFormatter = NumberFormatter(); countFormatter.numberStyle = .decimal; countFormatter.minimum = 1; countFormatter.maximum = 1000000; countFormatter.allowsFloats = false
        backupCount.formatter = countFormatter; backupCount.target = self; backupCount.action = #selector(backupChanged)
        backupCount.delegate = self
        backupCount.setAccessibilityLabel(L("settings.backupVersionCount"))
        let backupControls = NSStackView(views: [backupMode, backupCount]); backupControls.orientation = .horizontal; backupControls.spacing = 6
        let backupSection = section(L("settings.automaticBackups"), icon: "clock.arrow.circlepath", detail: L("settings.automaticBackupsDetail"), controls: backupControls, message: backupMessage)
        let restoreBackup = NSButton(title: L("settings.restorePreviousVersion"), target: self, action: #selector(restoreBackupPressed)); restoreBackup.bezelStyle = .rounded
        let historySection = section(L("settings.previousVersions"), icon: "clock", detail: L("settings.previousVersionsDetail"), controls: restoreBackup, message: NSTextField(wrappingLabelWithString: L("settings.previousVersionsHint")))
        let restore = NSButton(title: L("settings.restoreDeletedNote"), target: self, action: #selector(restorePressed)); restore.bezelStyle = .rounded
        let trashSection = section(L("settings.trash"), icon: "trash", detail: L("settings.trashDetail"), controls: restore, message: NSTextField(wrappingLabelWithString: L("settings.trashHint")))
        let rebuild = NSButton(title: L("settings.rebuildIndex"), target: self, action: #selector(rebuildPressed)); rebuild.bezelStyle = .rounded
        let rebuildSection = section(L("settings.indexRecovery"), icon: "wrench.and.screwdriver", detail: L("settings.indexRecoveryDetail"), controls: rebuild, message: NSTextField(wrappingLabelWithString: L("settings.indexRecoveryHint")))
        vimSwitch.target = self; vimSwitch.action = #selector(vimChanged); vimSwitch.setAccessibilityLabel(L("settings.vimMode"))
        let vimSection = section(L("settings.vimMode"), icon: "keyboard", detail: L("settings.vimModeDetail"), controls: vimSwitch, message: NSTextField(wrappingLabelWithString: L("settings.vimModeHint")))
        for (title, value) in [(L("settings.indentTwoSpaces"), "spaces2"), (L("settings.indentFourSpaces"), "spaces4"), ("Tab", "tabs")] {
            indentation.addItem(withTitle: title); indentation.lastItem?.representedObject = value
        }
        indentation.target = self; indentation.action = #selector(indentationChanged); indentation.setAccessibilityLabel(L("settings.codeIndentation"))
        let indentMessage = NSTextField(wrappingLabelWithString: L("settings.codeIndentationHint"))
        let indentSection = section(L("settings.codeIndentation"), icon: "increase.indent", detail: L("settings.codeIndentationDetail"), controls: indentation, message: indentMessage)
        for theme in CodeThemes.all { themePicker.addItem(withTitle: L(theme.title)); themePicker.lastItem?.representedObject = theme.id }
        themePicker.target = self; themePicker.action = #selector(themeChanged); themePicker.setAccessibilityLabel(L("settings.codeColors"))
        let themeMessage = NSTextField(wrappingLabelWithString: L("settings.codeColorsHint"))
        let themeSection = section(L("settings.codeColors"), icon: "paintpalette", detail: L("settings.codeColorsDetail"), controls: themePicker, message: themeMessage)
        themePreview.font = .monospacedSystemFont(ofSize: 12, weight: .regular); themePreview.maximumNumberOfLines = 0
        themePreview.setAccessibilityLabel(L("settings.codeColorPreview"))
        previewBox.boxType = .custom; previewBox.borderWidth = 0
        previewBox.fillColor = NSColor(calibratedRed: 1, green: 0.992, blue: 0.98, alpha: 1); previewBox.cornerRadius = 8
        themePreview.translatesAutoresizingMaskIntoConstraints = false; previewBox.addSubview(themePreview)
        NSLayoutConstraint.activate([themePreview.leadingAnchor.constraint(equalTo: previewBox.leadingAnchor, constant: 12), themePreview.trailingAnchor.constraint(equalTo: previewBox.trailingAnchor, constant: -12), themePreview.topAnchor.constraint(equalTo: previewBox.topAnchor, constant: 8), themePreview.bottomAnchor.constraint(equalTo: previewBox.bottomAnchor, constant: -8)])
        let previewRow = NSView(); previewBox.translatesAutoresizingMaskIntoConstraints = false; previewRow.addSubview(previewBox)
        NSLayoutConstraint.activate([previewBox.leadingAnchor.constraint(equalTo: previewRow.leadingAnchor, constant: 44), previewBox.trailingAnchor.constraint(equalTo: previewRow.trailingAnchor), previewBox.topAnchor.constraint(equalTo: previewRow.topAnchor), previewBox.bottomAnchor.constraint(equalTo: previewRow.bottomAnchor)])
        let themeGroup = NSStackView(views: [themeSection, previewRow]); themeGroup.orientation = .vertical; themeGroup.alignment = .leading; themeGroup.spacing = 8
        themeSection.widthAnchor.constraint(equalTo: themeGroup.widthAnchor).isActive = true; previewRow.widthAnchor.constraint(equalTo: themeGroup.widthAnchor).isActive = true
        for theme in UIThemes.all { uiThemePicker.addItem(withTitle: L(theme.title)); uiThemePicker.lastItem?.representedObject = theme.id }
        uiThemePicker.target = self; uiThemePicker.action = #selector(appearanceChanged(_:)); uiThemePicker.setAccessibilityLabel(L("settings.accentColor"))
        let uiThemeSection = section(L("settings.accentColor"), icon: "paintbrush", detail: L("settings.accentColorDetail"), controls: uiThemePicker, message: NSTextField(wrappingLabelWithString: L("settings.changesApplyImmediately")))
        let opacitySection = section(L("settings.windowOpacity"), icon: "circle.lefthalf.filled", detail: L("settings.windowOpacityDetail"), controls: sliderControls(opacitySlider, value: opacityValue, label: L("settings.windowOpacity")), message: NSTextField(wrappingLabelWithString: L("settings.windowOpacityHint")))
        let blurSection = section(L("settings.backgroundBlur"), icon: "drop.halffull", detail: L("settings.backgroundBlurDetail"), controls: sliderControls(blurSlider, value: blurValue, label: L("settings.backgroundBlur")), message: NSTextField(wrappingLabelWithString: L("settings.backgroundBlurHint")))
        tabs.tabViewType = .topTabsBezelBorder
        for (title, value) in [(L("settings.languageSystem"), "system"), ("English", "en"), ("简体中文", "zh-Hans"), ("繁體中文", "zh-Hant"), ("日本語", "ja")] {
            languagePicker.addItem(withTitle: title); languagePicker.lastItem?.representedObject = value
        }
        languagePicker.target = self; languagePicker.action = #selector(changeLanguage)
        languagePicker.setAccessibilityLabel(L("settings.language"))
        let languageSection = section(L("settings.language"), icon: "globe", detail: L("settings.languageDetail"), controls: languagePicker, message: NSTextField(wrappingLabelWithString: L("settings.languageHint")))
        snippetsEditor.save = { [weak self] snippets in self?.saveSnippets?(snippets) }
        let snippetsSection = section(L("settings.snippets"), icon: "text.badge.plus", detail: L("settings.snippetsDetail"), controls: NSView(), message: NSTextField(wrappingLabelWithString: L("settings.snippetsHint")))
        let pages: [(Tab, String, NSView)] = [
            (.general, L("settings.general"), page([languageSection, loginSection, shortcutSection])),
            (.appearance, L("settings.appearance"), page([uiThemeSection, opacitySection, blurSection, themeGroup])),
            (.edit, L("app.edit"), page([vimSection, indentSection])),
            (.snippets, L("settings.snippets"), page([snippetsSection, snippetsEditor])),
            (.data, L("settings.data"), page([storageSection, backupSection, historySection, trashSection, rebuildSection])),
        ]
        for (tab, title, content) in pages {
            precondition(tab.rawValue == tabs.numberOfTabViewItems, "tabs must be added in Tab order")
            let item = NSTabViewItem(identifier: title); item.label = title; item.view = content; tabs.addTabViewItem(item)
        }
        tabs.heightAnchor.constraint(equalToConstant: 460).isActive = true
        let help = NSButton(title: L("settings.openHelp"), target: self, action: #selector(openHelp)); help.bezelStyle = .rounded
        onboardingButton.target = self; onboardingButton.action = #selector(onboardingPressed); onboardingButton.bezelStyle = .rounded
        let copyright = label("© 2026 phpz.org", size: 11, color: .secondaryLabelColor)
        let footerActions = NSStackView(views: [onboardingButton, help]); footerActions.orientation = .horizontal; footerActions.spacing = 6
        let footer = NSStackView(views: [copyright, footerActions]); footer.orientation = .horizontal; footer.alignment = .centerY; footer.distribution = .gravityAreas
        let stack = NSStackView(views: [header, tabs, footer]); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView?.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 24), stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 20), stack.bottomAnchor.constraint(lessThanOrEqualTo: window.contentView!.bottomAnchor, constant: -16),
            tabs.widthAnchor.constraint(equalTo: stack.widthAnchor), footer.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])
    }
    @objc private func windowBecameKey() { refresh() }
    func refresh() {
        if let index = languagePicker.itemArray.firstIndex(where: { ($0.representedObject as? String) == Localization.preference }) { languagePicker.selectItem(at: index) }
        shortcut.displayValue = getShortcut()
        vimSwitch.state = getVimEnabled() ? .on : .off
        vimSwitch.accentColor = UIThemes.accent(getAppearance().theme)
        if let index = indentation.itemArray.firstIndex(where: { ($0.representedObject as? String) == getIndentation() }) { indentation.selectItem(at: index) }
        if let index = themePicker.itemArray.firstIndex(where: { ($0.representedObject as? String) == getTheme() }) { themePicker.selectItem(at: index) }
        renderThemePreview(getTheme())
        let appearance = getAppearance()
        if let index = uiThemePicker.itemArray.firstIndex(where: { ($0.representedObject as? String) == appearance.theme }) { uiThemePicker.selectItem(at: index) }
        opacitySlider.integerValue = appearance.opacity; blurSlider.integerValue = appearance.blur
        opacityValue.stringValue = "\(appearance.opacity)%"; blurValue.stringValue = "\(appearance.blur)%"
        applySettingsAccent(appearance.theme)
        let storagePath = URL(fileURLWithPath: getStorage()).deletingLastPathComponent().path
        storageMessage.stringValue = storagePath; storageMessage.toolTip = storagePath
        let defaults = UserDefaults.standard, limit = defaults.object(forKey: "backupVersionLimit") == nil ? NoteFiles.defaultBackupLimit : defaults.integer(forKey: "backupVersionLimit")
        let mode = limit == 0 ? "off" : limit < 0 ? "unlimited" : "limited"
        if let index = backupMode.itemArray.firstIndex(where: { ($0.representedObject as? String) == mode }) { backupMode.selectItem(at: index) }
        backupCount.integerValue = limit > 0 ? limit : max(1, defaults.integer(forKey: "backupPreviousLimit"))
        backupCount.isEnabled = mode == "limited"
        let status = loginStatus()
        loginSwitch.state = status == .enabled || status == .requiresApproval ? .on : .off
        loginSwitch.setAccessibilityValue(loginSwitch.state == .on ? 1 : 0); loginSwitch.needsDisplay = true
        loginSettings.isHidden = status != .requiresApproval
        switch status {
        case .enabled: loginMessage.stringValue = L("settings.launchAtLoginOn")
        case .requiresApproval: loginMessage.stringValue = L("settings.launchAtLoginNeedsApproval")
        case .notFound: loginMessage.stringValue = L("settings.launchManually")
        default: loginMessage.stringValue = L("settings.launchManually")
        }
    }
    @objc private func clearPressed() { shortcut.recording = false; clearShortcut(); refresh(); shortcutMessage.stringValue = L("settings.globalShortcutCleared") }
    @objc private func changeLanguage() {
        guard let value = languagePicker.selectedItem?.representedObject as? String, value == "system" || Localization.supported.contains(value) else { return }
        UserDefaults.standard.set(value, forKey: "language"); languageChanged?()
    }
    func select(_ tab: Tab) { tabs.selectTabViewItem(at: tab.rawValue) }
    /// Loads snippets.json into the editor; on the first show and after the
    /// notes folder changes, not on every refresh, so edits in progress stay.
    func reloadSnippets() {
        guard let loadSnippets else { return }
        snippetsLoaded = true
        do { snippetsEditor.load(try loadSnippets()) } catch { snippetsEditor.loadFailed(error.localizedDescription) }
    }
    @objc private func resetPressed() { shortcut.recording = false; let error = resetShortcut(); refresh(); shortcutMessage.stringValue = error ?? L("settings.defaultShortcutRestored") }
    @objc private func loginChanged() {
        let requested = loginSwitch.state == .on
        let error = setLogin(requested)
        refresh()
        if let error { loginMessage.stringValue = error }
    }
    @objc private func openLoginSettings() { SMAppService.openSystemSettingsLoginItems() }
    @objc private func vimChanged() { setVimEnabled(vimSwitch.state == .on) }
    @objc private func indentationChanged() {
        guard let value = indentation.selectedItem?.representedObject as? String else { return }
        setIndentation(value)
    }
    static func sliderValue(_ value: Int, optionPressed: Bool) -> Int {
        optionPressed ? Int((Double(value) / 5).rounded()) * 5 : value
    }
    @objc private func appearanceChanged(_ sender: Any?) {
        guard let theme = uiThemePicker.selectedItem?.representedObject as? String else { return }
        if let slider = sender as? NSSlider, slider === opacitySlider || slider === blurSlider {
            let option = (slider as? AccentSlider)?.optionAtMouseDown == true || (NSApp.currentEvent?.modifierFlags ?? []).contains(.option) || NSEvent.modifierFlags.contains(.option)
            slider.integerValue = Self.sliderValue(slider.integerValue, optionPressed: option)
        }
        let appearance = WindowAppearance(theme: theme, opacity: opacitySlider.integerValue, blur: blurSlider.integerValue)
        opacityValue.stringValue = "\(appearance.opacity)%"; blurValue.stringValue = "\(appearance.blur)%"
        applySettingsAccent(theme)
        setAppearance(appearance)
    }
    private func applySettingsAccent(_ theme: String) {
        let accent = UIThemes.accent(theme)
        symbols.forEach { $0.contentTintColor = accent }
        loginSwitch.accentColor = accent; vimSwitch.accentColor = accent
        sliderTicks.forEach { $0.accentColor = accent }
        for slider in [opacitySlider, blurSlider] {
            (slider.cell as? AccentSliderCell)?.accentColor = accent
            slider.needsDisplay = true
        }
    }
    private func renderThemePreview(_ id: String) {
        guard let theme = CodeThemes.all.first(where: { $0.id == CodeThemes.validID(id) }) else { return }
        let dark = window?.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        previewBox.fillColor = dark ? NSColor(calibratedWhite: 0.12, alpha: 1) : NSColor(calibratedRed: 1, green: 0.992, blue: 0.98, alpha: 1)
        let palette = dark ? theme.darkColors : theme.colors
        let text = "{\n  \"name\": \"Inkflit\",\n  \"active\": true,\n  \"count\": 42\n}"
        func color(_ key: String) -> NSColor {
            let hex = palette[key]?.trimmingCharacters(in: CharacterSet(charactersIn: "#")) ?? "302921"
            let value = UInt64(hex, radix: 16) ?? 0x302921
            return NSColor(calibratedRed: CGFloat((value >> 16) & 255) / 255, green: CGFloat((value >> 8) & 255) / 255, blue: CGFloat(value & 255) / 255, alpha: 1)
        }
        let attributed = NSMutableAttributedString(string: text, attributes: [.font: NSFont.monospacedSystemFont(ofSize: 12, weight: .regular), .foregroundColor: color("punctuation")])
        let source = text as NSString
        for (key, tokens) in [("property", ["\"name\"", "\"active\"", "\"count\""]), ("string", ["\"Inkflit\""]), ("keyword", ["true"]), ("number", ["42"])] {
            for token in tokens { let range = source.range(of: token); if range.location != NSNotFound { attributed.addAttribute(.foregroundColor, value: color(key), range: range) } }
        }
        themePreview.attributedStringValue = attributed
    }
    @objc private func themeChanged() {
        guard let value = themePicker.selectedItem?.representedObject as? String else { return }
        renderThemePreview(value); setTheme(value)
    }
    #if INKFLIT_NATIVE_TEST
    func testSelectCodeTheme(_ id: String) -> String? {
        guard let index = themePicker.itemArray.firstIndex(where: { ($0.representedObject as? String) == id }) else { return nil }
        themePicker.selectItem(at: index)
        NSApp.sendAction(#selector(themeChanged), to: self, from: themePicker)
        guard let color = themePreview.attributedStringValue.attribute(.foregroundColor, at: 4, effectiveRange: nil) as? NSColor else { return nil }
        return String(format: "#%02x%02x%02x", Int((color.redComponent*255).rounded()), Int((color.greenComponent*255).rounded()), Int((color.blueComponent*255).rounded()))
    }
    func testSetAppearance(_ appearance: WindowAppearance) -> Bool {
        guard let index = uiThemePicker.itemArray.firstIndex(where: { ($0.representedObject as? String) == appearance.theme }) else { return false }
        uiThemePicker.selectItem(at: index); opacitySlider.integerValue = appearance.opacity; blurSlider.integerValue = appearance.blur
        return NSApp.sendAction(#selector(appearanceChanged(_:)), to: self, from: uiThemePicker)
    }
    func testAppearanceControls(_ theme: String) -> Bool {
        let accent = UIThemes.accent(theme)
        guard loginSwitch.accentColor == accent, vimSwitch.accentColor == accent,
              symbols.allSatisfy({ $0.contentTintColor == accent }), sliderTicks.count == 2,
              sliderTicks.allSatisfy({ $0.accentColor == accent }),
              let page = tabs.tabViewItem(at: Tab.appearance.rawValue).view else { return false }
        page.layoutSubtreeIfNeeded()
        return [opacitySlider, blurSlider].allSatisfy { slider in
            guard let cell = slider.cell as? AccentSliderCell else { return false }
            return cell.accentColor == accent && slider.numberOfTickMarks == 11 && slider.tickMarkPosition == .above && !slider.allowsTickMarkValuesOnly && page.bounds.insetBy(dx: -1, dy: -1).contains(slider.convert(slider.bounds, to: page))
        }
    }
    func testClickSlider(blur: Bool, option: Bool) -> Int? {
        guard let window else { return nil }
        let slider = blur ? blurSlider : opacitySlider
        let point = slider.convert(NSPoint(x: slider.bounds.width * 0.66, y: slider.bounds.midY), to: nil)
        let flags: NSEvent.ModifierFlags = option ? .option : []
        func event(_ type: NSEvent.EventType) -> NSEvent? {
            NSEvent.mouseEvent(with: type, location: point, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 1, clickCount: 1, pressure: 1)
        }
        guard let down=event(.leftMouseDown), let up=event(.leftMouseUp) else { return nil }
        NSApp.postEvent(up, atStart: false); NSApp.sendEvent(down)
        return slider.integerValue
    }
    func testDragSlider(blur: Bool, option: Bool) -> Int? {
        guard let window else { return nil }
        let slider = blur ? blurSlider : opacitySlider
        let start = slider.convert(NSPoint(x: slider.bounds.width * 0.3, y: slider.bounds.midY), to: nil)
        let end = slider.convert(NSPoint(x: slider.bounds.width * 0.66, y: slider.bounds.midY), to: nil)
        let flags: NSEvent.ModifierFlags = option ? .option : []
        func event(_ type: NSEvent.EventType, _ point: NSPoint) -> NSEvent? {
            NSEvent.mouseEvent(with: type, location: point, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 1, clickCount: 1, pressure: 1)
        }
        guard let down=event(.leftMouseDown,start), let drag=event(.leftMouseDragged,end), let up=event(.leftMouseUp,end) else { return nil }
        NSApp.postEvent(drag, atStart: false); NSApp.postEvent(up, atStart: false); NSApp.sendEvent(down)
        return slider.integerValue
    }
    func testSetSliderValues(opacity: Int, blur: Int) -> Bool {
        opacitySlider.integerValue = opacity; blurSlider.integerValue = blur
        return NSApp.sendAction(#selector(appearanceChanged(_:)), to: self, from: opacitySlider)
    }
    func testSaveSettingsScreenshot(_ path: String) -> Bool {
        guard let view=window?.contentView, let image=view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return false }
        view.cacheDisplay(in: view.bounds, to: image)
        guard let data=image.representation(using: .png, properties: [:]) else { return false }
        do { try data.write(to: URL(fileURLWithPath: path)); return true } catch { return false }
    }
    func testEditingControlsVisible() -> Bool {
        // A tab is laid out only while selected, so check each page on its own tab.
        let selected = tabs.selectedTabViewItem.map { tabs.indexOfTabViewItem($0) } ?? Tab.edit.rawValue
        defer { tabs.selectTabViewItem(at: selected) }
        func fits(_ views: [NSView], on tab: Tab) -> Bool {
            select(tab); window?.contentView?.layoutSubtreeIfNeeded()
            guard let page = tabs.tabViewItem(at: tab.rawValue).view else { return false }
            return views.allSatisfy { page.bounds.insetBy(dx: -1, dy: -1).contains($0.convert($0.bounds, to: page)) }
        }
        return fits([previewBox], on: .appearance) && fits([vimSwitch, indentation], on: .edit)
    }
    func testToggleVim() { vimSwitch.performClick(nil) }
    func testSnippetsEditor() -> SnippetsEditor { snippetsEditor }
    func testTabCount() -> Int { tabs.numberOfTabViewItems }
    func testVimSwitchState() -> Bool { vimSwitch.state == .on }
    func testSelectSettingsTab(_ index: Int) { tabs.selectTabViewItem(at: index) }
    func testGenerateOnboarding() -> Bool {
        guard let root = window?.contentView else { return false }
        root.layoutSubtreeIfNeeded()
        let rect = onboardingButton.convert(onboardingButton.bounds, to: root)
        guard onboardingButton.isEnabled, root.bounds.contains(rect) else { return false }
        onboardingButton.performClick(nil); return true
    }
    func testBackupControls() -> Bool {
        select(.data); window?.contentView?.layoutSubtreeIfNeeded()
        guard let page = tabs.tabViewItem(at: Tab.data.rawValue).view else { return false }
        for (mode, expected) in [("off", 0), ("unlimited", -1), ("limited", 7)] {
            guard let index = backupMode.itemArray.firstIndex(where: { ($0.representedObject as? String) == mode }) else { return false }
            backupMode.selectItem(at: index); backupCount.integerValue = 7; backupChanged()
            guard UserDefaults.standard.integer(forKey: "backupVersionLimit") == expected else { return false }
        }
        func buttons(_ view: NSView) -> [NSButton] { (view as? NSButton).map { [$0] } ?? [] + view.subviews.flatMap(buttons) }
        let controls = buttons(page).filter { [L("settings.restorePreviousVersion"), L("settings.restoreDeletedNote"), L("settings.rebuildIndex")].contains($0.title) }
        return controls.count == 3 && controls.allSatisfy { page.bounds.contains($0.convert($0.bounds, to: page)) }
    }
    func testSelectLanguage(_ id: String) -> Bool {
        guard let index = languagePicker.itemArray.firstIndex(where: { ($0.representedObject as? String) == id }) else { return false }
        languagePicker.selectItem(at: index)
        return NSApp.sendAction(#selector(changeLanguage), to: self, from: languagePicker)
    }
    #endif
    @objc private func chooseStoragePressed() {
        guard let window else { return }
        let panel = NSOpenPanel(); panel.title = L("settings.chooseNotesFolder"); panel.message = L("settings.notesLocationHint")
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
    @objc private func backupChanged() {
        let defaults = UserDefaults.standard, mode = backupMode.selectedItem?.representedObject as? String ?? "limited"
        let count = max(1, min(1_000_000, backupCount.integerValue))
        if mode == "limited" { defaults.set(count, forKey: "backupPreviousLimit") }
        defaults.set(mode == "off" ? 0 : mode == "unlimited" ? -1 : count, forKey: "backupVersionLimit")
        refresh()
    }
    func controlTextDidEndEditing(_ notification: Notification) {
        if let field = notification.object as? NSTextField, field === backupCount { backupChanged() }
    }
    @objc private func restorePressed() {
        chooseRecoveryFile(folder: "trash", title: L("settings.restoreDeletedNote"))
    }
    @objc private func onboardingPressed() {
        guard let generateOnboarding else { return }
        onboardingButton.isEnabled = false
        generateOnboarding { [weak self] error in
            guard let self else { return }
            self.onboardingButton.isEnabled = true
            if let error, let window = self.window {
                let alert = NSAlert(); alert.messageText = L("error.createGuideNotes"); alert.informativeText = error
                alert.beginSheetModal(for: window)
            }
        }
    }
    @objc private func restoreBackupPressed() {
        chooseRecoveryFile(folder: "backups", title: L("settings.restorePreviousVersion"))
    }
    @objc private func rebuildPressed() {
        guard let window else { return }
        let alert = NSAlert(); alert.messageText = L("settings.rebuildIndexTitle")
        alert.informativeText = L("settings.rebuildIndexMessage")
        alert.addButton(withTitle: L("settings.rebuildIndexConfirm")); alert.addButton(withTitle: L("app.cancel"))
        alert.beginSheetModal(for: window) { [weak self] response in
            guard response == .alertFirstButtonReturn, let self else { return }
            if let error = self.rebuildIndex?() { self.backupMessage.stringValue = error }
            else { self.backupMessage.stringValue = L("settings.indexRebuilt") }
        }
    }
    private func chooseRecoveryFile(folder: String, title: String) {
        guard let window else { return }
        let recovery = URL(fileURLWithPath: getStorage()).deletingLastPathComponent().appendingPathComponent(folder, isDirectory: true)
        let panel = NSOpenPanel(); panel.title = title; panel.directoryURL = recovery
        panel.canChooseFiles = true; panel.canChooseDirectories = false; panel.allowsMultipleSelection = false
        panel.beginSheetModal(for: window) { [weak self] result in
            guard result == .OK, let self, let file = panel.url else { return }
            let path = file.resolvingSymlinksInPath().standardizedFileURL.path
            let root = recovery.resolvingSymlinksInPath().standardizedFileURL.path + "/"
            guard path.hasPrefix(root), file.pathExtension.lowercased() == "md", let data = try? Data(contentsOf: file), String(data: data, encoding: .utf8) != nil else {
                self.backupMessage.stringValue = L("error.chooseRecoveryMarkdown"); return
            }
            self.restoreNote?(data)
        }
    }
    // Entry points for the command palette.
    func openHelpWindow() { openHelp() }
    @objc private func openHelp() {
        // One page holds every language; the query picks the language and accent.
        guard let page = Bundle.main.url(forResource: "Help", withExtension: "html"),
              var components = URLComponents(url: page, resolvingAgainstBaseURL: false) else { NSSound.beep(); return }
        components.queryItems = [URLQueryItem(name: "lang", value: Localization.current), URLQueryItem(name: "theme", value: getAppearance().theme)]
        guard let url = components.url else { NSSound.beep(); return }
        if helpWindow == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 980, height: 720), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            window.title = L("settings.helpWindowTitle"); window.isReleasedWhenClosed = false; window.center()
            let web = WKWebView(frame: .zero)
            web.navigationDelegate = helpLinks
            window.contentView = web
            helpWindow = NSWindowController(window: window)
        }
        // Reload each time so a changed language or accent is picked up.
        (helpWindow?.window?.contentView as? WKWebView)?.loadFileURL(url, allowingReadAccessTo: page.deletingLastPathComponent())
        helpWindow?.showWindow(nil); helpWindow?.window?.makeKeyAndOrderFront(nil)
    }
    func show() {
        refresh()
        if !snippetsLoaded { reloadSnippets() }
        #if INKFLIT_NATIVE_TEST
        if let value = ProcessInfo.processInfo.environment["INKFLIT_TEST_TAB"], let index = Int(value), index >= 0, index < tabs.numberOfTabViewItems { tabs.selectTabViewItem(at: index) }
        #endif
        showWindow(nil); NSApp.activate(ignoringOtherApps: true); window?.makeKeyAndOrderFront(nil)
    }
}

/// Opens web links from the help page in the default browser instead of the help window.
final class HelpLinks: NSObject, WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
            NSWorkspace.shared.open(url); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }
}

/// Settings → Snippets: a table of trigger and content, like macOS text
/// replacements, with the selected row's full content edited below. Rows
/// that share a trigger form a group; the first is the default.
final class SnippetsEditor: NSView, NSTableViewDataSource, NSTableViewDelegate, NSTextFieldDelegate, NSTextViewDelegate, NSMenuDelegate {
    var save: (([UserSnippet]) -> String?)?
    /// Built-in rows from the page: trigger, token ({token} names the row),
    /// example value and description, in the app language.
    var loadPlaceholders: ((@escaping ([[String: Any]]) -> Void) -> Void)?
    private var placeholders: [[String: Any]] = []
    private let insertPlaceholder = NSPopUpButton(frame: .zero, pullsDown: true)
    private var rows: [UserSnippet] = []
    private var editable = true
    private let table = NSTableView()
    private let content = NSTextView()
    private let buttons = NSSegmentedControl(images: [NSImage(named: NSImage.addTemplateName)!, NSImage(named: NSImage.removeTemplateName)!], trackingMode: .momentary, target: nil, action: nil)
    private let status = NSTextField(wrappingLabelWithString: "")
    private let empty = NSTextField(labelWithString: L("settings.snippetsEmpty"))
    private var pendingSave: DispatchWorkItem?

    init() {
        super.init(frame: .zero)
        let trigger = NSTableColumn(identifier: .init("trigger")); trigger.title = L("settings.snippetTrigger"); trigger.width = 120; trigger.minWidth = 80
        let value = NSTableColumn(identifier: .init("content")); value.title = L("settings.snippetContent")
        table.addTableColumn(trigger); table.addTableColumn(value)
        table.dataSource = self; table.delegate = self; table.usesAlternatingRowBackgroundColors = true; table.rowHeight = 22
        table.columnAutoresizingStyle = .lastColumnOnlyAutoresizingStyle; table.setAccessibilityLabel(L("settings.snippets"))
        let tableScroll = NSScrollView(); tableScroll.documentView = table; tableScroll.hasVerticalScroller = true; tableScroll.borderType = .bezelBorder
        buttons.target = self; buttons.action = #selector(buttonPressed)
        buttons.setToolTip(L("settings.snippetAdd"), forSegment: 0); buttons.setToolTip(L("settings.snippetRemove"), forSegment: 1)
        content.isRichText = false; content.font = .monospacedSystemFont(ofSize: 12, weight: .regular); content.delegate = self
        content.isAutomaticQuoteSubstitutionEnabled = false; content.isAutomaticDashSubstitutionEnabled = false; content.isAutomaticTextReplacementEnabled = false
        content.textContainerInset = NSSize(width: 4, height: 4); content.setAccessibilityLabel(L("settings.snippetContent"))
        let contentScroll = NSScrollView(); contentScroll.documentView = content; contentScroll.hasVerticalScroller = true; contentScroll.borderType = .bezelBorder
        content.minSize = NSSize(width: 0, height: 0); content.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: .greatestFiniteMagnitude)
        content.isVerticallyResizable = true; content.autoresizingMask = [.width]; content.textContainer?.widthTracksTextView = true
        status.font = .systemFont(ofSize: 12); status.textColor = .secondaryLabelColor
        empty.font = .systemFont(ofSize: 12); empty.textColor = .tertiaryLabelColor
        insertPlaceholder.bezelStyle = .rounded; insertPlaceholder.controlSize = .small
        insertPlaceholder.menu?.delegate = self; insertPlaceholder.addItem(withTitle: L("settings.insertPlaceholder"))
        insertPlaceholder.setAccessibilityLabel(L("settings.insertPlaceholder"))
        for view in [tableScroll, buttons, insertPlaceholder, contentScroll, status, empty] { view.translatesAutoresizingMaskIntoConstraints = false; addSubview(view) }
        NSLayoutConstraint.activate([
            tableScroll.topAnchor.constraint(equalTo: topAnchor), tableScroll.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 44), tableScroll.trailingAnchor.constraint(equalTo: trailingAnchor),
            tableScroll.heightAnchor.constraint(equalToConstant: 150),
            empty.centerXAnchor.constraint(equalTo: tableScroll.centerXAnchor), empty.centerYAnchor.constraint(equalTo: tableScroll.centerYAnchor, constant: 10),
            buttons.topAnchor.constraint(equalTo: tableScroll.bottomAnchor, constant: 6), buttons.leadingAnchor.constraint(equalTo: tableScroll.leadingAnchor),
            insertPlaceholder.centerYAnchor.constraint(equalTo: buttons.centerYAnchor), insertPlaceholder.trailingAnchor.constraint(equalTo: trailingAnchor),
            contentScroll.topAnchor.constraint(equalTo: buttons.bottomAnchor, constant: 10), contentScroll.leadingAnchor.constraint(equalTo: tableScroll.leadingAnchor), contentScroll.trailingAnchor.constraint(equalTo: trailingAnchor),
            contentScroll.heightAnchor.constraint(equalToConstant: 80),
            status.topAnchor.constraint(equalTo: contentScroll.bottomAnchor, constant: 6), status.leadingAnchor.constraint(equalTo: tableScroll.leadingAnchor), status.trailingAnchor.constraint(equalTo: trailingAnchor),
            status.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        updateControls()
    }
    required init?(coder: NSCoder) { nil }

    func load(_ snippets: [UserSnippet]) {
        rows = snippets; editable = true; status.stringValue = ""; status.textColor = .secondaryLabelColor
        table.reloadData(); updateControls(); refreshPlaceholders()
    }

    // MARK: Placeholders
    private func refreshPlaceholders() { loadPlaceholders? { [weak self] list in self?.placeholders = list } }
    /// One submenu per trigger; each item shows {token} and an example.
    func menuNeedsUpdate(_ menu: NSMenu) {
        while menu.items.count > 1 { menu.removeItem(at: 1) }
        var groups: [(String, NSMenu)] = []
        for item in placeholders {
            guard let trigger = item["trigger"] as? String, let token = item["token"] as? String else { continue }
            if groups.last?.0 != trigger { groups.append((trigger, NSMenu())) }
            let example = (item["example"] as? String) ?? (item["description"] as? String) ?? ""
            let entry = NSMenuItem(title: "{\(token)}", action: #selector(placeholderChosen(_:)), keyEquivalent: "")
            entry.target = self; entry.representedObject = token
            let title = NSMutableAttributedString(string: "{\(token)}", attributes: [.font: NSFont.monospacedSystemFont(ofSize: 12, weight: .medium)])
            if !example.isEmpty { title.append(NSAttributedString(string: "   \(example)", attributes: [.font: NSFont.systemFont(ofSize: 12), .foregroundColor: NSColor.secondaryLabelColor])) }
            entry.attributedTitle = title
            groups[groups.count - 1].1.addItem(entry)
        }
        for (trigger, submenu) in groups {
            let item = NSMenuItem(title: "@\(trigger)", action: nil, keyEquivalent: ""); item.submenu = submenu; menu.addItem(item)
        }
        refreshPlaceholders()   // examples are fresh the next time the menu opens
    }
    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool { menuItem.action != #selector(placeholderChosen(_:)) || content.isEditable }
    @objc private func placeholderChosen(_ sender: NSMenuItem) {
        guard content.isEditable, let token = sender.representedObject as? String else { return }
        window?.makeFirstResponder(content)
        content.insertText("{\(token)}", replacementRange: content.selectedRange())
    }
    /// The file exists but cannot be read: show why and do not allow edits,
    /// so the file is never replaced by an empty list.
    func loadFailed(_ message: String) {
        rows = []; editable = false; table.reloadData()
        status.stringValue = L("settings.snippetsUnreadable") + message; status.textColor = .systemRed
        updateControls()
    }

    // MARK: Table
    func numberOfRows(in tableView: NSTableView) -> Int { rows.count }
    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let isTrigger = tableColumn?.identifier.rawValue == "trigger"
        let field = NSTextField(labelWithString: "")
        field.lineBreakMode = .byTruncatingTail; field.font = isTrigger ? .monospacedSystemFont(ofSize: 12, weight: .medium) : .systemFont(ofSize: 12)
        if isTrigger {
            field.stringValue = rows[row].trigger; field.isEditable = editable; field.delegate = self; field.tag = row
            field.placeholderString = "addr"
            field.textColor = rows[row].trigger.isEmpty || UserSnippet.isValidTrigger(rows[row].trigger) ? .labelColor : .systemRed
        } else {
            let lines = rows[row].content.split(separator: "\n", omittingEmptySubsequences: false)
            field.stringValue = (lines.first.map(String.init) ?? "") + (lines.count > 1 ? " …" : "")
            field.textColor = .secondaryLabelColor
        }
        return field
    }
    func tableViewSelectionDidChange(_ notification: Notification) { updateControls() }
    func controlTextDidEndEditing(_ notification: Notification) {
        guard let field = notification.object as? NSTextField, rows.indices.contains(field.tag) else { return }
        rows[field.tag].trigger = field.stringValue.trimmingCharacters(in: .whitespaces).lowercased()
        table.reloadData(forRowIndexes: [field.tag], columnIndexes: [0, 1])
        scheduleSave()
    }

    // MARK: Content
    func textDidChange(_ notification: Notification) {
        let row = table.selectedRow
        guard rows.indices.contains(row) else { return }
        rows[row].content = content.string
        table.reloadData(forRowIndexes: [row], columnIndexes: [1])
        scheduleSave()
    }

    @objc private func buttonPressed() {
        if buttons.selectedSegment == 0 {
            rows.append(UserSnippet(trigger: "", content: "")); table.reloadData()
            let row = rows.count - 1
            table.selectRowIndexes([row], byExtendingSelection: false); table.scrollRowToVisible(row)
            table.editColumn(0, row: row, with: nil, select: true)
        } else if rows.indices.contains(table.selectedRow) {
            let row = table.selectedRow
            rows.remove(at: row); table.reloadData()
            if !rows.isEmpty { table.selectRowIndexes([min(row, rows.count - 1)], byExtendingSelection: false) }
            scheduleSave()
        }
        updateControls()
    }

    private func updateControls() {
        let row = table.selectedRow, selected = rows.indices.contains(row)
        buttons.setEnabled(editable, forSegment: 0); buttons.setEnabled(editable && selected, forSegment: 1)
        content.isEditable = editable && selected
        if content.string != (selected ? rows[row].content : "") { content.string = selected ? rows[row].content : "" }
        empty.isHidden = !rows.isEmpty || !editable
    }

    // Saved shortly after typing stops. Rows without a valid trigger or
    // content stay in the table but are not saved yet.
    private func scheduleSave() {
        pendingSave?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.saveNow() }
        pendingSave = work; DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: work)
    }
    func saveNow() {
        guard editable, let save else { return }
        pendingSave?.cancel(); pendingSave = nil
        let valid = rows.filter { UserSnippet.isValidTrigger($0.trigger) && !$0.content.isEmpty }
        if let error = save(valid) { status.stringValue = error; status.textColor = .systemRed; return }
        let invalid = rows.contains { !$0.trigger.isEmpty && !UserSnippet.isValidTrigger($0.trigger) }
        status.stringValue = invalid ? L("settings.snippetInvalidTrigger") : ""; status.textColor = invalid ? .systemRed : .secondaryLabelColor
    }

    #if INKFLIT_NATIVE_TEST
    func testRows() -> [UserSnippet] { rows }
    func testAdd(trigger: String, content text: String) {
        rows.append(UserSnippet(trigger: trigger, content: text)); table.reloadData()
        table.selectRowIndexes([rows.count - 1], byExtendingSelection: false); updateControls(); saveNow()
    }
    func testEditSelectedContent(_ text: String) { content.string = text; textDidChange(Notification(name: NSText.didChangeNotification)); saveNow() }
    func testRemoveSelected() { buttons.selectedSegment = 1; buttonPressed(); saveNow() }
    func testIsEditable() -> Bool { editable }
    func testStatus() -> String { status.stringValue }
    func testPlaceholderTokens() -> [String] {
        guard let menu = insertPlaceholder.menu else { return [] }
        menuNeedsUpdate(menu)
        return menu.items.dropFirst().flatMap { $0.submenu?.items.compactMap { $0.representedObject as? String } ?? [] }
    }
    func testInsertPlaceholder(_ token: String) -> String {
        guard let menu = insertPlaceholder.menu else { return "" }
        menuNeedsUpdate(menu)
        if let item = menu.items.flatMap({ $0.submenu?.items ?? [] }).first(where: { $0.representedObject as? String == token }) { placeholderChosen(item) }
        saveNow(); return content.string
    }
    #endif
}
