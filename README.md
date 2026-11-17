# Inkflit

English · [简体中文](README.zh-Hans.md) · [繁體中文](README.zh-Hant.md) · [日本語](README.ja.md)

A local-first floating note app for macOS, with Markdown, Vim editing, code highlighting, feature blocks and automatic saving.

On first launch, Inkflit creates four guide notes in your system language. Settings → Restore Guide Notes adds a fresh set before your existing notes, using the current app language.

## Build and run

Requires macOS 13 or later, Xcode Command Line Tools, Node.js and npm.

```sh
npm ci
npm run build
open build/Inkflit.app
```

Run `npm test` for editor tests and `npm run test:native` for isolated native-window, code editing and Vim undo/redo tests. Builds use an ad hoc signature by default; set `QUICKNOTE_CODESIGN_IDENTITY` to use an Apple Development certificate. The app is not notarized.

Inkflit lives in the menu bar. Press `Control + Option + Space` to show or hide it; it also hides when another app becomes active. Drag the top strip or empty middle of the toolbar to move the window. The default window is portrait 2:3 and can be resized freely. Open Settings from the menu bar or with `⌘,` to configure the shortcut, launch at login, note location, accent, opacity, background blur, code colors and indentation. Appearance follows macOS light/dark mode. Language follows the system by default; English, Simplified Chinese, Traditional Chinese and Japanese can be selected in Settings. Offline help is available there.

When summoned, the window appears on the display containing the pointer. Inkflit remembers the window's position as a percentage of the available travel range (the display's usable size minus the window size), including after restart. Hold `Option` while adjusting opacity or blur to snap to 5% increments.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘N` | New note |
| `⌘[` / `⌘]` | Previous / next note |
| `⌘1` | Latest note |
| `⌘D` | Delete the current note; restore the latest deletion with `⌘U` within 12 seconds or use Trash in Settings |
| `⌘⇧D` | Delete the current feature block; this can be undone |
| `⌘K` | Change the current block type |
| `⌘L` | Choose a code block language |
| `⌘O` / `⌘⇧O` | Insert an editable line below / above the current text line or feature block |
| `⌘/` | Toggle comments on the current or selected lines |
| `⌘⇧F` | Search all current notes |
| `⌘⇧P` | Open the command palette to search note actions and settings |
| `Esc` | In Vim mode, leave editing mode, then press again to hide; with Vim off, hide immediately |

Vim mode is enabled by default. Turn it off in Settings → Editing to type directly; `Esc` then hides the window and `⌘Z` / `⌘⇧Z` undo and redo.

Vim is provided by CodeMirror and `@replit/codemirror-vim`; it is not Neovim and does not load vimrc. Undo history is retained per note while the app runs, but not after exit. Normal mode temporarily switches to an ASCII input source and restores the previous input method in insert mode or when the window loses focus. An active IME candidate is cancelled before Esc leaves insert mode.

The command palette accepts command names and keywords. Use ↑ / ↓ to select, Return to run, and Esc to close. It includes note actions and settings for Vim, interface and code colors, indentation, and language. After a deletion, each notice has its own 12-second timer; `⌘U` restores the highlighted most recently deleted note, or you can click a specific notice.

## Feature blocks

In Vim insert mode, or with Vim turned off, type `/` on an empty line to choose a block. Use arrow keys and Return or click an item. A note may contain multiple independent blocks; use the block header or `⌘K` to change its type, convert it to plain text or delete it. These actions can be undone. On the last blank line of a non-code block, press Return again to leave the block.

- **list:** Check items by clicking or typing `/x` at the end of a line; checked items are saved as Markdown `[x]`. Use `Tab` / `Shift-Tab` to indent / outdent by two spaces. The first item stays at the root, an item can be at most one level deeper than its predecessor, and children move with their parent.
- **math:** End an expression with `=` to calculate. Supports arithmetic, percentages, functions, units and per-block variables such as `price: 80`. Variable definitions and subsequent references in expressions are highlighted. Currency conversions use uppercase codes, e.g. `10 USD to CNY =`.
- **sum / avg / count:** Extract and sum or average numbers without evaluating expressions or converting units (for example, `2+3=` counts two numbers); count nonempty items, words and characters. Lines beginning `//` are excluded.
- **code:** Select a language for highlighting. Settings provide three color themes with a preview and 2-space, 4-space or tab indentation. Brackets and quotes are paired, Return auto-indents, Tab indents and Shift-Tab outdents. `⌘C` copies the block content when nothing is selected.

Blocks use Inkflit text markers such as `:::quicknote math` and `:::end` in the note, rather than code fences. Legacy blocks remain readable. Exchange rates come from [Frankfurter](https://frankfurter.dev/); requests fetch public rates and do not upload notes. Unavailable rates are not invented.


## Notes and storage

Notes are stored as individual UTF-8 Markdown files in `~/Documents/Inkflit/notes/`, with an `index.json` for ordering and selection. Feature blocks use Inkflit markers. In Settings, select another folder, configure per-note backup retention (off, a count, or unlimited), restore a backup or deleted note, and rebuild a damaged index from note files. A previous version is saved at most once per note every five minutes while editing. Changing retention does not immediately delete existing versions; the limit is applied when a new version is created. Deleted notes remain in `trash/`; restoring creates a new note and keeps the original. Changing folders copies the complete store and keeps the original. Inkflit does not provide cloud sync; regularly back up the whole store separately. Continuous edits are saved after 0.5 seconds of inactivity, normally at least every 2 seconds while typing. Switching notes, hiding the window, changing storage location or quitting flushes pending changes immediately. Save errors remain visible and a failed save blocks quitting; an unexpected crash can lose unsaved recent edits.

Markdown checkboxes (`[ ]`, `[x]`, `- [ ]`) are clickable in the editor; their source remains Markdown. `//` at the start of a line comments that line. Language-labelled Markdown code fences are highlighted.

## Search and automation

Use the search button, `⌘⇧F` or the menu bar's **Search Notes** item to search current notes. Use the arrow keys and Return to open a result; Esc closes the search. Backups and Trash are excluded.

Inkflit provides a local MCP server over stdio. For Codex, run:

```sh
codex mcp add inkflit -- /Applications/Inkflit.app/Contents/MacOS/Inkflit --mcp
```

Restart the MCP client after configuring it. The tools are `list_notes`, `search_notes`, `get_note`, `create_note`, `append_note`, `replace_note` and `delete_note`. Supply either `index` (1-based, matching the displayed note number) or the stable `id`; indices change when notes are added or deleted. For `append_note` and `replace_note`, omitting both creates a note. Append adds a separating newline when needed. Deletions go to Trash. Requests use the running app's save and backup pipeline; the server starts Inkflit if necessary.

Other MCP clients can use `{"mcpServers":{"inkflit":{"command":"/Applications/Inkflit.app/Contents/MacOS/Inkflit","args":["--mcp"]}}}`. Each write accepts at most 1,000,000 UTF-16 code units of content.

For `create_note`, optionally set `position` to `"first"`, `"last"`, or a 1-based insertion position up to the note count plus one. The default is `"first"`. For example, `{"content":"My note","position":"last"}` appends a new note. URL creation also accepts `position=last` or a numeric position.

For Claude Code, run `claude mcp add --transport stdio --scope user inkflit -- /Applications/Inkflit.app/Contents/MacOS/Inkflit --mcp`. In Namo, select Settings → Connections → Add local MCP, enter the same executable and `["--mcp"]` as arguments, then test. Both apps must run as the same user on the same Mac; admitted Namo users can call these tools.

Inkflit also registers `inkflit://note/<action>`, where action is `list`, `get`, `search`, `create`, `append`, `replace` or `delete`. Use percent-encoded query parameters `index` or `id`, `content`, and `query` as applicable. Examples:

```sh
open 'inkflit://note/append?index=2&content=Remember%20milk'
open 'inkflit://note/search?query=milk'
open 'inkflit://note/get?index=1'
```

Without a target, append and replace create a note; get and delete require a target. Without a callback, get opens the note and list/search open the search view. Optional `x-success` and `x-error` parameters accept percent-encoded custom-scheme callback URLs; the callback receives a `result` query parameter containing JSON. HTTP, HTTPS, file and Inkflit callbacks are rejected. Callback JSON is limited to 48 KB. Scheme writes and deletions execute immediately, so only open trusted links.
