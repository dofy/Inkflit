import Foundation
import Darwin

@main struct StorageTests {
    static func main() throws {
        let files = FileManager.default
        let root = files.temporaryDirectory.appendingPathComponent("inkflit-storage-tests-\(UUID().uuidString)")
        try files.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? files.removeItem(at: root) }
        func check(_ condition: Bool, line: Int = #line) { if !condition { fatalError("check failed at storage.swift:\(line)") } }
        let directory = root.appendingPathComponent("notes-root")
        let recovery = root.appendingPathComponent("recovery")
        let before = NoteSnapshot(notes: [.init(id: "edited", content: "old", updated: "1"),
                                          .init(id: "removed", content: "keep me", updated: "1")], selected: "removed")
        let after = NoteSnapshot(notes: [.init(id: "edited", content: "new", updated: "2"),
                                         .init(id: "added", content: "new note", updated: "2")], selected: "added")
        try NoteFiles.create(before, in: recovery)
        let recoveryIndex = NoteFiles.index(recovery).path
        check(chflags(recoveryIndex, UInt32(UF_IMMUTABLE)) == 0)
        defer { _ = chflags(recoveryIndex, 0) }
        do {
            try NoteFiles.save(after, directory: recovery, backupLimit: 0, current: before)
            fatalError("an immutable index must prevent committing a save")
        } catch {}
        check(try NoteFiles.read(recovery) == before)
        check(!files.fileExists(atPath: NoteFiles.noteURL(recovery, "added").path))
        let recoveryTrash = recovery.appendingPathComponent("trash").appendingPathComponent(String(NoteFiles.filename("removed").dropLast(3)))
        check(try files.contentsOfDirectory(atPath: recoveryTrash.path).isEmpty)
        check(chflags(recoveryIndex, 0) == 0)
        try NoteFiles.save(after, directory: recovery, backupLimit: 0)
        check(try NoteFiles.read(recovery) == after)
        check(try files.contentsOfDirectory(atPath: recoveryTrash.path).count == 1)
        check(!files.fileExists(atPath: NoteFiles.noteURL(recovery, "removed").path))
        try files.createDirectory(at: directory, withIntermediateDirectories: true)
        let original = NoteSnapshot(notes: [StoredNote(id: "../危险", content: "# 中文\n:::inkflit code js\n{}\n:::end", updated: "1"), StoredNote(id: "two", content: "second", updated: "2")], selected: "two")
        let sentinel = directory.appendingPathComponent("unrelated.txt")
        try Data("untouched".utf8).write(to: sentinel)
        try NoteFiles.create(original, in: directory)
        check(try NoteFiles.read(directory) == original)
        check(try Data(contentsOf: sentinel) == Data("untouched".utf8))
        precondition(NoteFiles.noteURL(directory, "../危险").deletingLastPathComponent().lastPathComponent == "notes")
        let untouched = NoteFiles.noteURL(directory, "two")
        let initialDate = try files.attributesOfItem(atPath: untouched.path)[.modificationDate] as! Date
        var changed = original; changed.notes[0].content = "version 1"
        let start = Date(timeIntervalSince1970: 1_700_000_000)
        try NoteFiles.save(changed, directory: directory, backupLimit: 2, now: start)
        check(try NoteFiles.read(directory) == changed)
        check(try files.attributesOfItem(atPath: untouched.path)[.modificationDate] as! Date == initialDate)
        let backupDir = directory.appendingPathComponent("backups").appendingPathComponent(String(NoteFiles.filename("../危险").dropLast(3)))
        func versions() throws -> [URL] { try files.contentsOfDirectory(at: backupDir, includingPropertiesForKeys: nil).sorted { $0.lastPathComponent < $1.lastPathComponent } }
        check(try versions().count == 1)
        check(try String(contentsOf: versions()[0], encoding: .utf8) == original.notes[0].content)
        changed.notes[0].content = "version 2"; try NoteFiles.save(changed, directory: directory, backupLimit: 2, now: start.addingTimeInterval(10))
        check(try versions().count == 1)
        changed.notes[0].content = "version 3"; try NoteFiles.save(changed, directory: directory, backupLimit: 2, now: start.addingTimeInterval(301))
        changed.notes[0].content = "version 4"; try NoteFiles.save(changed, directory: directory, backupLimit: 2, now: start.addingTimeInterval(602))
        let two = try versions(); precondition(two.count == 2)
        check(try two.map { try String(contentsOf: $0, encoding: .utf8) } == ["version 2", "version 3"])
        changed.notes[0].content = "version 5"; try NoteFiles.save(changed, directory: directory, backupLimit: 0, now: start.addingTimeInterval(903))
        check(try versions().count == 2)
        changed.notes[0].content = "version 6"; try NoteFiles.save(changed, directory: directory, backupLimit: -1, now: start.addingTimeInterval(1204))
        changed.notes[0].content = "version 7"; try NoteFiles.save(changed, directory: directory, backupLimit: -1, now: start.addingTimeInterval(1505))
        check(try versions().count == 4)
        changed.notes.remove(at: 0); try NoteFiles.save(changed, directory: directory, backupLimit: 2)
        check(try NoteFiles.read(directory) == changed)
        precondition(!files.fileExists(atPath: NoteFiles.noteURL(directory, "../危险").path))
        let trash = directory.appendingPathComponent("trash").appendingPathComponent(String(NoteFiles.filename("../危险").dropLast(3)))
        let deleted = try files.contentsOfDirectory(at: trash, includingPropertiesForKeys: nil)
        check(deleted.count == 1)
        check(try String(contentsOf: deleted[0], encoding: .utf8) == "version 7")
        check(try Data(contentsOf: sentinel) == Data("untouched".utf8))
        let savedIndex = try Data(contentsOf: NoteFiles.index(directory))
        try Data("invalid".utf8).write(to: NoteFiles.index(directory), options: .atomic)
        do { _ = try NoteFiles.read(directory); fatalError("corrupt index must not load") } catch {}
        let rebuilt = try NoteFiles.rebuildIndex(directory)
        check(rebuilt.notes.map(\.content) == ["second"])
        check(try NoteFiles.read(directory) == rebuilt)
        let preserved = try files.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).filter { $0.lastPathComponent.hasPrefix("index-before-rebuild-") }
        check(preserved.count == 1)
        check(try Data(contentsOf: preserved[0]) == Data("invalid".utf8))
        // Only the newest three archives stay; old undated names go first.
        for name in ["index-before-rebuild-5B72000A-598F-4ED4-8224-B3F48897AE10.json", "index-before-rebuild-20250101-000000-A.json", "index-before-rebuild-20260101-000000-B.json", "index-before-rebuild-20270101-000000-C.json"] {
            try Data("old".utf8).write(to: directory.appendingPathComponent(name))
        }
        NoteFiles.pruneIndexArchives(directory)
        let kept = try files.contentsOfDirectory(atPath: directory.path).filter { $0.hasPrefix("index-before-rebuild-") }.sorted()
        check(kept.count == 3 && kept.contains("index-before-rebuild-20270101-000000-C.json") && kept.contains(preserved[0].lastPathComponent) && !kept.contains("index-before-rebuild-20250101-000000-A.json") && !kept.contains { $0.hasPrefix("index-before-rebuild-5B72") })
        for name in kept where name != preserved[0].lastPathComponent { try files.removeItem(at: directory.appendingPathComponent(name)) }
        try savedIndex.write(to: NoteFiles.index(directory), options: .atomic)
        try files.removeItem(at: untouched)
        do { try NoteFiles.save(changed, directory: directory, backupLimit: 2); fatalError("missing note must not be overwritten") } catch {}
        check(try Data(contentsOf: NoteFiles.index(directory)) == savedIndex)
        try Data("second".utf8).write(to: untouched)
        let custom = root.appendingPathComponent("custom")
        try files.createDirectory(at: custom, withIntermediateDirectories: true)
        var stale = changed; stale.notes[0].content = "stale"
        do { try NoteFiles.copy(stale, from: directory, to: custom); fatalError("stale snapshot must not be copied") } catch NoteStorageError.invalidSnapshot {}
        check(!files.fileExists(atPath: NoteFiles.index(custom).path))
        // User snippets live next to the notes and move with them.
        check(try NoteFiles.readSnippets(directory).isEmpty)
        let snippets = [UserSnippet(trigger: "addr", content: "Home\nStreet 1"), UserSnippet(trigger: "addr", content: "Office"), UserSnippet(trigger: "sig", content: "— {date}")]
        try NoteFiles.writeSnippets(snippets, to: directory)
        check(try NoteFiles.readSnippets(directory) == snippets)
        check(UserSnippet.isValidTrigger("addr") && UserSnippet.isValidTrigger("a-1") && !UserSnippet.isValidTrigger("Addr") && !UserSnippet.isValidTrigger("1a") && !UserSnippet.isValidTrigger("a b") && !UserSnippet.isValidTrigger(""))
        try NoteFiles.copy(changed, from: directory, to: custom)
        check(try NoteFiles.read(custom) == changed)
        check(try NoteFiles.readSnippets(custom) == snippets)
        let copiedBackup = custom.appendingPathComponent("backups").appendingPathComponent(backupDir.lastPathComponent)
        check(try files.contentsOfDirectory(atPath: copiedBackup.path).count == 4)
        for version in try versions() { check(try Data(contentsOf: version) == Data(contentsOf: copiedBackup.appendingPathComponent(version.lastPathComponent))) }
        let copiedTrash = custom.appendingPathComponent("trash").appendingPathComponent(trash.lastPathComponent)
        check(try files.contentsOfDirectory(atPath: copiedTrash.path).count == 1)
        check(try Data(contentsOf: deleted[0]) == Data(contentsOf: copiedTrash.appendingPathComponent(deleted[0].lastPathComponent)))
        check(try files.contentsOfDirectory(atPath: custom.path).contains(where: { $0.hasPrefix("index-before-rebuild-") }))
        do { try NoteFiles.copy(changed, from: directory, to: custom); fatalError("existing target must not be overwritten") } catch NoteStorageError.destinationExists {}
        for language in Localization.supported {
            let resource = URL(fileURLWithPath: "Resources/Onboarding.\(language).json")
            let contents = try Onboarding.contents(data: Data(contentsOf: resource))
            let onboarding = try Onboarding.snapshot(data: Data(contentsOf: resource))
            check(onboarding.notes.map(\.content) == contents)
            check(onboarding.selected == onboarding.notes.first?.id)
            check(Set(onboarding.notes.map(\.id)).count == onboarding.notes.count)
        }
        do { _ = try Onboarding.snapshot(data: Data("[]".utf8)); fatalError("empty guide file must be rejected") } catch OnboardingError.unavailable {}
        print("Storage creation, copy, per-note writes, backup retention and trash passed")
    }
}
