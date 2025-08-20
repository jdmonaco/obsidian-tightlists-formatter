# Tight Lists Formatter for Obsidian

Automatically format Markdown lists to be "tight" (no empty lines between items) in your Obsidian notes.

## Quick Start

1. **Install** the plugin from Obsidian Community Plugins
2. **Choose your workflow**:
    - **Manual formatting**: Use Command Palette commands to format files or selected text
    - **Auto-formatting**: Enable automatic formatting in settings (global or per-folder)
3. **Write naturally** - the plugin preserves list semantics while removing unnecessary blank lines

**Key formatting behavior**: The plugin distinguishes between different top-level list markers (`-`, `*`, `+`) and treats them as separate lists. With mdformat formatting enabled, nested “sibling” lists are also grouped by type (ordered vs. unordered).

## Features

- ✨ **Smart List Formatting**: Automatically removes empty lines between list items while preserving list boundaries
- 🎯 **Flexible Targeting**: Format entire files, selected text, or auto-format as you type
- ⚡ **Two Auto-Format Modes**: Delay-based (after edits) or event-based (on file events)
- 📁 **Folder Rules**: Apply different formatting settings to specific folders
- 🔧 **mdformat Integration**: Optional enhancement for comprehensive Markdown formatting based on the CommonMark standard

## Commands

The plugin adds the following commands to the Command Palette:

- **Format current file**: Formats the entire active file
- **Format selected text**: Formats only the currently selected text
- **Toggle auto-format**: Quickly enable/disable global auto-formatting

## Settings

### Global Formatter Options

- **Enable global automatic formatting**: Apply auto-formatting across your vault
- **Use mdformat**: When [mdformat](https://mdformat.readthedocs.io/en/stable/) is inst, apply comprehensive formatting based on the CommonMark standard

### Auto-Formatting Modes

Choose one or both modes (at least one required when auto-formatting is enabled):

**Delay-based mode** (default by enabled)

- Formats after a pause in editing (default: 2 seconds)
- Adjustable delay: 1-10 seconds

**Event-based mode**

- Format when opening a note
- Format when switching between notes
- Format when leaving a note

### Folder-Specific Rules

Create rules to auto-format all notes within specific folders, independent of global settings. Useful for maintaining consistent formatting in project folders or shared directories.

## Advanced Setup: mdformat Integration

For enhanced formatting based on the CommonMark standard, install mdformat:

```bash
# Install pipx if needed
pip install pipx

# Install mdformat with recommended plugins
pipx install mdformat
pipx inject mdformat mdformat-frontmatter mdformat-tight-lists
```

**Why mdformat?**

- Comprehensive formatting based on the CommonMark standard
- Preserves Obsidian frontmatter
- Additional plugin ecosystem for extended Markdown features

**Optional mdformat plugins:**

- `mdformat-gfm`: GitHub Flavored Markdown support
- `mdformat-footnote`: Footnote formatting
- `mdformat-simple-breaks`: Alternative line break handling

See the [full list of mdformat plugins](https://mdformat.readthedocs.io/en/stable/users/plugins.html).

## Requirements

- Obsidian desktop app (uses shell scripts, desktop-only)
- Bash shell (pre-installed on macOS/Linux, available via WSL on Windows)
- Optional: install mdformat for enhanced formatting

## Technical Notes

- **Atomic Updates**: The plugin reads and writes files atomically to prevent conflicts with Obsidian's editor
- **List Type Preservation**: Different markers (`-`, `*`, `+`) for adjacent top-level lists are separated by empty lines
- **Smart Nesting**: Nested lists are grouped by type (ordered vs unordered) regardless of marker (mdformat-only for now)
- **Validation Override**: When using mdformat, the plugin passes `--no-validate` to allow the opinionated tight-lists formatting
