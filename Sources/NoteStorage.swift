import Foundation

enum NoteStorageError: LocalizedError {
    case destinationExists
    case invalidSnapshot
    var errorDescription: String? {
        switch self {
        case .destinationExists: return "目标文件夹已有 notes.json，未覆盖。请选择其他文件夹。"
        case .invalidSnapshot: return "无法读取当前笔记，保存位置未更改。"
        }
    }
}

enum NoteStorage {
    static func migrateIfNeeded(legacy: URL, destination: URL, files: FileManager = .default) throws -> URL {
        guard files.fileExists(atPath: legacy.path) else { return destination }
        guard !files.fileExists(atPath: destination.path) else { throw NoteStorageError.destinationExists }
        try files.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try files.copyItem(at: legacy, to: destination)
        return destination
    }

    static func saveCopy(_ data: Data, to destination: URL, files: FileManager = .default) throws {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let notes = object["notes"] as? [[String: Any]], !notes.isEmpty,
              let selected = object["selected"] as? String,
              notes.allSatisfy({ $0["id"] is String && $0["content"] is String && $0["updated"] is String }),
              notes.contains(where: { ($0["id"] as? String) == selected }) else { throw NoteStorageError.invalidSnapshot }
        guard !files.fileExists(atPath: destination.path) else { throw NoteStorageError.destinationExists }
        try data.write(to: destination, options: .withoutOverwriting)
    }
}
