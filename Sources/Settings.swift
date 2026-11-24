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
    static var defaultID: String { all.first?.id ?? "github" }
    static func validID(_ id: String?) -> String { all.first(where: { $0.id == id })?.id ?? defaultID }
}
private final class CodeThemePreviewBox: NSBox {
    var onAppearanceChange: (() -> Void)?
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        onAppearanceChange?()
    }
}
private func paletteColor(_ hex: String?) -> NSColor? {
    guard let hex, hex.count == 7, hex.first == "#", let value = UInt64(hex.dropFirst(), radix: 16) else { return nil }
    return NSColor(srgbRed: CGFloat((value >> 16) & 255) / 255, green: CGFloat((value >> 8) & 255) / 255, blue: CGFloat(value & 255) / 255, alpha: 1)
}
struct UITheme: Decodable {
    let id: String
    let title: String
    let colors: [String: String]
    let darkColors: [String: String]
}
enum UIThemes {
    static let all: [UITheme] = {
        guard let url = Bundle.main.url(forResource: "UIThemes", withExtension: "json"), let data = try? Data(contentsOf: url),
              let themes = try? JSONDecoder().decode([UITheme].self, from: data), !themes.isEmpty else { return [] }
        return themes
    }()
    static func validID(_ id: String?) -> String { all.first(where: { $0.id == id })?.id ?? all.first?.id ?? "orange" }
    private static let paletteAccents = Dictionary(uniqueKeysWithValues: all.compactMap { theme -> (String, NSColor)? in
        guard let light = paletteColor(theme.colors["accent"]),
              let dark = paletteColor(theme.darkColors["accent"]) else { return nil }
        return (theme.id, NSColor(name: nil, dynamicProvider: { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
        }))
    })
    static func accent(_ id: String) -> NSColor {
        let theme = validID(id)
        switch theme {
        case "orange": return .systemOrange
        case "blue": return .systemBlue
        case "green": return .systemGreen
        default: return paletteAccents[theme] ?? .systemOrange
        }
    }
}
enum WindowColorScheme: String, CaseIterable {
    case system, light, dark

    var title: String {
        switch self {
        case .system: return L("settings.appearanceSystem")
        case .light: return L("settings.appearanceLight")
        case .dark: return L("settings.appearanceDark")
        }
    }
    var appearanceName: NSAppearance.Name? {
        switch self {
        case .system: return nil
        case .light: return .aqua
        case .dark: return .darkAqua
        }
    }
}
enum NotePaper: String, CaseIterable {
    case plain, xuan, felt, sandstone, linen

    var title: String {
        switch self {
        case .plain: return L("settings.paperPlain")
        case .xuan: return L("settings.paperXuan")
        case .felt: return L("settings.paperFelt")
        case .sandstone: return L("settings.paperSandstone")
        case .linen: return L("settings.paperLinen")
        }
    }
}
struct WindowAppearance {
    static let defaultTextureStrength = 50

    var theme: String
    var opacity: Int
    var blur: Int
    var colorScheme: WindowColorScheme = .system
    var typography = EditorTypography()
    var paper: NotePaper = .plain
    var textureStrength = WindowAppearance.defaultTextureStrength
}

struct EditorTypography {
    static let defaultSize = 14
    static let sizes = 10...32
    static let families = NSFontManager.shared.availableFontFamilies.sorted { $0.localizedStandardCompare($1) == .orderedAscending }

    let family: String
    let size: Int

    init(family: String = "", size: Int = defaultSize) {
        self.family = family.isEmpty || Self.families.contains(family) ? family : ""
        self.size = Self.sizes.contains(size) ? size : Self.defaultSize
    }
}

struct CodeLineNumberPreferences {
    var enabled = false
    var relative = false
}

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
        (state == .on && isEnabled ? accentColor : NSColor.quaternaryLabelColor).setFill()
        NSBezierPath(roundedRect: track, xRadius: track.height / 2, yRadius: track.height / 2).fill()
        let size = track.height - 4
        let x = state == .on ? track.maxX - size - 2 : track.minX + 2
        NSColor.white.setFill()
        NSBezierPath(ovalIn: NSRect(x: x, y: track.minY + 2, width: size, height: size)).fill()
        if isEnabled && window?.firstResponder === self {
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
        if isEnabled && active.width > 0 { accentColor.setFill(); NSBezierPath(roundedRect: active, xRadius: 2, yRadius: 2).fill() }
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
    weak var slider: NSSlider?
    var accentColor: NSColor = .systemOrange { didSet { needsDisplay = true } }
    override var intrinsicContentSize: NSSize { NSSize(width: 136, height: 8) }
    override func draw(_ dirtyRect: NSRect) {
        (slider?.isEnabled == false ? NSColor.quaternaryLabelColor : accentColor.withAlphaComponent(0.65)).setFill()
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
    weak var previewWindow: NSWindow?

    override func becomeKey() {
        super.becomeKey()
        level = previewWindow?.level ?? .normal
    }

    override func resignKey() {
        super.resignKey()
        level = .normal
    }

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
private final class SettingsPage: NSView {
    override var isFlipped: Bool { true }
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
    var loadSnippetControls: ((@escaping ([SnippetControl]) -> Void) -> Void)? {
        didSet { snippetsEditor.loadControls = loadSnippetControls }
    }
    var snippetPreferencesChanged: (() -> Void)? {
        didSet { snippetsEditor.preferencesChanged = snippetPreferencesChanged }
    }
    func refreshSnippetPlaceholders() { snippetsEditor.refreshPlaceholders() }
    private let snippetsEditor = SnippetsEditor()
    private var snippetsLoaded = false
    /// Tabs in order; the raw value is the tab index.
    enum Tab: Int { case general, appearance, edit, snippets, data, about }
    var rebuildIndex: (() -> String?)?
    var generateOnboarding: ((@escaping (String?) -> Void) -> Void)?
    private let onboardingButton = NSButton(title: L("settings.restoreGuideNotes"), target: nil, action: nil)
    private let helpButton = NSButton(title: L("settings.openHelp"), target: nil, action: nil)
    private let aboutVersion = NSTextField(labelWithString: "")
    private let vimSwitch = OrangeSwitch(frame: .zero)
    private let vimDoubleEscapeSwitch = OrangeSwitch(frame: .zero)
    private let indentation = NSPopUpButton(frame: .zero, pullsDown: false)
    private let codeLineNumbersSwitch = OrangeSwitch(frame: .zero)
    private let relativeCodeLineNumbersSwitch = OrangeSwitch(frame: .zero)
    private var relativeCodeLineNumbersSection: NSView?
    private let themePicker = NSPopUpButton(frame: .zero, pullsDown: false)
    private let themePreview = NSTextField(labelWithString: "")
    private let previewBox = CodeThemePreviewBox()
    private let colorSchemePicker = NSPopUpButton(frame: .zero, pullsDown: false)
    private let resetWindowSizeButton = NSButton(title: L("settings.reset"), target: nil, action: nil)
    private let uiThemePicker = NSPopUpButton(frame: .zero, pullsDown: false)
    private let editorFontPicker = NSPopUpButton(frame: .zero, pullsDown: false)
    private let paperPicker = NSPopUpButton(frame: .zero, pullsDown: false)
    private let editorSizePicker = NSPopUpButton(frame: .zero, pullsDown: false)
    private let languagePicker = NSPopUpButton(frame: .zero, pullsDown: false)
    var languageChanged: (() -> Void)?
    private let textureStrengthSlider = AccentSlider(value: Double(WindowAppearance.defaultTextureStrength), minValue: 0, maxValue: 100, target: nil, action: nil)
    private var textureStrengthSection: NSView?
    private let opacitySlider = AccentSlider(value: 100, minValue: 50, maxValue: 100, target: nil, action: nil)
    private let blurSlider = AccentSlider(value: 0, minValue: 0, maxValue: 100, target: nil, action: nil)
    private let textureStrengthValue = NSTextField(labelWithString: "")
    private let opacityValue = NSTextField(labelWithString: "100%")
    private let blurValue = NSTextField(labelWithString: "0%")
    private let tabs = NSTabView()
    private var symbols: [NSImageView] = []
    private var sliderTicks: [SliderTicks] = []
    private let getAppearance: () -> WindowAppearance
    private let setAppearance: (WindowAppearance) -> Void
    private let resetWindowSize: () -> Void
    private let getTheme: () -> String
    private let setTheme: (String) -> Void
    private let getVimEnabled: () -> Bool
    private let setVimEnabled: (Bool) -> Void
    private let getVimDoubleEscape: () -> Bool
    private let setVimDoubleEscape: (Bool) -> Void
    private let getIndentation: () -> String
    private let setIndentation: (String) -> Void
    private let getCodeLineNumbers: () -> CodeLineNumberPreferences
    private let setCodeLineNumbers: (CodeLineNumberPreferences) -> Void
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

    init(
        getShortcut: @escaping () -> String, saveShortcut: @escaping (UInt32, UInt32) -> String?,
        clearShortcut: @escaping () -> Void, resetShortcut: @escaping () -> String?,
        getStorage: @escaping () -> String, changeStorage: @escaping (URL, @escaping (String?) -> Void) -> Void,
        getVimEnabled: @escaping () -> Bool, setVimEnabled: @escaping (Bool) -> Void,
        getVimDoubleEscape: @escaping () -> Bool, setVimDoubleEscape: @escaping (Bool) -> Void,
        getIndentation: @escaping () -> String, setIndentation: @escaping (String) -> Void,
        getCodeLineNumbers: @escaping () -> CodeLineNumberPreferences, setCodeLineNumbers: @escaping (CodeLineNumberPreferences) -> Void,
        getTheme: @escaping () -> String, setTheme: @escaping (String) -> Void,
        getAppearance: @escaping () -> WindowAppearance, setAppearance: @escaping (WindowAppearance) -> Void,
        resetWindowSize: @escaping () -> Void,
        loginStatus: @escaping () -> SMAppService.Status, setLogin: @escaping (Bool) -> String?
    ) {
        self.getShortcut = getShortcut; self.saveShortcut = saveShortcut; self.clearShortcut = clearShortcut
        self.resetShortcut = resetShortcut; self.loginStatus = loginStatus; self.setLogin = setLogin
        self.getStorage = getStorage; self.changeStorage = changeStorage
        self.getVimEnabled = getVimEnabled; self.setVimEnabled = setVimEnabled
        self.getVimDoubleEscape = getVimDoubleEscape; self.setVimDoubleEscape = setVimDoubleEscape
        self.getIndentation = getIndentation; self.setIndentation = setIndentation
        self.getCodeLineNumbers = getCodeLineNumbers; self.setCodeLineNumbers = setCodeLineNumbers
        self.getTheme = getTheme; self.setTheme = setTheme
        self.getAppearance = getAppearance; self.setAppearance = setAppearance; self.resetWindowSize = resetWindowSize
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
    private func section(_ title: String, icon: String, detail: String, controls: NSView, message: NSTextField? = nil) -> NSView {
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
        let container = NSView(); row.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(row)
        NSLayoutConstraint.activate([
            row.topAnchor.constraint(equalTo: container.topAnchor), row.leadingAnchor.constraint(equalTo: container.leadingAnchor), row.trailingAnchor.constraint(equalTo: container.trailingAnchor),
        ])
        if let message {
            message.font = .systemFont(ofSize: 12); message.textColor = .secondaryLabelColor
            message.translatesAutoresizingMaskIntoConstraints = false; container.addSubview(message)
            NSLayoutConstraint.activate([
                message.topAnchor.constraint(equalTo: row.bottomAnchor, constant: 8), message.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 44),
                message.trailingAnchor.constraint(equalTo: container.trailingAnchor), message.bottomAnchor.constraint(equalTo: container.bottomAnchor)
            ])
        } else {
            row.bottomAnchor.constraint(equalTo: container.bottomAnchor).isActive = true
        }
        return container
    }
    private func page(_ sections: [NSView], scrollable: Bool = false) -> NSView {
        let page = scrollable ? SettingsPage() : NSView()
        let stack = NSStackView(views: sections)
        stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 16; stack.translatesAutoresizingMaskIntoConstraints = false
        page.addSubview(stack)
        NSLayoutConstraint.activate([stack.topAnchor.constraint(equalTo: page.topAnchor, constant: 16), stack.leadingAnchor.constraint(equalTo: page.leadingAnchor, constant: 16), stack.trailingAnchor.constraint(equalTo: page.trailingAnchor, constant: -16)])
        for section in sections { section.widthAnchor.constraint(equalTo: stack.widthAnchor).isActive = true }
        guard scrollable else {
            stack.bottomAnchor.constraint(lessThanOrEqualTo: page.bottomAnchor, constant: -12).isActive = true
            return page
        }
        let scroll = NSScrollView()
        scroll.drawsBackground = false; scroll.hasVerticalScroller = true; scroll.autohidesScrollers = true
        scroll.documentView = page
        page.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            page.leadingAnchor.constraint(equalTo: scroll.contentView.leadingAnchor),
            page.topAnchor.constraint(equalTo: scroll.contentView.topAnchor),
            page.widthAnchor.constraint(equalTo: scroll.contentView.widthAnchor),
            stack.bottomAnchor.constraint(equalTo: page.bottomAnchor, constant: -12)
        ])
        return scroll
    }
    private func sliderControls(_ slider: NSSlider, value: NSTextField, label: String) -> NSView {
        let minValue = slider.minValue, maxValue = slider.maxValue, current = slider.doubleValue
        let cell = AccentSliderCell(); cell.minValue = minValue; cell.maxValue = maxValue; cell.doubleValue = current
        slider.cell = cell; slider.numberOfTickMarks = 11; slider.tickMarkPosition = .above; slider.allowsTickMarkValuesOnly = false
        slider.target = self; slider.action = #selector(appearanceChanged(_:)); slider.isContinuous = true; slider.setAccessibilityLabel(label)
        slider.widthAnchor.constraint(equalToConstant: 136).isActive = true
        let ticks = SliderTicks(); ticks.slider = slider; ticks.setAccessibilityElement(false); sliderTicks.append(ticks)
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
        vimDoubleEscapeSwitch.target = self; vimDoubleEscapeSwitch.action = #selector(vimDoubleEscapeChanged)
        vimDoubleEscapeSwitch.setAccessibilityLabel(L("settings.vimDoubleEscape"))
        let vimEscapeSection = section(L("settings.vimDoubleEscape"), icon: "escape", detail: L("settings.vimDoubleEscapeDetail"), controls: vimDoubleEscapeSwitch)
        for (title, value) in [(L("settings.indentTwoSpaces"), "spaces2"), (L("settings.indentFourSpaces"), "spaces4"), ("Tab", "tabs")] {
            indentation.addItem(withTitle: title); indentation.lastItem?.representedObject = value
        }
        indentation.target = self; indentation.action = #selector(indentationChanged); indentation.setAccessibilityLabel(L("settings.codeIndentation"))
        let indentMessage = NSTextField(wrappingLabelWithString: L("settings.codeIndentationHint"))
        let indentSection = section(L("settings.codeIndentation"), icon: "increase.indent", detail: L("settings.codeIndentationDetail"), controls: indentation, message: indentMessage)
        let codeLineNumbersTitle = L("settings.codeLineNumbers")
        codeLineNumbersSwitch.target = self; codeLineNumbersSwitch.action = #selector(codeLineNumbersChanged)
        codeLineNumbersSwitch.setAccessibilityLabel(codeLineNumbersTitle)
        let codeLineNumbers = section(codeLineNumbersTitle, icon: "list.number",
                                      detail: L("settings.codeLineNumbersDetail"), controls: codeLineNumbersSwitch)
        let relativeLineNumbersTitle = L("settings.relativeCodeLineNumbers")
        relativeCodeLineNumbersSwitch.target = self; relativeCodeLineNumbersSwitch.action = #selector(codeLineNumbersChanged)
        relativeCodeLineNumbersSwitch.setAccessibilityLabel(relativeLineNumbersTitle)
        let relativeLineNumbers = section(relativeLineNumbersTitle, icon: "arrow.up.arrow.down",
                                          detail: L("settings.relativeCodeLineNumbersDetail"), controls: relativeCodeLineNumbersSwitch)
        relativeCodeLineNumbersSection = relativeLineNumbers
        for theme in CodeThemes.all { themePicker.addItem(withTitle: theme.title); themePicker.lastItem?.representedObject = theme.id }
        themePicker.target = self; themePicker.action = #selector(themeChanged); themePicker.setAccessibilityLabel(L("settings.codeColors"))
        let themeMessage = NSTextField(wrappingLabelWithString: L("settings.codeColorsHint"))
        let themeSection = section(L("settings.codeColors"), icon: "paintpalette", detail: L("settings.codeColorsDetail"), controls: themePicker, message: themeMessage)
        themePreview.font = .monospacedSystemFont(ofSize: 12, weight: .regular); themePreview.maximumNumberOfLines = 0
        themePreview.setAccessibilityLabel(L("settings.codeColorPreview"))
        previewBox.boxType = .custom; previewBox.borderWidth = 0
        previewBox.cornerRadius = 8
        previewBox.onAppearanceChange = { [weak self] in
            guard let self else { return }
            self.renderThemePreview(self.getTheme())
        }
        themePreview.translatesAutoresizingMaskIntoConstraints = false; previewBox.addSubview(themePreview)
        NSLayoutConstraint.activate([themePreview.leadingAnchor.constraint(equalTo: previewBox.leadingAnchor, constant: 12), themePreview.trailingAnchor.constraint(equalTo: previewBox.trailingAnchor, constant: -12), themePreview.topAnchor.constraint(equalTo: previewBox.topAnchor, constant: 8), themePreview.bottomAnchor.constraint(equalTo: previewBox.bottomAnchor, constant: -8)])
        let previewRow = NSView(); previewBox.translatesAutoresizingMaskIntoConstraints = false; previewRow.addSubview(previewBox)
        NSLayoutConstraint.activate([previewBox.leadingAnchor.constraint(equalTo: previewRow.leadingAnchor, constant: 44), previewBox.trailingAnchor.constraint(equalTo: previewRow.trailingAnchor), previewBox.topAnchor.constraint(equalTo: previewRow.topAnchor), previewBox.bottomAnchor.constraint(equalTo: previewRow.bottomAnchor)])
        let themeGroup = NSStackView(views: [themeSection, previewRow]); themeGroup.orientation = .vertical; themeGroup.alignment = .leading; themeGroup.spacing = 8
        themeSection.widthAnchor.constraint(equalTo: themeGroup.widthAnchor).isActive = true; previewRow.widthAnchor.constraint(equalTo: themeGroup.widthAnchor).isActive = true
        for scheme in WindowColorScheme.allCases {
            colorSchemePicker.addItem(withTitle: scheme.title)
            colorSchemePicker.lastItem?.representedObject = scheme.rawValue
        }
        colorSchemePicker.target = self; colorSchemePicker.action = #selector(appearanceChanged(_:))
        colorSchemePicker.setAccessibilityLabel(L("settings.colorScheme"))
        colorSchemePicker.widthAnchor.constraint(greaterThanOrEqualToConstant: 128).isActive = true
        let colorSchemeSection = section(L("settings.colorScheme"), icon: "sun.max", detail: L("settings.colorSchemeDetail"), controls: colorSchemePicker)
        for theme in UIThemes.all { uiThemePicker.addItem(withTitle: L(theme.title)); uiThemePicker.lastItem?.representedObject = theme.id }
        uiThemePicker.target = self; uiThemePicker.action = #selector(appearanceChanged(_:)); uiThemePicker.setAccessibilityLabel(L("settings.accentColor"))
        let uiThemeSection = section(L("settings.accentColor"), icon: "paintbrush", detail: L("settings.accentColorDetail"), controls: uiThemePicker)
        let typographySection = section(L("settings.editorTypography"), icon: "textformat.size", detail: L("settings.editorTypographyDetail"), controls: typographyControls())
        for paper in NotePaper.allCases {
            paperPicker.addItem(withTitle: paper.title); paperPicker.lastItem?.representedObject = paper.rawValue
        }
        paperPicker.target = self; paperPicker.action = #selector(appearanceChanged(_:))
        paperPicker.setAccessibilityLabel(L("settings.notePaper"))
        let paperSection = section(L("settings.notePaper"), icon: "square.on.square", detail: L("settings.notePaperDetail"), controls: paperPicker)
        let textureStrengthTitle = L("settings.textureStrength")
        let textureStrengthControls = sliderControls(textureStrengthSlider, value: textureStrengthValue, label: textureStrengthTitle)
        let textureStrengthSection = section(textureStrengthTitle, icon: "slider.horizontal.3", detail: L("settings.textureStrengthDetail"), controls: textureStrengthControls)
        self.textureStrengthSection = textureStrengthSection
        let opacitySection = section(L("settings.windowOpacity"), icon: "circle.lefthalf.filled", detail: L("settings.windowOpacityDetail"), controls: sliderControls(opacitySlider, value: opacityValue, label: L("settings.windowOpacity")), message: NSTextField(wrappingLabelWithString: L("settings.windowOpacityHint")))
        let blurSection = section(L("settings.backgroundBlur"), icon: "drop.halffull", detail: L("settings.backgroundBlurDetail"), controls: sliderControls(blurSlider, value: blurValue, label: L("settings.backgroundBlur")), message: NSTextField(wrappingLabelWithString: L("settings.backgroundBlurHint")))
        resetWindowSizeButton.bezelStyle = .rounded
        resetWindowSizeButton.target = self; resetWindowSizeButton.action = #selector(resetWindowSizePressed)
        resetWindowSizeButton.setAccessibilityLabel(L("settings.resetWindowSize"))
        let sizeSection = section(L("settings.windowSize"), icon: "arrow.up.left.and.arrow.down.right", detail: L("settings.windowSizeDetail"), controls: resetWindowSizeButton)
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
            (.general, L("settings.general"), page([loginSection, languageSection, shortcutSection])),
            (.appearance, L("settings.appearance"), page([colorSchemeSection, uiThemeSection, typographySection, paperSection, textureStrengthSection, opacitySection, blurSection, sizeSection, themeGroup], scrollable: true)),
            (.edit, L("app.edit"), page([vimSection, vimEscapeSection, indentSection, codeLineNumbers, relativeLineNumbers])),
            (.snippets, L("settings.snippets"), page([snippetsSection, snippetsEditor])),
            (.data, L("settings.data"), page([storageSection, backupSection, historySection, trashSection, rebuildSection])),
            (.about, L("settings.about"), aboutPage()),
        ]
        for (tab, title, content) in pages {
            precondition(tab.rawValue == tabs.numberOfTabViewItems, "tabs must be added in Tab order")
            let item = NSTabViewItem(identifier: title); item.label = title; item.view = content; tabs.addTabViewItem(item)
        }
        let stack = NSStackView(views: [header, tabs]); stack.orientation = .vertical; stack.alignment = .leading; stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        window.contentView?.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 24), stack.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 20), stack.bottomAnchor.constraint(equalTo: window.contentView!.bottomAnchor, constant: -24),
            tabs.widthAnchor.constraint(equalTo: stack.widthAnchor)
        ])
    }
    private func aboutPage() -> NSView {
        let page = NSView()
        let icon = NSImageView()
        icon.image = Bundle.main.url(forResource: "Inkflit", withExtension: "icns")
            .flatMap { NSImage(contentsOf: $0) } ?? NSApp.applicationIconImage
        icon.imageScaling = .scaleProportionallyUpOrDown
        icon.setAccessibilityElement(false)
        icon.widthAnchor.constraint(equalToConstant: 104).isActive = true
        icon.heightAnchor.constraint(equalTo: icon.widthAnchor).isActive = true

        let title = label("Inkflit", size: 26, weight: .semibold)
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
        aboutVersion.stringValue = String(format: L("settings.aboutVersion"), version)
        aboutVersion.font = .monospacedDigitSystemFont(ofSize: 13, weight: .regular)
        aboutVersion.textColor = .secondaryLabelColor
        aboutVersion.isSelectable = true
        let tagline = label(L("settings.aboutTagline"), size: 13)

        onboardingButton.target = self
        onboardingButton.action = #selector(onboardingPressed)
        onboardingButton.bezelStyle = .rounded
        onboardingButton.image = NSImage(systemSymbolName: "arrow.clockwise", accessibilityDescription: nil)
        onboardingButton.imagePosition = .imageLeading
        helpButton.target = self
        helpButton.action = #selector(openHelp)
        helpButton.bezelStyle = .rounded
        helpButton.image = NSImage(systemSymbolName: "book", accessibilityDescription: nil)
        helpButton.imagePosition = .imageLeading
        let actions = NSStackView(views: [onboardingButton, helpButton])
        actions.orientation = .horizontal
        actions.alignment = .centerY
        actions.spacing = 8

        let divider = NSBox()
        divider.boxType = .separator
        divider.widthAnchor.constraint(equalToConstant: 248).isActive = true
        let copyright = label("© 2026 phpz.org", size: 11, color: .secondaryLabelColor)
        let content = NSStackView(views: [icon, title, aboutVersion, tagline, actions, divider, copyright])
        content.orientation = .vertical
        content.alignment = .centerX
        content.spacing = 6
        content.setCustomSpacing(12, after: aboutVersion)
        content.setCustomSpacing(24, after: tagline)
        content.setCustomSpacing(20, after: actions)
        content.setCustomSpacing(12, after: divider)
        content.translatesAutoresizingMaskIntoConstraints = false
        page.addSubview(content)
        NSLayoutConstraint.activate([
            content.centerXAnchor.constraint(equalTo: page.centerXAnchor),
            content.centerYAnchor.constraint(equalTo: page.centerYAnchor)
        ])
        return page
    }
    private func typographyControls() -> NSView {
        editorFontPicker.addItem(withTitle: L("settings.editorFontDefault"))
        editorFontPicker.lastItem?.representedObject = ""
        for family in EditorTypography.families {
            editorFontPicker.addItem(withTitle: family)
            editorFontPicker.lastItem?.representedObject = family
        }
        for size in EditorTypography.sizes {
            editorSizePicker.addItem(withTitle: "\(size) pt")
            editorSizePicker.lastItem?.representedObject = size
        }
        editorFontPicker.setAccessibilityLabel(L("settings.editorFont"))
        editorSizePicker.setAccessibilityLabel(L("settings.editorFontSize"))
        for picker in [editorFontPicker, editorSizePicker] {
            picker.target = self; picker.action = #selector(appearanceChanged(_:))
        }
        editorFontPicker.widthAnchor.constraint(equalToConstant: 174).isActive = true
        editorSizePicker.widthAnchor.constraint(equalToConstant: 74).isActive = true
        let controls = NSStackView(views: [editorFontPicker, editorSizePicker]); controls.orientation = .horizontal; controls.spacing = 8; controls.alignment = .centerY
        return controls
    }
    @objc private func windowBecameKey() { refresh() }
    func refresh() {
        if let index = languagePicker.itemArray.firstIndex(where: { ($0.representedObject as? String) == Localization.preference }) { languagePicker.selectItem(at: index) }
        shortcut.displayValue = getShortcut()
        vimSwitch.state = getVimEnabled() ? .on : .off
        vimDoubleEscapeSwitch.state = getVimDoubleEscape() ? .on : .off
        if let index = indentation.itemArray.firstIndex(where: { ($0.representedObject as? String) == getIndentation() }) { indentation.selectItem(at: index) }
        applyCodeLineNumberControls(getCodeLineNumbers())
        if let index = themePicker.itemArray.firstIndex(where: { ($0.representedObject as? String) == getTheme() }) { themePicker.selectItem(at: index) }
        renderThemePreview(getTheme())
        let appearance = getAppearance()
        if let index = colorSchemePicker.itemArray.firstIndex(where: { ($0.representedObject as? String) == appearance.colorScheme.rawValue }) { colorSchemePicker.selectItem(at: index) }
        if let index = uiThemePicker.itemArray.firstIndex(where: { ($0.representedObject as? String) == appearance.theme }) { uiThemePicker.selectItem(at: index) }
        editorFontPicker.selectItem(at: editorFontPicker.indexOfItem(withRepresentedObject: appearance.typography.family))
        editorSizePicker.selectItem(at: appearance.typography.size - EditorTypography.sizes.lowerBound)
        paperPicker.selectItem(at: paperPicker.indexOfItem(withRepresentedObject: appearance.paper.rawValue))
        applyTextureStrengthControls(appearance)
        opacitySlider.integerValue = appearance.opacity; blurSlider.integerValue = appearance.blur
        opacityValue.stringValue = "\(appearance.opacity)%"; blurValue.stringValue = "\(appearance.blur)%"
        applySettingsAccent(appearance.theme)
        let storagePath = URL(fileURLWithPath: getStorage()).deletingLastPathComponent().path
        storageMessage.stringValue = storagePath; storageMessage.toolTip = storagePath
        let defaults = UserDefaults.standard, limit = NoteFiles.backupVersionLimit(defaults)
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
    func recordGlobalShortcut() { shortcut.performClick(nil) }
    func addSnippet() { snippetsEditor.addSnippet() }
    func removeSnippet() { snippetsEditor.removeSnippetFromCommand() }
    func insertSnippetPlaceholder() { snippetsEditor.insertPlaceholderFromCommand() }
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
    @objc private func resetWindowSizePressed() { resetWindowSize() }
    @objc private func loginChanged() {
        let requested = loginSwitch.state == .on
        let error = setLogin(requested)
        refresh()
        if let error { loginMessage.stringValue = error }
    }
    @objc private func openLoginSettings() { SMAppService.openSystemSettingsLoginItems() }
    @objc private func vimChanged() { setVimEnabled(vimSwitch.state == .on) }
    @objc private func vimDoubleEscapeChanged() { setVimDoubleEscape(vimDoubleEscapeSwitch.state == .on) }
    @objc private func indentationChanged() {
        guard let value = indentation.selectedItem?.representedObject as? String else { return }
        setIndentation(value)
    }
    @objc private func codeLineNumbersChanged() {
        let preferences = CodeLineNumberPreferences(enabled: codeLineNumbersSwitch.state == .on,
                                                     relative: relativeCodeLineNumbersSwitch.state == .on)
        setCodeLineNumbers(preferences)
        applyCodeLineNumberControls(preferences)
    }
    private func applyCodeLineNumberControls(_ preferences: CodeLineNumberPreferences) {
        codeLineNumbersSwitch.state = preferences.enabled ? .on : .off
        relativeCodeLineNumbersSwitch.state = preferences.relative ? .on : .off
        relativeCodeLineNumbersSwitch.isEnabled = preferences.enabled
        relativeCodeLineNumbersSection?.alphaValue = preferences.enabled ? 1 : 0.55
        for toggle in [codeLineNumbersSwitch, relativeCodeLineNumbersSwitch] {
            toggle.setAccessibilityValue(toggle.state == .on ? 1 : 0)
            toggle.needsDisplay = true
        }
    }
    static func sliderValue(_ value: Int, optionPressed: Bool) -> Int {
        optionPressed ? Int((Double(value) / 5).rounded()) * 5 : value
    }
    @objc private func appearanceChanged(_ sender: Any?) {
        guard let theme = uiThemePicker.selectedItem?.representedObject as? String,
              let value = colorSchemePicker.selectedItem?.representedObject as? String,
              let scheme = WindowColorScheme(rawValue: value) else { return }
        if let slider = sender as? AccentSlider {
            let option = slider.optionAtMouseDown || (NSApp.currentEvent?.modifierFlags ?? []).contains(.option) || NSEvent.modifierFlags.contains(.option)
            slider.integerValue = Self.sliderValue(slider.integerValue, optionPressed: option)
        }
        let typography = EditorTypography(family: editorFontPicker.selectedItem?.representedObject as? String ?? "",
                                          size: editorSizePicker.selectedItem?.representedObject as? Int ?? EditorTypography.defaultSize)
        let paper = (paperPicker.selectedItem?.representedObject as? String).flatMap(NotePaper.init(rawValue:)) ?? .plain
        let appearance = WindowAppearance(theme: theme, opacity: opacitySlider.integerValue, blur: blurSlider.integerValue,
                                          colorScheme: scheme, typography: typography, paper: paper,
                                          textureStrength: textureStrengthSlider.integerValue)
        applyTextureStrengthControls(appearance)
        opacityValue.stringValue = "\(appearance.opacity)%"; blurValue.stringValue = "\(appearance.blur)%"
        applySettingsAccent(theme)
        setAppearance(appearance)
    }
    private func applyTextureStrengthControls(_ appearance: WindowAppearance) {
        let enabled = appearance.paper != .plain
        textureStrengthSlider.integerValue = appearance.textureStrength
        textureStrengthSlider.isEnabled = enabled
        textureStrengthValue.stringValue = "\(appearance.textureStrength)%"
        textureStrengthSection?.alphaValue = enabled ? 1 : 0.55
    }
    private func applySettingsAccent(_ theme: String) {
        let accent = UIThemes.accent(theme)
        symbols.forEach { $0.contentTintColor = accent }
        for toggle in [loginSwitch, vimSwitch, vimDoubleEscapeSwitch, codeLineNumbersSwitch, relativeCodeLineNumbersSwitch] {
            toggle.accentColor = accent
        }
        sliderTicks.forEach { $0.accentColor = accent }
        for slider in [textureStrengthSlider, opacitySlider, blurSlider] {
            (slider.cell as? AccentSliderCell)?.accentColor = accent
            slider.needsDisplay = true
        }
    }
    private func renderThemePreview(_ id: String) {
        guard let theme = CodeThemes.all.first(where: { $0.id == CodeThemes.validID(id) }) else { return }
        let dark = previewBox.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        let palette = dark ? theme.darkColors : theme.colors
        func color(_ key: String, fallback: NSColor = .labelColor) -> NSColor {
            paletteColor(palette[key]) ?? fallback
        }
        previewBox.fillColor = color("background", fallback: .textBackgroundColor)
        let attributed = NSMutableAttributedString()
        let font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        let sample = [
            ("comment", "// Label a note\n"),
            ("keyword", "const"), ("variable", " note "), ("operator", "="),
            ("punctuation", " { "), ("property", "title"), ("punctuation", ": "),
            ("string", "\"Inkflit\""), ("punctuation", " };\n"),
            ("keyword", "function"), ("function", " label"), ("punctuation", "() {\n  "),
            ("keyword", "return"), ("variable", " note"), ("punctuation", "."), ("property", "title"),
            ("operator", " + "), ("string", "\" #\""), ("operator", " + "), ("number", "42"), ("punctuation", ";\n}")
        ]
        for (key, text) in sample {
            attributed.append(NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: color(key)]))
        }
        themePreview.attributedStringValue = attributed
    }
    @objc private func themeChanged() {
        guard let value = themePicker.selectedItem?.representedObject as? String else { return }
        renderThemePreview(value); setTheme(value)
    }
    #if INKFLIT_NATIVE_TEST
    func testSelectCodeTheme(_ id: String) -> (property: String, background: String)? {
        guard let index = themePicker.itemArray.firstIndex(where: { ($0.representedObject as? String) == id }) else { return nil }
        themePicker.selectItem(at: index)
        NSApp.sendAction(#selector(themeChanged), to: self, from: themePicker)
        let sample = themePreview.attributedStringValue
        let property = (sample.string as NSString).range(of: "title")
        guard property.location != NSNotFound, let color = sample.attribute(.foregroundColor, at: property.location, effectiveRange: nil) as? NSColor else { return nil }
        return (testColorHex(color), testCodePreviewBackground())
    }
    private func testColorHex(_ color: NSColor) -> String {
        String(format: "#%02x%02x%02x", Int((color.redComponent*255).rounded()), Int((color.greenComponent*255).rounded()), Int((color.blueComponent*255).rounded()))
    }
    func testCodePreviewBackground() -> String { testColorHex(previewBox.fillColor) }
    func testSelectColorScheme(_ scheme: WindowColorScheme) -> Bool {
        guard let index = colorSchemePicker.itemArray.firstIndex(where: { ($0.representedObject as? String) == scheme.rawValue }) else { return false }
        colorSchemePicker.selectItem(at: index)
        return NSApp.sendAction(#selector(appearanceChanged(_:)), to: self, from: colorSchemePicker)
    }
    func testSetAppearance(_ appearance: WindowAppearance) -> Bool {
        guard let index = uiThemePicker.itemArray.firstIndex(where: { ($0.representedObject as? String) == appearance.theme }) else { return false }
        uiThemePicker.selectItem(at: index); opacitySlider.integerValue = appearance.opacity; blurSlider.integerValue = appearance.blur
        return NSApp.sendAction(#selector(appearanceChanged(_:)), to: self, from: uiThemePicker)
    }
    func testSelectNotePaper(_ paper: NotePaper) -> Bool {
        paperPicker.selectItem(at: paperPicker.indexOfItem(withRepresentedObject: paper.rawValue))
        return NSApp.sendAction(#selector(appearanceChanged(_:)), to: self, from: paperPicker)
    }
    func testSetTextureStrength(_ strength: Int) -> Bool {
        guard textureStrengthSlider.isEnabled else { return false }
        textureStrengthSlider.integerValue = strength
        return NSApp.sendAction(#selector(appearanceChanged(_:)), to: self, from: textureStrengthSlider)
    }
    func testTextureStrengthAvailability(enabled: Bool) -> Bool {
        guard let section = textureStrengthSection, let cell = textureStrengthSlider.cell else { return false }
        return textureStrengthSlider.isEnabled == enabled && cell.isEnabled == enabled
            && (enabled ? section.alphaValue == 1 : section.alphaValue < 1)
    }
    func testToggleCodeLineNumbers(relative: Bool = false) {
        (relative ? relativeCodeLineNumbersSwitch : codeLineNumbersSwitch).performClick(nil)
    }
    func testCodeLineNumberControls(enabled: Bool, relative: Bool) -> Bool {
        guard let section = relativeCodeLineNumbersSection else { return false }
        return (codeLineNumbersSwitch.state == .on) == enabled
            && (relativeCodeLineNumbersSwitch.state == .on) == relative
            && relativeCodeLineNumbersSwitch.isEnabled == enabled
            && (enabled ? section.alphaValue == 1 : section.alphaValue < 1)
    }
    func testAppearanceControls(_ theme: String) -> Bool {
        let accent = UIThemes.accent(theme)
        guard loginSwitch.accentColor == accent, vimSwitch.accentColor == accent,
              symbols.allSatisfy({ $0.contentTintColor == accent }), sliderTicks.count == 3,
              sliderTicks.allSatisfy({ $0.accentColor == accent }),
              let page = tabs.tabViewItem(at: Tab.appearance.rawValue).view else { return false }
        page.layoutSubtreeIfNeeded()
        return [textureStrengthSlider, opacitySlider, blurSlider].allSatisfy { slider in
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
            guard let view = tabs.tabViewItem(at: tab.rawValue).view else { return false }
            let page = (view as? NSScrollView)?.documentView ?? view
            return views.allSatisfy { page.bounds.insetBy(dx: -1, dy: -1).contains($0.convert($0.bounds, to: page)) }
        }
        return fits([colorSchemePicker, editorFontPicker, editorSizePicker, paperPicker, textureStrengthSlider, resetWindowSizeButton, previewBox], on: .appearance)
            && fits([vimSwitch, vimDoubleEscapeSwitch, indentation, codeLineNumbersSwitch, relativeCodeLineNumbersSwitch], on: .edit)
    }
    func testResetWindowSize() { resetWindowSizeButton.performClick(nil) }
    func testToggleVim() { vimSwitch.performClick(nil) }
    func testToggleVimDoubleEscape() { vimDoubleEscapeSwitch.performClick(nil) }
    func testSnippetsEditor() -> SnippetsEditor { snippetsEditor }
    func testTabCount() -> Int { tabs.numberOfTabViewItems }
    func testVimSwitchState() -> Bool { vimSwitch.state == .on }
    func testSelectSettingsTab(_ index: Int) { tabs.selectTabViewItem(at: index) }
    func testAboutControls() -> Bool {
        select(.about)
        window?.contentView?.layoutSubtreeIfNeeded()
        let tab = tabs.tabViewItem(at: Tab.about.rawValue)
        guard tab.label == L("settings.about"), let page = tab.view,
              let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
              aboutVersion.stringValue == String(format: L("settings.aboutVersion"), version),
              [aboutVersion, onboardingButton, helpButton].allSatisfy({ view in
                  view.isDescendant(of: page) && !view.bounds.isEmpty && page.bounds.contains(view.convert(view.bounds, to: page))
              }) else { return false }
        helpButton.performClick(nil)
        let opened = helpWindow?.window?.isVisible == true
        helpWindow?.close()
        window?.makeKeyAndOrderFront(nil)
        return opened
    }
    func testGenerateOnboarding() -> Bool {
        select(.about)
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
    @objc func chooseStoragePressed() {
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
    @objc func restorePressed() {
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
    @objc func restoreBackupPressed() {
        chooseRecoveryFile(folder: "backups", title: L("settings.restorePreviousVersion"))
    }
    @objc func rebuildPressed() {
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
        // Set the initial language and palette before WebKit paints the page.
        guard let page = Bundle.main.url(forResource: "Help", withExtension: "html"),
              var components = URLComponents(url: page, resolvingAgainstBaseURL: false) else { NSSound.beep(); return }
        let appearance = getAppearance()
        components.queryItems = [
            URLQueryItem(name: "lang", value: Localization.current),
            URLQueryItem(name: "theme", value: appearance.theme),
            URLQueryItem(name: "appearance", value: appearance.colorScheme.rawValue)
        ]
        guard let url = components.url else { NSSound.beep(); return }
        if helpWindow == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 980, height: 720), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            window.title = L("settings.helpWindowTitle"); window.isReleasedWhenClosed = false; window.center()
            let web = WKWebView(frame: .zero)
            web.navigationDelegate = helpLinks
            helpLinks.onLoad = { [weak self] in self?.syncHelpAppearance() }
            window.contentView = web
            helpWindow = NSWindowController(window: window)
        }
        // Reload each time so the current language is picked up.
        (helpWindow?.window?.contentView as? WKWebView)?.loadFileURL(url, allowingReadAccessTo: page.deletingLastPathComponent())
        helpWindow?.showWindow(nil); helpWindow?.window?.makeKeyAndOrderFront(nil)
    }
    func syncHelpAppearance() {
        guard let window = helpWindow?.window, window.isVisible, let web = window.contentView as? WKWebView else { return }
        let appearance = getAppearance()
        web.callAsyncJavaScript("window.setHelpAppearance?.(theme, scheme)",
                                arguments: ["theme": appearance.theme, "scheme": appearance.colorScheme.rawValue],
                                in: nil, in: .page, completionHandler: nil)
    }
    func show(previewing note: NSWindow) {
        (window as? SettingsWindow)?.previewWindow = note
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
    var onLoad: (() -> Void)?

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { onLoad?() }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
            NSWorkspace.shared.open(url); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }
}
