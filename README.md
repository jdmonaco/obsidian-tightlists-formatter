# Tight Lists Formatter for Obsidian

This Obsidian plugin formats Markdown lists to be "tight" (no empty lines between list items) and optionally applies comprehensive CommonMark formatting with mdformat.

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

You can create folder-specific rules that override global settings. More specific paths take precedence over less specific ones.

For each folder, you can:

- Enable/disable auto-formatting

## Installation

1. Copy the plugin folder to your vault's `.obsidian/plugins/` directory
2. Ensure the `md-tight-lists.sh` script has executable permissions
3. Enable the plugin in Obsidian's Community Plugins settings

## Requirements

- Obsidian desktop app (this plugin uses shell scripts and is desktop-only)
- Bash shell available on your system
- Optional: `mdformat` with GitHub-flavored Markdown support for enhanced formatting

### Installing mdformat (Optional)

For the best formatting experience with full GitHub-flavored Markdown (GFM) support and automatic tight list formatting, install mdformat using pipx:

```bash
# Install pipx if you don't have it
pip install pipx

# Install mdformat with GFM extensions and tight-lists plugin
pipx install mdformat
pipx inject mdformat mdformat-gfm mdformat-frontmatter mdformat-footnote mdformat-gfm-alerts mdformat-tight-lists
```

**Why pipx?** pipx installs Python packages in isolated environments, preventing dependency conflicts while making the commands globally available.

**What this adds:**

- **mdformat-gfm**: GitHub-flavored Markdown support (tables, strikethrough, etc.)
- **mdformat-frontmatter**: Preserves YAML frontmatter
- **mdformat-footnote**: Proper footnote formatting
- **mdformat-gfm-alerts**: GitHub alert boxes (`> [!NOTE]`, etc.)
- **mdformat-tight-lists**: Automatic tight list formatting (removes empty lines between list items)

If mdformat is not detected, the plugin will use the built-in tight list formatter. When mdformat is available, you can enable it in settings to use comprehensive CommonMark formatting with all installed plugins.

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

The plugin performs formatting in two modes:

### Basic Mode (without mdformat)
Uses the `md-tight-lists.sh` shell script which:

- Removes empty lines between list items
- Preserves empty lines before and after list blocks
- Preserves YAML frontmatter
- Works as a simple pipe filter

### Enhanced Mode (with mdformat)
When mdformat is enabled and available:

- Calls mdformat directly for comprehensive CommonMark formatting
- Automatically formats lists as tight lists if mdformat-tight-lists plugin is installed
- Provides consistent, standardized Markdown formatting
- Handles tables, footnotes, GFM extensions, and more

### Atomic File Updates
The plugin reads and writes entire files atomically to prevent merge conflicts with Obsidian's editor. This ensures that formatting operations don't interfere with your active editing session.

## Troubleshooting

### mdformat Plugin Conflicts

If you encounter an error like:
```
Warning: Plugin conflict. More than one plugin defined a renderer for "list_item" syntax.
```

This typically occurs when multiple mdformat plugins attempt to handle the same syntax element. Common conflicts:

- **mdformat-gfm** and **mdformat-tight-lists** both handling list items
- Multiple table formatting plugins

**Solutions:**
1. Check your installed mdformat plugins: `pipx runpip mdformat list`
2. Remove conflicting plugins if necessary
3. Consider using only the essential plugins for your workflow

**Recommended minimal setup:**
```bash
pipx install mdformat
pipx inject mdformat mdformat-frontmatter mdformat-tight-lists
```
