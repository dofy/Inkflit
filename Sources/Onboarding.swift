import Foundation

enum OnboardingError: LocalizedError {
    case unavailable
    var errorDescription: String? { L("error.readGuideNotes") }
}

enum Onboarding {
    static func contents(data: Data) throws -> [String] {
        let notes = try JSONDecoder().decode([String].self, from: data)
        guard !notes.isEmpty, notes.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else { throw OnboardingError.unavailable }
        return notes
    }
    static func contents(language: String, bundle: Bundle = .main) throws -> [String] {
        let language = Localization.supported.contains(language) ? language : "en"
        guard let url = bundle.url(forResource: "Onboarding.\(language)", withExtension: "json") else { throw OnboardingError.unavailable }
        return try contents(data: Data(contentsOf: url))
    }
    static func snapshot(data: Data) throws -> NoteSnapshot {
        let now = ISO8601DateFormatter().string(from: Date())
        let notes = try contents(data: data).map { StoredNote(id: UUID().uuidString, content: $0, created: now, updated: now) }
        guard let first = notes.first else { throw OnboardingError.unavailable }
        return NoteSnapshot(notes: notes, selected: first.id)
    }
    static func snapshot(language: String, bundle: Bundle = .main) throws -> NoteSnapshot {
        let language = Localization.supported.contains(language) ? language : "en"
        guard let url = bundle.url(forResource: "Onboarding.\(language)", withExtension: "json") else { throw OnboardingError.unavailable }
        return try snapshot(data: Data(contentsOf: url))
    }
}
