import Foundation

enum Localization {
    static let catalog: [String: [String: String]] = {
        guard let url = Bundle.main.url(forResource: "Translations", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let values = try? JSONDecoder().decode([String: [String: String]].self, from: data) else { return [:] }
        return values
    }()
    static let supported = ["en", "zh-Hans", "zh-Hant", "ja"]
    static func resolve(_ preferred: [String]) -> String {
        for name in preferred {
            let value = name.lowercased().replacingOccurrences(of: "_", with: "-")
            if value.hasPrefix("zh") { return ["hant", "-tw", "-hk", "-mo"].contains(where: value.contains) ? "zh-Hant" : "zh-Hans" }
            if value.hasPrefix("ja") { return "ja" }
            if value.hasPrefix("en") { return "en" }
        }
        return "en"
    }
    static var preference: String { UserDefaults.standard.string(forKey: "language") ?? "system" }
    static var current: String { supported.contains(preference) ? preference : resolve(Locale.preferredLanguages) }
}
func L(_ key: String) -> String { Localization.catalog[key]?[Localization.current] ?? key }
