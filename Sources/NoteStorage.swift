import Foundation

enum NoteStorageError: LocalizedError {
    case destinationExists
    case invalidSnapshot
    var errorDescription: String? {
        switch self {
        case .destinationExists: return L("error.destinationExists")
        case .invalidSnapshot: return L("error.storageUnchanged")
        }
    }
}

// Each note is a UTF-8 Markdown file. The index holds only ordering and metadata.
struct StoredNote: Codable, Equatable {
    var id: String
    var content: String
    // Missing for notes saved before creation times were recorded.
    var created: String? = nil
    var updated: String
}
struct NoteSnapshot: Codable, Equatable {
    var notes: [StoredNote]
    var selected: String
    func validate() throws {
        let ids = notes.map(\.id)
        guard !notes.isEmpty, ids.allSatisfy({ !$0.isEmpty }), Set(ids).count == ids.count, ids.contains(selected) else { throw NoteStorageError.invalidSnapshot }
    }
}
/// A user snippet: typing @trigger offers `content`. Rows may share a trigger,
/// like macOS text replacements; `content` can span lines and use {date}-style
/// placeholders. Stored in snippets.json next to the notes.
struct UserSnippet: Codable, Equatable {
    var trigger: String
    var content: String
    /// Starts with a lowercase letter, then lowercase letters, digits or "-".
    static func isValidTrigger(_ trigger: String) -> Bool { trigger.range(of: #"^[a-z][a-z0-9-]*$"#, options: .regularExpression) != nil }
}
private struct SnippetFile: Codable { var version = 1; var snippets: [UserSnippet] }
private struct NoteIndex: Codable {
    struct Entry: Codable { var id: String; var created: String?; var updated: String }
    var version = 1
    var notes: [Entry]
    var selected: String
}

enum NoteFiles {
    static let backupInterval: TimeInterval = 300
    /// Versions kept per note until the user picks another limit in Settings → Data.
    static let defaultBackupLimit = 12
    static var lastBackup: [String: Date] = [:]
    static let files = FileManager.default
    static func index(_ directory: URL) -> URL { directory.appendingPathComponent("index.json") }
    static func snippetsURL(_ directory: URL) -> URL { directory.appendingPathComponent("snippets.json") }
    /// User snippets, or none when the file does not exist yet.
    static func readSnippets(_ directory: URL) throws -> [UserSnippet] {
        let url = snippetsURL(directory)
        guard files.fileExists(atPath: url.path) else { return [] }
        let file = try JSONDecoder().decode(SnippetFile.self, from: Data(contentsOf: url))
        guard file.version == 1 else { throw NoteStorageError.invalidSnapshot }
        return file.snippets
    }
    static func writeSnippets(_ snippets: [UserSnippet], to directory: URL) throws {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        try encoder.encode(SnippetFile(snippets: snippets)).write(to: snippetsURL(directory), options: .atomic)
    }
    static func filename(_ id: String) -> String {
        // UUID ids are normal, but encode arbitrary ids without allowing path traversal.
        Data(id.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "=", with: "") + ".md"
    }
    static func noteURL(_ directory: URL, _ id: String) -> URL { directory.appendingPathComponent("notes", isDirectory: true).appendingPathComponent(filename(id)) }
    static func decode(_ data: Data) throws -> NoteSnapshot {
        let snapshot = try JSONDecoder().decode(NoteSnapshot.self, from: data)
        try snapshot.validate(); return snapshot
    }
    static func read(_ directory: URL) throws -> NoteSnapshot {
        let index = try JSONDecoder().decode(NoteIndex.self, from: Data(contentsOf: index(directory)))
        guard index.version == 1 else { throw NoteStorageError.invalidSnapshot }
        let notes = try index.notes.map { entry in
            StoredNote(id: entry.id, content: try String(contentsOf: noteURL(directory, entry.id), encoding: .utf8), created: entry.created, updated: entry.updated)
        }
        let snapshot = NoteSnapshot(notes: notes, selected: index.selected)
        try snapshot.validate(); return snapshot
    }
    static func prepare(_ root: URL) throws {
        try files.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        for name in ["notes", "backups", "trash"] { try files.createDirectory(at: root.appendingPathComponent(name), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) }
    }
    static func writeIndex(_ snapshot: NoteSnapshot, root: URL) throws {
        let index = NoteIndex(notes: snapshot.notes.map { .init(id: $0.id, created: $0.created, updated: $0.updated) }, selected: snapshot.selected)
        try JSONEncoder().encode(index).write(to: root.appendingPathComponent("index.json"), options: .atomic)
    }
    // Install into an existing user-selected directory without replacing unrelated files.
    static func install(_ stage: URL, in directory: URL) throws {
        let archives = try files.contentsOfDirectory(atPath: stage.path).filter { $0.hasPrefix("index-before-rebuild-") && $0.hasSuffix(".json") }
        let snippets = files.fileExists(atPath: stage.appendingPathComponent("snippets.json").path) ? ["snippets.json"] : []
        let names = ["notes", "backups", "trash"] + archives + snippets + ["index.json"]
        for name in names where files.fileExists(atPath: directory.appendingPathComponent(name).path) { throw NoteStorageError.destinationExists }
        for name in names { try files.moveItem(at: stage.appendingPathComponent(name), to: directory.appendingPathComponent(name)) }
        try files.removeItem(at: stage)
    }
    static func create(_ snapshot: NoteSnapshot, in directory: URL) throws {
        try snapshot.validate()
        try files.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        for name in ["notes", "backups", "trash", "index.json"] where files.fileExists(atPath: directory.appendingPathComponent(name).path) { throw NoteStorageError.destinationExists }
        let stage = directory.appendingPathComponent(".inkflit-prepare-\(UUID().uuidString)", isDirectory: true)
        try prepare(stage)
        for note in snapshot.notes { try Data(note.content.utf8).write(to: stage.appendingPathComponent("notes").appendingPathComponent(filename(note.id)), options: .withoutOverwriting) }
        try writeIndex(snapshot, root: stage)
        guard try read(stage) == snapshot else { throw NoteStorageError.invalidSnapshot }
        try install(stage, in: directory)
    }
    static func copy(_ snapshot: NoteSnapshot, from source: URL, to destination: URL) throws {
        guard try read(source) == snapshot else { throw NoteStorageError.invalidSnapshot }
        try files.createDirectory(at: destination, withIntermediateDirectories: true)
        for name in ["notes", "backups", "trash", "index.json", "snippets.json"] where files.fileExists(atPath: destination.appendingPathComponent(name).path) { throw NoteStorageError.destinationExists }
        let stage = destination.appendingPathComponent(".inkflit-copy-\(UUID().uuidString)", isDirectory: true)
        try files.createDirectory(at: stage, withIntermediateDirectories: true)
        for name in ["notes", "backups", "trash", "index.json"] { try files.copyItem(at: source.appendingPathComponent(name), to: stage.appendingPathComponent(name)) }
        if files.fileExists(atPath: snippetsURL(source).path) { try files.copyItem(at: snippetsURL(source), to: snippetsURL(stage)) }
        for name in try files.contentsOfDirectory(atPath: source.path) where name.hasPrefix("index-before-rebuild-") && name.hasSuffix(".json") {
            try files.copyItem(at: source.appendingPathComponent(name), to: stage.appendingPathComponent(name))
        }
        guard try read(stage) == snapshot else { throw NoteStorageError.invalidSnapshot }
        try install(stage, in: destination)
    }
    static func rebuildIndex(_ directory: URL) throws -> NoteSnapshot {
        let root = directory, folder = root.appendingPathComponent("notes", isDirectory: true)
        let entries = try files.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentModificationDateKey, .isRegularFileKey], options: [.skipsHiddenFiles]).filter { $0.pathExtension == "md" }
        let dated = try entries.map { url -> (StoredNote, Date) in
            let values = try url.resourceValues(forKeys: [.contentModificationDateKey, .isRegularFileKey])
            guard values.isRegularFile == true else { throw NoteStorageError.invalidSnapshot }
            var encoded = url.deletingPathExtension().lastPathComponent.replacingOccurrences(of: "_", with: "/").replacingOccurrences(of: "-", with: "+")
            encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
            guard let data = Data(base64Encoded: encoded), let id = String(data: data, encoding: .utf8), filename(id) == url.lastPathComponent else { throw NoteStorageError.invalidSnapshot }
            let date = values.contentModificationDate ?? Date(timeIntervalSince1970: 0)
            return (StoredNote(id: id, content: try String(contentsOf: url, encoding: .utf8), updated: ISO8601DateFormatter().string(from: date)), date)
        }.sorted { $0.1 < $1.1 }
        guard let first = dated.last else { throw NoteStorageError.invalidSnapshot }
        let snapshot = NoteSnapshot(notes: dated.map(\.0), selected: first.0.id)
        try snapshot.validate()
        let original = index(directory)
        if files.fileExists(atPath: original.path) {
            let copy = root.appendingPathComponent("\(indexArchivePrefix)\(archiveStamp.string(from: Date()))-\(UUID().uuidString).json")
            try files.copyItem(at: original, to: copy)
        }
        try writeIndex(snapshot, root: root)
        guard try read(directory) == snapshot else { throw NoteStorageError.invalidSnapshot }
        pruneIndexArchives(root)
        return snapshot
    }
    /// The index from before each rebuild is kept in case the rebuild went
    /// wrong; only the newest few are needed.
    static let indexArchivePrefix = "index-before-rebuild-", keptIndexArchives = 3
    private static let archiveStamp: DateFormatter = {
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "yyyyMMdd-HHmmss"; return formatter
    }()
    /// Names carry the time, so they sort oldest first; names from before
    /// the time was added (a bare UUID) count as the oldest.
    static func pruneIndexArchives(_ root: URL) {
        guard let names = try? files.contentsOfDirectory(atPath: root.path) else { return }
        let archives = names.filter { $0.hasPrefix(indexArchivePrefix) && $0.hasSuffix(".json") }.sorted { name, other in
            let dated = { (value: String) in value.dropFirst(indexArchivePrefix.count).range(of: #"^\d{8}-\d{6}-"#, options: .regularExpression) != nil }
            return dated(name) == dated(other) ? name < other : !dated(name)
        }
        for name in archives.dropLast(keptIndexArchives) { try? files.removeItem(at: root.appendingPathComponent(name)) }
    }
    static func uniqueName(_ date: Date = Date()) -> String { "\(Int64(date.timeIntervalSince1970 * 1_000_000))-\(UUID().uuidString).md" }
    /// `current` is the store as just read by the caller (to detect outside
    /// changes), so it is not read a second time.
    static func save(_ snapshot: NoteSnapshot, directory: URL, backupLimit: Int, now: Date = Date(), current: NoteSnapshot? = nil) throws {
        try snapshot.validate()
        let root = directory, old = try current ?? read(directory)
        let oldByID = Dictionary(uniqueKeysWithValues: old.notes.map { ($0.id, $0) })
        let newIDs = Set(snapshot.notes.map(\.id))
        // Archive before publishing the new index; a failed archive cannot delete a note.
        for note in old.notes where !newIDs.contains(note.id) {
            let folder = root.appendingPathComponent("trash").appendingPathComponent(filename(note.id).dropLast(3).description)
            try files.createDirectory(at: folder, withIntermediateDirectories: true)
            try Data(note.content.utf8).write(to: folder.appendingPathComponent(uniqueName()), options: .withoutOverwriting)
        }
        for note in snapshot.notes {
            let url = noteURL(directory, note.id)
            guard let previous = oldByID[note.id] else {
                if files.fileExists(atPath: url.path) {
                    guard try Data(contentsOf: url) == Data(note.content.utf8) else { throw NoteStorageError.destinationExists }
                    continue
                }
                try Data(note.content.utf8).write(to: url, options: .withoutOverwriting); continue
            }
            guard previous.content != note.content else { continue }
            let key = root.path + "/" + note.id
            if backupLimit != 0 && now.timeIntervalSince(lastBackup[key] ?? .distantPast) >= backupInterval {
                let folder = root.appendingPathComponent("backups").appendingPathComponent(filename(note.id).dropLast(3).description)
                try files.createDirectory(at: folder, withIntermediateDirectories: true)
                try Data(previous.content.utf8).write(to: folder.appendingPathComponent(uniqueName(now)), options: .withoutOverwriting)
                lastBackup[key] = now
                if backupLimit > 0 {
                    let versions = try files.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil).filter { $0.pathExtension == "md" }.sorted { $0.lastPathComponent > $1.lastPathComponent }
                    for version in versions.dropFirst(backupLimit) { try files.removeItem(at: version) }
                }
            }
            try Data(note.content.utf8).write(to: url, options: .atomic)
        }
        try writeIndex(snapshot, root: root)
        for note in old.notes where !newIDs.contains(note.id) { try? files.removeItem(at: noteURL(directory, note.id)) }
    }
}
