# Changelog

## [Unreleased]

### Added

- **Format Note** in the command palette formats math expression spacing and supported code blocks in the current note. Code follows the existing indentation setting, and the entire change can be undone in one step.
- Press **⌘↩** anywhere in a `list` item or a Markdown task to toggle it, including on a Markdown task's continuation line.
- Math snippets now include 10 mathematical and 50 scientific constants under `@const`. Search for individual constants with names like `@pi` and `@speedoflight`.
- The snippet editor's **Insert placeholder** menu includes math functions, units, currencies, and constants.
- A local install script builds and verifies an app at a new path.

### Changed

- Browse unit suggestions by category. Category names support fuzzy search, and Esc returns from a snippet submenu with the previous query and selection restored.
- Math expressions use the code theme for highlighting. Variable definitions and references match code variables, currency codes match units, and trailing equals signs use the operator style.
- Use GitHub, Solarized, and One Light / One Dark for code highlighting and previews. Each theme follows the system appearance. Old theme IDs fall back to GitHub.
- In Vim Normal mode, press Esc twice within 0.6 seconds to hide the window. The first press shows a hint. With Vim off, a single press still hides the window.
- Match the status bar background to the toolbar across themes and window opacities.
- Offline help now documents time and angle unit names, symbols, and conversions, including the difference between searching for `@sec` and using `s` or `second` in a formula.

### Fixed

- Recover interrupted note saves without blocking the editor. If the on-disk data conflicts with the pending save, keep both and show where the recovery record was preserved.
- Keep feature block contents out of Markdown headings when a dash is typed immediately below the block.
- Preserve existing tabs when changing checklist indentation.

## [0.2.1] - 2026-11-19

### Fixed

- Recover interrupted saves and retry without treating the app's own writes as external edits.
- Allow typing in empty feature blocks, preserve literal Markdown task markers inside code, and handle tabs consistently when indenting checklists.
- Use the right comment markers in more code languages and exclude list numbering from sum and average calculations.

### Changed

- Avoid repeated editor work and reduce the bundled editor size by about 47%.

The DMG requires Apple Silicon and macOS 13 or later. It is ad hoc signed and was not notarized. The release includes `SHA256SUMS.txt` for verification.

## [0.2.0] - 2026-11-19

### Math blocks

- Color expressions from the code theme and insert functions, units, and currency codes with `@fn`, `@unit`, and `@cur`. Currency suggestions display exchange rates.
- Recognize bare `min` as minutes, add `mph` and `nmi`, and accept variable names in any script.
- Keep blocks within a whole-note `math`, `sum`, `avg`, or `count` note independent of the surrounding calculation.

### Snippets

- Insert dates, times, UUIDs, IP addresses, and machine values with `@`. Each trigger can offer multiple formats.
- Create snippets in Settings with placeholders such as `{date}`. Use `{cursor}` or `{cursor:name}` to mark highlighted caret stops. Move between them with Tab or Shift-Tab and exit with Esc.

### Notes, window, and help

- Jump to the first or last note with `⌘⇧[` or `⌘⇧]`, or use the command palette. New notes appear at the end, and the footer shows the creation time.
- Remember the window size and open on the current Space of the display under the pointer. Keep 12 backup versions per note by default.
- Replace offline help with a searchable page that includes a calculation guide.

The DMG requires Apple Silicon and macOS 13 or later. It is ad hoc signed and was not notarized. The release includes `SHA256SUMS.txt` for verification.

## [0.1.3] - 2026-11-17

- Ship an Apple Silicon DMG for macOS 13 or later. On first launch, Inkflit migrates settings from the previous bundle ID.
- The build is ad hoc signed and was not notarized. The release includes `SHA256SUMS.txt` for verification.

## [0.1.2] - 2026-11-17

- Historical build with the previous bundle ID. Its installer was retired in favor of [0.1.3], which includes settings migration.

[Unreleased]: https://github.com/dofy/Inkflit/compare/v0.2.1...main
[0.2.1]: https://github.com/dofy/Inkflit/releases/tag/v0.2.1
[0.2.0]: https://github.com/dofy/Inkflit/releases/tag/v0.2.0
[0.1.3]: https://github.com/dofy/Inkflit/releases/tag/v0.1.3
[0.1.2]: https://github.com/dofy/Inkflit/releases/tag/v0.1.2
