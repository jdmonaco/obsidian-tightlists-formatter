# Tight Lists Formatter for Obsidian

This Obsidian plugin formats Markdown lists to be "tight" (no empty lines between list items) and optionally applies comprehensive CommonMark formatting to your notes using [mdformat](https://mdformat.readthedocs.io/en/stable/users/installation_and_usage.html), which should be installed with the [mdformat-tight-lists](https://github.com/jdmonaco/mdformat-tight-lists) plugin.

## Features

- **Manual Formatting**: Format the entire file or just selected text via commands
- **Auto-Formatting**: Automatically format files on save with a configurable delay
- **Folder Rules**: Configure different formatting settings for specific folders
- **mdformat Integration**: Optionally pipe content through mdformat for additional CommonMark formatting

## Commands

The plugin adds the following commands to the Command Palette:

- **Format current file**: Formats the entire active file
- **Format selected text**: Formats only the selected text
- **Toggle auto-format**: Quickly enable/disable auto-formatting

Note: Whether mdformat is used for formatting is controlled by the global setting in the plugin configuration.

## Settings

### Global Settings

- **Enable auto-format**: Toggle automatic formatting when editing files
- **Auto-format delay**: Set the delay (1-30 seconds) after last edit before formatting
- **Use mdformat**: When mdformat is installed, this toggle controls whether to use it for all formatting operations

### Folder Rules

If you want select auto-formatting, you can add rules for specific folders to enable auto-formatting for all notes in that folder. 

## Installation

1. Copy the plugin folder to your vault's `.obsidian/plugins/` directory
2. Ensure the `md-tight-lists.sh` script has executable permissions
3. Enable the plugin in Obsidian's Community Plugins settings

## Requirements

- Obsidian desktop app (this plugin uses shell scripts and is desktop-only)
- Bash shell available on your system
- Optional: install [mdformat](https://mdformat.readthedocs.io/en/stable/users/installation_and_usage.html) &mdash; and the [mdformat-tight-lists](https://github.com/jdmonaco/mdformat-tight-lists) &mdash; for comprehensive Markdown formatting based on the [CommonMark spec](https://spec.commonmark.org/0.31.2/#introduction).

### Installing mdformat (Optional)

By default, the plugin will use an internal shell script for formatting, but you can install mdformat and enable enhanced mdformat-based formatting for comprehensive CommonMark formatting. Install mdformat using pipx:

```bash
# Install pipx if you don't have it
pip install pipx

# Install mdformat with minimal recommended plugins
pipx install mdformat
pipx inject mdformat mdformat-frontmatter mdformat-tight-lists
```

**Why pipx?** pipx installs Python packages in isolated environments, preventing dependency conflicts while making the commands globally available.

**Minimal recommended setup:**

- **mdformat-frontmatter**: Preserves YAML frontmatter (essential for Obsidian)
- **mdformat-tight-lists**: Automatic tight list formatting (aggressively removes empty lines between list items)

**Optional mdformat plugins (see [full list](https://mdformat.readthedocs.io/en/stable/users/plugins.html)):**

- **mdformat-gfm**: Support GitHub-Flavored Markdown (GFM) extensions (note: may conflict with tight-list processing)
- **[mdformat-simple-breaks](https://github.com/csala/mdformat-simple-breaks)**: Correct mdformat's flavor of thematic breaks

**Note**: The mdformat-tight-lists plugin is opinionated and converts loose lists to tight lists. This yields a semantic change: more lists will contain only bare list items that are *not* encapsulated in `<p>` tags. This is intentional &mdash; as a result the Obsidian Tight Lists Formatter plugin calls `mdformat` (when enabled) with its `--no-validate` option to prevent validation errors.

## Usage

### Manual Formatting

1. Open a Markdown file
2. Use the Command Palette (Cmd/Ctrl+P) and search for "Format"
3. Select the desired formatting command

### Auto-Formatting

1. Enable auto-format in plugin settings
2. Edit your Markdown files normally
3. The active file will be formatted automatically after the configured delay or following certain editor events

### Selection Formatting

1. Select text in the editor
2. Run the "Format selected text" command
3. Only the selected text will be formatted

### Atomic File Updates
The plugin reads and writes entire files atomically to prevent merge conflicts with Obsidian's editor. This ensures that formatting operations don't interfere with your active editing session.

