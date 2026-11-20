import Cocoa

enum SnippetPreferences {
    private static let key = "disabledSnippetIDs"
    static var disabled: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: key) ?? []) }
        set { UserDefaults.standard.set(newValue.sorted(), forKey: key) }
    }
}

final class SnippetControl: NSObject, Decodable {
    let key: String
    let title: String
    let detail: String?
    let children: [SnippetControl]?
}

private final class SnippetAvailabilityView: NSView, NSOutlineViewDataSource, NSOutlineViewDelegate {
    private let controls: [SnippetControl]
    private let changed: () -> Void
    private let outline = NSOutlineView()
    private var disabled = SnippetPreferences.disabled

    init(controls: [SnippetControl], changed: @escaping () -> Void) {
        self.controls = controls; self.changed = changed
        super.init(frame: NSRect(x: 0, y: 0, width: 500, height: 330))
        let name = NSTableColumn(identifier: .init("name")); name.title = L("settings.snippets"); name.width = 405
        let enabled = NSTableColumn(identifier: .init("enabled")); enabled.title = L("settings.snippetEnabled"); enabled.width = 72
        outline.addTableColumn(name); outline.addTableColumn(enabled); outline.outlineTableColumn = name
        outline.columnAutoresizingStyle = .firstColumnOnlyAutoresizingStyle
        outline.rowHeight = 23; outline.usesAlternatingRowBackgroundColors = true
        outline.dataSource = self; outline.delegate = self
        outline.setAccessibilityLabel(L("settings.snippetAvailability"))
        let scroll = NSScrollView(frame: bounds)
        scroll.autoresizingMask = [.width, .height]; scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder; scroll.documentView = outline
        addSubview(scroll)
        outline.reloadData()
    }
    required init?(coder: NSCoder) { nil }

    private func children(of item: Any?) -> [SnippetControl] {
        guard let item = item as? SnippetControl else { return controls }
        return item.children ?? []
    }
    func outlineView(_ outlineView: NSOutlineView, numberOfChildrenOfItem item: Any?) -> Int { children(of: item).count }
    func outlineView(_ outlineView: NSOutlineView, isItemExpandable item: Any) -> Bool { !children(of: item).isEmpty }
    func outlineView(_ outlineView: NSOutlineView, child index: Int, ofItem item: Any?) -> Any { children(of: item)[index] }

    func outlineView(_ outlineView: NSOutlineView, viewFor column: NSTableColumn?, item: Any) -> NSView? {
        guard let control = item as? SnippetControl else { return nil }
        var ancestor = outline.parent(forItem: control) as? SnippetControl
        var groupEnabled = true
        while let group = ancestor {
            if disabled.contains(group.key) { groupEnabled = false; break }
            ancestor = outline.parent(forItem: group) as? SnippetControl
        }
        if column?.identifier.rawValue == "enabled" {
            let check = NSButton(checkboxWithTitle: "", target: self, action: #selector(toggle(_:)))
            check.identifier = .init(control.key)
            check.state = disabled.contains(control.key) ? .off : .on
            check.isEnabled = groupEnabled
            check.setAccessibilityLabel(L("settings.snippetEnabled") + " " + control.title)
            return check
        }
        let field = NSTextField(labelWithString: "")
        field.lineBreakMode = .byTruncatingTail
        let title = NSMutableAttributedString(string: control.title, attributes: [
            .font: NSFont.systemFont(ofSize: 12, weight: control.children == nil ? .regular : .semibold),
            .foregroundColor: groupEnabled ? NSColor.labelColor : NSColor.disabledControlTextColor,
        ])
        if let detail = control.detail, !detail.isEmpty {
            title.append(NSAttributedString(string: "   " + detail, attributes: [
                .font: NSFont.systemFont(ofSize: 11),
                .foregroundColor: groupEnabled ? NSColor.secondaryLabelColor : NSColor.disabledControlTextColor,
            ]))
            field.toolTip = detail
        }
        field.attributedStringValue = title
        return field
    }

    @objc private func toggle(_ sender: NSButton) {
        guard let id = sender.identifier?.rawValue else { return }
        if sender.state == .on { disabled.remove(id) }
        else { disabled.insert(id) }
        SnippetPreferences.disabled = disabled
        changed()
        outline.reloadData(forRowIndexes: IndexSet(integersIn: 0..<outline.numberOfRows),
                           columnIndexes: IndexSet(integersIn: 0..<outline.numberOfColumns))
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
    var loadControls: ((@escaping ([SnippetControl]) -> Void) -> Void)?
    var preferencesChanged: (() -> Void)?
    private var placeholders: [[String: Any]] = []
    private let insertPlaceholder = NSPopUpButton(frame: .zero, pullsDown: true)
    private let availability = NSButton(title: L("settings.snippetAvailability"), target: nil, action: nil)
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
        let enabled = NSTableColumn(identifier: .init("enabled")); enabled.title = L("settings.snippetEnabled"); enabled.width = 66; enabled.minWidth = 60; enabled.maxWidth = 80
        let value = NSTableColumn(identifier: .init("content")); value.title = L("settings.snippetContent")
        table.addTableColumn(trigger); table.addTableColumn(enabled); table.addTableColumn(value)
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
        availability.target = self; availability.action = #selector(showAvailability); availability.bezelStyle = .rounded; availability.controlSize = .small
        for view in [tableScroll, buttons, availability, insertPlaceholder, contentScroll, status, empty] { view.translatesAutoresizingMaskIntoConstraints = false; addSubview(view) }
        NSLayoutConstraint.activate([
            tableScroll.topAnchor.constraint(equalTo: topAnchor), tableScroll.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 44), tableScroll.trailingAnchor.constraint(equalTo: trailingAnchor),
            tableScroll.heightAnchor.constraint(equalToConstant: 150),
            empty.centerXAnchor.constraint(equalTo: tableScroll.centerXAnchor), empty.centerYAnchor.constraint(equalTo: tableScroll.centerYAnchor, constant: 10),
            buttons.topAnchor.constraint(equalTo: tableScroll.bottomAnchor, constant: 6), buttons.leadingAnchor.constraint(equalTo: tableScroll.leadingAnchor),
            availability.centerXAnchor.constraint(equalTo: tableScroll.centerXAnchor), availability.centerYAnchor.constraint(equalTo: buttons.centerYAnchor),
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
    func refreshPlaceholders() { loadPlaceholders? { [weak self] list in self?.placeholders = list } }
    @objc private func showAvailability() {
        guard let window, window.attachedSheet == nil else { return }
        loadControls? { [weak self, weak window] controls in
            guard let window, window.isVisible, window.attachedSheet == nil, let self else { return }
            let alert = NSAlert()
            alert.messageText = L("settings.snippetAvailability")
            if controls.isEmpty {
                alert.informativeText = L("error.settingsUnavailable")
            } else {
                alert.informativeText = L("settings.snippetAvailabilityHint")
                alert.accessoryView = SnippetAvailabilityView(controls: controls) { [weak self] in
                    self?.preferencesChanged?()
                }
            }
            alert.addButton(withTitle: L("settings.snippetDone"))
            alert.beginSheetModal(for: window)
        }
    }
    private func placeholderSubmenu(_ title: String, in menu: NSMenu) -> NSMenu {
        if let submenu = menu.item(withTitle: title)?.submenu { return submenu }
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        let submenu = NSMenu()
        item.submenu = submenu
        menu.addItem(item)
        return submenu
    }

    /// One submenu per trigger, with a second level for categorized presets.
    func menuNeedsUpdate(_ menu: NSMenu) {
        while menu.items.count > 1 { menu.removeItem(at: 1) }
        for item in placeholders {
            guard let token = item["token"] as? String else { continue }
            var destination = menu
            if let trigger = item["trigger"] as? String {
                destination = placeholderSubmenu("@\(trigger)", in: menu)
                if let category = item["category"] as? String {
                    destination = placeholderSubmenu(L(category), in: destination)
                }
            }
            let example = (item["example"] as? String) ?? (item["description"] as? String) ?? ""
            let entry = NSMenuItem(title: "{\(token)}", action: #selector(placeholderChosen(_:)), keyEquivalent: "")
            entry.target = self; entry.representedObject = token
            let title = NSMutableAttributedString(string: "{\(token)}", attributes: [.font: NSFont.monospacedSystemFont(ofSize: 12, weight: .medium)])
            if !example.isEmpty { title.append(NSAttributedString(string: "   \(example)", attributes: [.font: NSFont.systemFont(ofSize: 12), .foregroundColor: NSColor.secondaryLabelColor])) }
            entry.attributedTitle = title
            destination.addItem(entry)
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
        if tableColumn?.identifier.rawValue == "enabled" {
            let check = NSButton(checkboxWithTitle: "", target: self, action: #selector(snippetEnabledChanged(_:)))
            check.tag = row; check.state = rows[row].enabled == false ? .off : .on; check.isEnabled = editable
            check.setAccessibilityLabel(L("settings.snippetEnabled") + " @" + rows[row].trigger)
            return check
        }
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
        table.reloadData(forRowIndexes: [field.tag], columnIndexes: IndexSet(integersIn: 0..<table.numberOfColumns))
        scheduleSave()
    }
    @objc private func snippetEnabledChanged(_ sender: NSButton) {
        guard editable, rows.indices.contains(sender.tag) else { return }
        let row = sender.tag, previous = rows[row].enabled
        rows[row].enabled = sender.state == .off ? false : nil
        if !saveNow() {
            rows[row].enabled = previous
            sender.state = previous == false ? .off : .on
        }
    }

    // MARK: Content
    func textDidChange(_ notification: Notification) {
        let row = table.selectedRow
        guard rows.indices.contains(row) else { return }
        rows[row].content = content.string
        table.reloadData(forRowIndexes: [row], columnIndexes: [table.column(withIdentifier: .init("content"))])
        scheduleSave()
    }

    @objc private func buttonPressed() {
        if buttons.selectedSegment == 0 { addSnippet() }
        else { removeSnippet(at: table.selectedRow) }
    }
    func addSnippet() {
        guard editable else { return }
        rows.append(UserSnippet(trigger: "", content: "")); table.reloadData()
        let row = rows.count - 1
        table.selectRowIndexes([row], byExtendingSelection: false); table.scrollRowToVisible(row)
        table.editColumn(0, row: row, with: nil, select: true)
        updateControls()
    }
    private func removeSnippet(at row: Int) {
        guard editable, rows.indices.contains(row) else { return }
        rows.remove(at: row); table.reloadData()
        if !rows.isEmpty { table.selectRowIndexes([min(row, rows.count - 1)], byExtendingSelection: false) }
        scheduleSave()
        updateControls()
    }
    func removeSnippetFromCommand() {
        chooseSnippet(title: L("settings.snippetRemove"), confirm: L("app.delete")) { [weak self] row in
            self?.removeSnippet(at: row)
        }
    }
    func insertPlaceholderFromCommand() {
        chooseSnippet(title: L("settings.insertPlaceholder"), confirm: L("app.continue")) { [weak self] row in
            guard let self, self.rows.indices.contains(row) else { return }
            let selected = self.table.selectedRow
            self.table.selectRowIndexes([row], byExtendingSelection: false)
            self.table.scrollRowToVisible(row)
            self.updateControls()
            self.window?.makeFirstResponder(self.content)
            if row != selected {
                self.content.setSelectedRange(NSRange(location: (self.content.string as NSString).length, length: 0))
            }
            self.insertPlaceholder.performClick(nil)
        }
    }
    private func chooseSnippet(title: String, confirm: String, _ choose: @escaping (Int) -> Void) {
        guard editable, let window, window.attachedSheet == nil else { return }
        let alert = NSAlert()
        alert.messageText = title
        guard !rows.isEmpty else {
            alert.informativeText = L("settings.snippetsEmpty")
            alert.beginSheetModal(for: window)
            return
        }
        let picker = NSPopUpButton(frame: NSRect(x: 0, y: 0, width: 280, height: 28), pullsDown: false)
        for (index, snippet) in rows.enumerated() {
            let line = snippet.content.split(whereSeparator: \.isNewline).first ?? ""
            let preview = line.isEmpty ? "" : " · " + String(line.prefix(52))
            picker.addItem(withTitle: "\(index + 1). @\(snippet.trigger)\(preview)")
        }
        picker.setAccessibilityLabel(L("settings.snippets"))
        if rows.indices.contains(table.selectedRow) { picker.selectItem(at: table.selectedRow) }
        alert.accessoryView = picker
        alert.addButton(withTitle: confirm)
        alert.addButton(withTitle: L("app.cancel"))
        alert.beginSheetModal(for: window) { response in
            if response == .alertFirstButtonReturn { choose(picker.indexOfSelectedItem) }
        }
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
    @discardableResult func saveNow() -> Bool {
        guard editable, let save else { return false }
        pendingSave?.cancel(); pendingSave = nil
        let valid = rows.filter { UserSnippet.isValidTrigger($0.trigger) && !$0.content.isEmpty }
        if let error = save(valid) { status.stringValue = error; status.textColor = .systemRed; return false }
        let invalid = rows.contains { !$0.trigger.isEmpty && !UserSnippet.isValidTrigger($0.trigger) }
        status.stringValue = invalid ? L("settings.snippetInvalidTrigger") : ""; status.textColor = invalid ? .systemRed : .secondaryLabelColor
        return true
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
    func testPlaceholderMenu() -> NSMenu? {
        guard let menu = insertPlaceholder.menu else { return nil }
        menuNeedsUpdate(menu)
        return menu
    }
    func testInsertPlaceholder(_ token: String) -> String {
        func find(in menu: NSMenu) -> NSMenuItem? {
            for item in menu.items {
                if item.representedObject as? String == token { return item }
                if let submenu = item.submenu, let match = find(in: submenu) { return match }
            }
            return nil
        }
        if let menu = testPlaceholderMenu(), let item = find(in: menu) { placeholderChosen(item) }
        saveNow(); return content.string
    }
    #endif
}
