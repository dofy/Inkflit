# Changelog

## [0.5.0] - 2026-11-24

### Added

- Add an About tab in Settings with the installed version, copyright, and buttons to restore guide notes and open the offline help.
- Adjust the editor font size by 1 pt with ⌘+ or ⌘−, or with the Increase Font Size and Decrease Font Size commands. A brief toast shows the current size.
- Confirm when a code block is copied, whether formatting changed the note, and when the global shortcut is cleared or restored from the command palette. The restore message shows the shortcut.

### Changed

- Increase the line spacing for note text, checklists, and code blocks.

The DMG requires Apple Silicon and macOS 13 or later. The app is ad hoc signed and has no Apple notarization. The release includes `SHA256SUMS.txt` for verification.

## [0.4.0] - 2026-11-23

### Added

- Choose Xuan paper, wool felt, fine sandstone, or coarse linen as a static note background. Adjust texture strength independently of window opacity in Settings or the command palette.
- Choose five new interface palettes in Light and Dark: Cola Red & Blue, Christmas, Lacquer Red, Midnight Gold, and Peacock & Gold.
- Find the searchable keyword for each command in the offline help, with examples for entering custom setting values.

### Changed

- Order commands by their last use, most recent first. Reopening Inkflit restores the order.
- Update the README and offline help in all four languages to cover the new appearance settings and current keyboard shortcuts.

The DMG requires Apple Silicon and macOS 13 or later. The app is ad hoc signed and has no Apple notarization. The release includes `SHA256SUMS.txt` for verification.

## [0.3.0] - 2026-11-23

### Added

- Slide between notes in the direction of navigation with a soft rebound.
- Nudge the page when a shortcut tries to move past the first or last note.
- Pin the note window from the toolbar or command palette to keep it open when pressing Esc or switching apps. Use ⌘W to close it.
- Toggle snippet groups and individual built-in or custom snippets in Settings without deleting them.
- Choose an installed font and size for the note editor in Appearance settings.

### Changed

- Replace note scrollbars with edge cues for content above and below the visible area.
- Put the last command first in the command palette, then rank other commands by recent usage.
- Keep the scientific constant suggestions and placeholder picker focused on frequently used constants.
- Refactor window and snippet settings into dedicated modules, move URL parsing into automation, and consolidate note creation and index generation.
- Tint inline code with the selected interface palette.
- Put Launch at login first in General settings.
- Use theme-colored circular task markers in checklist blocks and Markdown tasks.

### Fixed

- Restore the previous scroll position when returning to a note.
- Apply the selected interface palette and appearance throughout offline help.
- Find the minute unit with `@min` alongside the `min()` function in math snippets.
- Keep Return on the last line of a feature block inside the block.
- Keep the feature block menu next to its trigger when filtering near a window edge.
- Show a no-match message when punctuation in a `/` search has no match. Backspace can return to the previous matches.
- Temporarily use an ASCII keyboard while searching feature block and snippet suggestions, then restore the previous input source.
- Show a no-match message for `@` searches and keep the English input source active until the search ends.
- Reload note contents in the editor after rebuilding the note index.

The DMG requires Apple Silicon and macOS 13 or later. The app is ad hoc signed and has no Apple notarization. The release includes `SHA256SUMS.txt` for verification.

## [0.2.2] - 2026-11-19

### Added

- MCP can page through notes with short summaries, read the selected note, and analyze calculation and checklist blocks.
- MCP can preview a formatting diff for supported code blocks and math expressions, then apply it by note ID if the content still matches the preview.
- New `inkflit://` links open a specific note or go directly to Appearance or Snippets settings.
- **Format Note** in the command palette formats math expression spacing and supported code blocks in the current note. Code follows the existing indentation setting, and the entire change can be undone in one step.
- Press **⌘↩** anywhere in a `list` item or a Markdown task to toggle it, including on a Markdown task's continuation line.
- Math snippets now include 10 mathematical and 50 scientific constants under `@const`. Search for individual constants with names like `@pi` and `@speedoflight`.
- The snippet editor's **Insert placeholder** menu includes math functions, units, currencies, and constants.
- A local install script builds and verifies an app at a new path.
- Choose Follow System, Light, or Dark in Settings or the command palette. The appearance is saved between launches.
- Reset the note window to its default 2:3 size from Appearance settings or the command palette.
- Choose whether to press Esc once or twice to hide the window in Vim Normal mode from Edit settings or the command palette.
- Run more editor, window, recovery, shortcut, and snippet actions from the command palette.

### Changed

- Use the Inkflit app icon in both the sidebar and header of offline help.
- Share command definitions between the command palette, note toolbar, and editor shortcuts. Align command groups and keyboard shortcuts in fixed columns.
- Show command shortcuts and palette navigation hints as keycaps.
- Browse unit suggestions by category. Category names support fuzzy search, and Esc returns from a snippet submenu with the previous query and selection restored.
- Math expressions use the code theme for highlighting. Variable definitions and references match code variables, currency codes match units, and trailing equals signs use the operator style.
- Use GitHub, Solarized, and One Light / One Dark for code highlighting and previews. Each theme follows Inkflit’s appearance. Old theme IDs fall back to GitHub.
- By default, press Esc twice within 0.6 seconds to hide the window in Vim Normal mode. The first press shows a hint.
- Use the current accent color for the Esc hint and a darker background in Dark mode.
- Match the status bar background to the toolbar across themes and window opacities.
- With Vim off, align the note's creation time to the left and the keyboard shortcut to the right of the status bar.
- Offline help now documents time and angle unit names, symbols, and conversions, including the difference between searching for `@sec` and using `s` or `second` in a formula.
- Update the guide notes with window settings, Vim Escape behavior, math snippets, and note formatting.

### Fixed

- Return to Vim Normal mode when hiding the window from Insert mode.
- Hide the inactive Vim cursor so its outline does not linger when the window reopens.
- Recover interrupted note saves without blocking the editor. If the on-disk data conflicts with the pending save, keep both and show where the recovery record was preserved.
- Keep feature block contents out of Markdown headings when a dash is typed immediately below the block.
- Preserve existing tabs when changing checklist indentation.

The DMG requires Apple Silicon and macOS 13 or later. The app is ad hoc signed and has no Apple notarization. The release includes `SHA256SUMS.txt` for verification.

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

[Unreleased]: https://github.com/dofy/Inkflit/compare/v0.2.2...main
[0.2.2]: https://github.com/dofy/Inkflit/releases/tag/v0.2.2
[0.2.1]: https://github.com/dofy/Inkflit/releases/tag/v0.2.1
[0.2.0]: https://github.com/dofy/Inkflit/releases/tag/v0.2.0
[0.1.3]: https://github.com/dofy/Inkflit/releases/tag/v0.1.3
[0.1.2]: https://github.com/dofy/Inkflit/releases/tag/v0.1.2
