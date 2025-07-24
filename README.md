# Tight Lists Formatter for Obsidian

This Obsidian plugin formats Markdown lists to be "tight" (no empty lines between list items) and optionally applies additional formatting with mdformat.

## Features

- **Manual Formatting**: Format the entire file or just selected text via commands
- **Auto-Formatting**: Automatically format files on save with a configurable delay
- **Folder Rules**: Configure different formatting settings for specific folders
- **mdformat Integration**: Optionally pipe content through mdformat for additional CommonMark formatting

## Commands

The plugin adds the following commands to the Command Palette:

- **Format current file**: Formats the entire active file using the tight lists formatter
- **Format current file (with mdformat)**: Formats the file and additionally applies mdformat
- **Format selected text**: Formats only the selected text
- **Toggle auto-format**: Quickly enable/disable auto-formatting

## Settings

### Global Settings

- **Enable auto-format**: Toggle automatic formatting when editing files
- **Auto-format delay**: Set the delay (1-30 seconds) after last edit before formatting
- **Use mdformat**: Enable mdformat processing globally (requires mdformat to be installed)

### Folder Rules

You can create folder-specific rules that override global settings. More specific paths take precedence over less specific ones.

For each folder, you can:
- Enable/disable auto-formatting
- Override the mdformat setting

## Installation

1. Copy the plugin folder to your vault's `.obsidian/plugins/` directory
2. Ensure the `md-tight-lists.sh` script has executable permissions
3. Enable the plugin in Obsidian's Community Plugins settings

## Requirements

- Obsidian desktop app (this plugin uses shell scripts and is desktop-only)
- Bash shell available on your system
- Optional: `mdformat` with GitHub-flavored Markdown support for enhanced formatting

### Installing mdformat (Optional)

For the best formatting experience with full GitHub-flavored Markdown (GFM) support, install mdformat using pipx:

```bash
# Install pipx if you don't have it
pip install pipx

# Install mdformat with GFM extensions
pipx install mdformat
pipx inject mdformat mdformat-gfm mdformat-frontmatter mdformat-footnote mdformat-gfm-alerts
```

**Why pipx?** pipx installs Python packages in isolated environments, preventing dependency conflicts while making the commands globally available.

**What this adds:**
- **mdformat-gfm**: GitHub-flavored Markdown support (tables, strikethrough, etc.)
- **mdformat-frontmatter**: Preserves YAML frontmatter (already handled by our script)
- **mdformat-footnote**: Proper footnote formatting
- **mdformat-gfm-alerts**: GitHub alert boxes (`> [!NOTE]`, etc.)

If mdformat is not detected, the plugin will automatically hide the mdformat-related commands and work with basic tight list formatting only.

## Usage

### Manual Formatting

1. Open a Markdown file
2. Use the Command Palette (Cmd/Ctrl+P) and search for "Format"
3. Select the desired formatting command

### Auto-Formatting

1. Enable auto-format in plugin settings
2. Edit your Markdown files normally
3. The formatter will run automatically after the configured delay

### Selection Formatting

1. Select text in the editor
2. Run the "Format selected text" command
3. Only the selected text will be formatted

## Technical Details

The plugin uses the `md-tight-lists.sh` shell script to perform the actual formatting. The script:
- Removes empty lines between list items
- Preserves empty lines before and after list blocks
- Optionally pipes through mdformat with the `-f` flag