# Changelog

All notable changes to the Obsidian Tight Lists Formatter plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added
- Enhanced mdformat integration with direct execution instead of script piping
- Detection for mdformat-tight-lists plugin installation
- Improved settings UI showing mdformat and plugin installation status
- Atomic file updates to prevent merge conflicts with Obsidian's editor

### Changed
- **Simplified command structure**: Reduced from 4 commands to 2 formatting commands
- **Unified mdformat control**: All formatting operations now respect the global mdformat setting
- **Cleaner settings UI**: mdformat toggle only shown when mdformat is available
- **Simplified folder rules**: Removed per-folder mdformat override for clearer mental model
- Removed startup notification about missing tight-lists plugin
- Simplified md-tight-lists.sh script to be a pure pipe filter
- mdformat now runs directly when enabled, providing comprehensive CommonMark formatting
- Updated installation instructions to include mdformat-tight-lists plugin
- Clarified distinction between basic tight-lists formatting and full mdformat processing

### Technical Improvements
- Split formatter execution into separate methods for mdformat and tight-lists script
- Enhanced mdformat detection to check specific installation paths
- Improved error handling and user feedback
- Removed forceUseMdformat parameter from formatting methods

### User Experience Improvements
- Auto-formatting now skips if text is selected to avoid disrupting user workflow
- Cursor position is preserved after formatting operations
- Leading newlines in selected text are now preserved during formatting
- Added troubleshooting section for mdformat plugin conflicts

## Initial Development

### Features
- Manual formatting via Command Palette
- Auto-formatting with configurable delay
- Folder-specific formatting rules
- Selection formatting support
- mdformat integration option
- Desktop-only implementation using shell scripts