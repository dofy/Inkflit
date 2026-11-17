import Foundation

@main
struct DefaultsMigrationTest {
    static func main() {
        let name = "inkflit-migration-test-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        defaults.set("existing", forKey: "language")
        DefaultsMigration.migrate(defaults: defaults, destinationDomain: name,
            legacy: ["notesDirectory": "/tmp/old-notes", "language": "ja", "unknown": "ignore"])
        precondition(defaults.string(forKey: "notesDirectory") == "/tmp/old-notes")
        precondition(defaults.string(forKey: "language") == "existing")
        precondition(defaults.object(forKey: "unknown") == nil)
        defaults.set("/tmp/new-notes", forKey: "notesDirectory")
        DefaultsMigration.migrate(defaults: defaults, destinationDomain: name,
            legacy: ["notesDirectory": "/tmp/old-notes"])
        precondition(defaults.string(forKey: "notesDirectory") == "/tmp/new-notes")
        print("Defaults migration preserves legacy values and never overwrites new settings")
    }
}
