import Foundation

enum DefaultsMigration {
    static let legacyBundleID = "local.seven.quicknote"
    static let marker = "inkflit.bundleIDMigrationCompleted"
    static let keys = ["notesDirectory", "hotKeyCode", "hotKeyModifiers", "hotKeyDisabled", "vimEnabled", "codeIndentation", "codeTheme", "uiTheme", "windowOpacity", "windowBlur", "windowAnchor", "language", "backupVersionLimit", "backupPreviousLimit"]

    static func migrate(defaults: UserDefaults, destinationDomain: String, legacy: [String: Any]?) {
        let destination = defaults.persistentDomain(forName: destinationDomain) ?? [:]
        guard destination[marker] as? Bool != true else { return }
        if let legacy {
            for key in keys where destination[key] == nil {
                if let value = legacy[key] { defaults.set(value, forKey: key) }
            }
        }
        defaults.set(true, forKey: marker)
    }
}
