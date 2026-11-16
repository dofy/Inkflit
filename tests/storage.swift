import Foundation

@main struct StorageTests {
    static func main() throws {
        let files = FileManager.default
        let root = files.temporaryDirectory.appendingPathComponent("inkflit-storage-tests-\(UUID().uuidString)")
        try files.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? files.removeItem(at: root) }
        let legacy = root.appendingPathComponent("old/notes.json")
        let destination = root.appendingPathComponent("Documents/Inkflit/notes.json")
        let data = try JSONSerialization.data(withJSONObject: ["notes": [["id": "one", "content": "# 笔记", "updated": "now"]], "selected": "one"])
        try files.createDirectory(at: legacy.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: legacy)
        let migrated = try NoteStorage.migrateIfNeeded(legacy: legacy, destination: destination)
        let oldData = try Data(contentsOf: legacy), migratedData = try Data(contentsOf: destination)
        precondition(migrated == destination && oldData == data && migratedData == data)
        do { _ = try NoteStorage.migrateIfNeeded(legacy: legacy, destination: destination); fatalError("must reject an existing destination") }
        catch NoteStorageError.destinationExists {}
        let customDirectory = root.appendingPathComponent("custom")
        try files.createDirectory(at: customDirectory, withIntermediateDirectories: true)
        let custom = customDirectory.appendingPathComponent("notes.json")
        try NoteStorage.saveCopy(data, to: custom)
        do { try NoteStorage.saveCopy(Data("other".utf8), to: custom); fatalError("must reject invalid content") }
        catch NoteStorageError.invalidSnapshot {}
        do { try NoteStorage.saveCopy(data, to: custom); fatalError("must reject an existing file") }
        catch NoteStorageError.destinationExists {}
        let customData = try Data(contentsOf: custom)
        precondition(customData == data)
        print("Storage migration, preservation and collision checks passed")
    }
}
