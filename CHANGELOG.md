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
- Offline help now documents time and angle unit names, symbols, and conversions, including the difference between searching for `@sec` and using `s` or `second` in a formula.

### Fixed

- Recover interrupted note saves without blocking the editor. If the on-disk data conflicts with the pending save, keep both and show where the recovery record was preserved.

[Earlier releases](https://github.com/dofy/Inkflit/releases)

[Unreleased]: https://github.com/dofy/Inkflit/compare/v0.2.1...main
