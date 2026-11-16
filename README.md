# Inkflit

English · [简体中文](README.zh-Hans.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md)

A local-first floating note app for macOS, with Markdown, Vim editing, code highlighting, feature blocks and automatic saving.

## Build and run

Requires macOS 13 or later, Xcode Command Line Tools, Node.js and npm.

```sh
npm ci
npm run build
open build/Inkflit.app
```

Run `npm test` for editor tests and `npm run test:native` for isolated native-window, code editing and Vim undo/redo tests. Builds use an ad hoc signature by default; set `QUICKNOTE_CODESIGN_IDENTITY` to use an Apple Development certificate. The app is not notarized.

Inkflit lives in the menu bar. Press `Control + Option + Space` to show or hide it; it also hides when another app becomes active. Drag the top strip or empty middle of the toolbar to move the window. The default window is portrait 2:3 and can be resized freely. Open Settings from the menu bar or with `⌘,` to configure the shortcut, launch at login, note location, accent, opacity, background blur, code colors and indentation. Appearance follows macOS light/dark mode. Language follows the system by default; English, Simplified Chinese, Traditional Chinese and Japanese can be selected in Settings. Offline help is available there.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘N` | New note |
| `⌘[` / `⌘]` | Previous / next note |
| `⌘1` | Latest note |
| `⌘D` | Delete the current note after confirmation; restore it from Trash in Settings |
| `⌘⇧D` | Delete the current feature block; undo with Vim `u` |
| `⌘K` | Change the current block type |
| `⌘L` | Choose a code block language |
| `⌘O` / `⌘⇧O` | Insert an editable line below / above the current feature block |
| `⌘/` | Toggle comments on the current or selected lines |
| `Esc` | Leave the Vim editing mode; press again in normal mode to hide |

Vim is provided by CodeMirror and `@replit/codemirror-vim`; it is not Neovim and does not load vimrc. Undo history is retained per note while the app runs, but not after exit. Normal mode temporarily switches to an ASCII input source and restores the previous input method in insert mode or when the window loses focus. An active IME candidate is cancelled before Esc leaves insert mode.

## Feature blocks

In insert mode, type `/` on an empty line to choose a block. Use arrow keys and Return or click an item. A note may contain multiple independent blocks; use the block header or `⌘K` to change its type, convert it to plain text or delete it. These actions can be undone. On the last blank line of a non-code block, press Return again to leave the block.

- **list:** Check items by clicking or typing `/x` at the end of a line; checked items are saved as Markdown `[x]`. Use `Tab` / `Shift-Tab` to indent / outdent by two spaces. The first item stays at the root, an item can be at most one level deeper than its predecessor, and children move with their parent.
- **math:** End an expression with `=` to calculate. Supports arithmetic, percentages, functions, units and per-block variables such as `price: 80`. Currency conversions use uppercase codes, e.g. `10 USD to CNY =`.
- **sum / avg / count:** Sum or average numbers, or count nonempty items, words and characters. Lines beginning `//` are excluded.
- **code:** Select a language for highlighting. Settings provide three color themes with a preview and 2-space, 4-space or tab indentation. Brackets and quotes are paired, Return auto-indents, Tab indents and Shift-Tab outdents. `⌘C` copies the block content when nothing is selected.

Blocks use Inkflit text markers such as `:::quicknote math` and `:::end` in the note, rather than code fences. Legacy blocks remain readable. Exchange rates come from [Frankfurter](https://frankfurter.dev/); requests fetch public rates and do not upload notes. Unavailable rates are not invented.

The timer feature has been removed. Existing timer blocks remain editable as plain text blocks; their text is preserved and old timer state is not resumed.

## Notes and storage

Notes are stored as individual UTF-8 Markdown files in `~/Documents/Inkflit/notes/`, with an `index.json` for ordering and selection. Feature blocks use Inkflit markers. In Settings, select another folder, configure per-note backup retention (off, a count, or unlimited), restore a backup or deleted note, and rebuild a damaged index from note files. A previous version is saved at most once per note every five minutes while editing. Changing retention does not immediately delete existing versions; the limit is applied when a new version is created. Deleted notes remain in `trash/`; restoring creates a new note and keeps the original. Changing folders copies the complete store and keeps the original. Inkflit does not provide cloud sync; regularly back up the whole store separately.

Markdown checkboxes (`[ ]`, `[x]`, `- [ ]`) are clickable in the editor; their source remains Markdown. `//` at the start of a line comments that line. Language-labelled Markdown code fences are highlighted.
