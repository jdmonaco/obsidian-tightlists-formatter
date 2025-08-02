import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, Modal } from 'obsidian';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface TightListsSettings {
    autoFormatEnabled: boolean;
    useMdformat: boolean;
    enableDelayBasedFormatting: boolean;
    debounceDelay: number;
    eventBasedFormatting: boolean;
    formatOnFileOpen: boolean;
    formatOnFocusGain: boolean;
    formatOnFocusLoss: boolean;
    folderRules: Record<string, { enabled: boolean }>;
}

const DEFAULT_SETTINGS: TightListsSettings = {
    autoFormatEnabled: false,
    useMdformat: false,
    enableDelayBasedFormatting: true,
    debounceDelay: 2,
    eventBasedFormatting: false,
    formatOnFileOpen: true,
    formatOnFocusGain: true,
    formatOnFocusLoss: true,
    folderRules: {},
};

export default class TightListsFormatterPlugin extends Plugin {
    settings: TightListsSettings;
    private formatDebounceTimers: Map<string, NodeJS.Timeout> = new Map();
    private scriptPath: string;
    public mdformatAvailable: boolean = false;
    public mdformatPath: string | null = null;
    public mdformatTightListsAvailable: boolean = false;
    private currentlyFormatting: Set<string> = new Set();
    private statusBarItem: HTMLElement;
    private lastActiveFile: TFile | null = null;

    async onload() {
        await this.loadSettings();

        // Set the path to the shell script
        // Simple path resolution - the script is in the same directory as the plugin
        const adapter = this.app.vault.adapter as any;
        const pluginDir = path.join(adapter.basePath, '.obsidian', 'plugins', this.manifest.id);
        this.scriptPath = path.join(pluginDir, 'md-tight-lists.sh');
        
        // Check for mdformat availability
        await this.checkMdformatAvailability();

        // Add status bar item
        this.statusBarItem = this.addStatusBarItem();
        this.updateStatusBar();

        // Add ribbon icon
        this.addRibbonIcon('list', 'Format lists', () => {
            this.formatCurrentFile();
        });

        // Add command to format current file
        this.addCommand({
            id: 'format-current-file',
            name: 'Format current file',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.formatCurrentFile();
            }
        });

        // Add command to format selection
        this.addCommand({
            id: 'format-selection',
            name: 'Format selected text',
            editorCallback: (editor: Editor, view: MarkdownView) => {
                this.formatSelection(editor);
            }
        });

        // Add command to toggle auto-format
        this.addCommand({
            id: 'toggle-auto-format',
            name: 'Toggle auto-format',
            callback: () => {
                this.settings.autoFormatEnabled = !this.settings.autoFormatEnabled;
                this.saveSettings();
                this.updateStatusBar();
                new Notice(`Auto-format ${this.settings.autoFormatEnabled ? 'enabled' : 'disabled'}`);
            }
        });

        // Add settings tab
        this.addSettingTab(new TightListsSettingTab(this.app, this));

        // Add context menu for selected text
        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu, editor, view) => {
                if (editor.getSelection()) {
                    menu.addSeparator();
                    menu.addItem((item) => {
                        item
                            .setTitle('Format Tight Lists')
                            .setIcon('list')
                            .onClick(() => {
                                this.formatSelection(editor);
                            });
                    });
                }
            })
        );

        // Register editor change event for auto-formatting
        this.registerEvent(
            this.app.workspace.on('editor-change', (editor: Editor, view: MarkdownView) => {
                if (view.file) {
                    // Skip if we're currently formatting this file
                    if (this.currentlyFormatting.has(view.file.path)) {
                        return;
                    }
                    
                    const shouldFormat = this.shouldAutoFormatFile(view.file);
                    
                    if (shouldFormat && this.settings.enableDelayBasedFormatting) {
                        this.scheduleAutoFormat(view.file);
                    }
                }
            })
        );

        // Register file-open event for event-based formatting
        this.registerEvent(
            this.app.workspace.on('file-open', (file: TFile | null) => {
                if (file && file.extension === 'md') {
                    // Update status bar
                    this.updateStatusBar();
                    
                    // Trigger event-based format if enabled
                    if (this.settings.eventBasedFormatting && this.settings.formatOnFileOpen) {
                        this.triggerEventBasedFormat(file, 'file-open');
                    }
                }
            })
        );

        // Register active-leaf-change event for focus tracking
        this.registerEvent(
            this.app.workspace.on('active-leaf-change', (leaf) => {
                const view = leaf?.view;
                if (view instanceof MarkdownView && view.file) {
                    const currentFile = view.file;
                    
                    // Update status bar
                    this.updateStatusBar();
                    
                    // Handle focus loss on previous file
                    if (this.lastActiveFile && this.lastActiveFile !== currentFile) {
                        if (this.settings.eventBasedFormatting && this.settings.formatOnFocusLoss) {
                            this.triggerEventBasedFormat(this.lastActiveFile, 'focus-loss');
                        }
                    }
                    
                    // Handle focus gain on current file
                    if (this.lastActiveFile !== currentFile) {
                        if (this.settings.eventBasedFormatting && this.settings.formatOnFocusGain) {
                            this.triggerEventBasedFormat(currentFile, 'focus-gain');
                        }
                    }
                    
                    this.lastActiveFile = currentFile;
                }
            })
        );
    }

    onunload() {
        // Clear all debounce timers
        for (const timer of this.formatDebounceTimers.values()) {
            clearTimeout(timer);
        }
        this.formatDebounceTimers.clear();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.updateStatusBar();
    }

    private async checkMdformatAvailability(): Promise<void> {
        // Priority order for checking mdformat locations
        const priorityPaths = [
            // pipx default installation
            path.join(process.env.HOME || '', '.local', 'bin'),
            // user-local installation
            path.join(process.env.HOME || '', 'local', 'bin'),
            // Homebrew installation
            '/opt/homebrew/bin',
            // Linuxbrew installation
            '/home/linuxbrew/.linuxbrew/bin',
        ];
        const pathEnv = process.env.PATH || '';
        const possiblePaths = priorityPaths.concat(pathEnv.split(':'))

        // Check each possible path
        for (const dir of possiblePaths) {
            try {
                const mdformatPath = path.join(dir, 'mdformat');
                if (fs.existsSync(mdformatPath)) {
                    // Verify it's executable
                    const stats = fs.statSync(mdformatPath);
                    if (stats.isFile() && (stats.mode & 0o111)) {
                        this.mdformatAvailable = true;
                        this.mdformatPath = mdformatPath;
                        // Check for tight-lists plugin
                        await this.checkMdformatTightLists();
                        return;
                    }
                }
            } catch (error) {
                // Continue checking other paths
            }
        }

        this.mdformatAvailable = false;
        this.mdformatPath = null;
        this.mdformatTightListsAvailable = false;
    }

    private async checkMdformatTightLists(): Promise<void> {
        if (!this.mdformatPath) return;
        
        try {
            // Run mdformat --help to check for tight-lists plugin
            const result = await new Promise<string>((resolve, reject) => {
                const child = spawn(this.mdformatPath!, ['--help'], {
                    stdio: ['pipe', 'pipe', 'pipe']
                });
                
                let stdout = '';
                child.stdout.on('data', (data) => {
                    stdout += data.toString();
                });
                
                child.on('close', (code) => {
                    if (code === 0) {
                        resolve(stdout);
                    } else {
                        reject(new Error('Failed to check mdformat'));
                    }
                });
            });
            
            // Check if tight-lists extension is mentioned in help output
            this.mdformatTightListsAvailable = result.includes('tight_lists');
        } catch (error) {
            this.mdformatTightListsAvailable = false;
        }
    }

    private shouldAutoFormatFile(file: TFile): boolean {
        const filePath = file.path;
        
        // Check folder-specific rules
        let shouldFormat = this.settings.autoFormatEnabled;
        let maxDepth = -1;

        for (const [folderPath, rule] of Object.entries(this.settings.folderRules)) {
            // Check if file is directly in this folder or in a subfolder
            const isInFolder = filePath.startsWith(folderPath + '/') || 
                              filePath === folderPath ||
                              (filePath.startsWith(folderPath) && filePath.charAt(folderPath.length) === '/');
            
            if (isInFolder) {
                const depth = folderPath.split('/').length;
                if (depth > maxDepth) {
                    maxDepth = depth;
                    shouldFormat = rule.enabled;
                }
            }
        }

        return shouldFormat;
    }

    private scheduleAutoFormat(file: TFile) {
        // Clear existing timer for this file
        const existingTimer = this.formatDebounceTimers.get(file.path);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Schedule new format
        const timer = setTimeout(async () => {
            const shouldFormat = this.shouldAutoFormatFile(file);
            if (shouldFormat) {
                // Check if there's an active selection - if so, skip and reschedule
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (activeView && activeView.file === file && activeView.editor) {
                    if (this.hasActiveSelection(activeView.editor)) {
                        // Selection exists, reschedule for later
                        this.formatDebounceTimers.delete(file.path);
                        this.scheduleAutoFormat(file);
                        return;
                    }
                }
                await this.formatFile(file, true, activeView?.editor); // true = silent mode for auto-format
            }
            this.formatDebounceTimers.delete(file.path);
        }, this.settings.debounceDelay * 1000);

        this.formatDebounceTimers.set(file.path, timer);
    }

    async formatCurrentFile() {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView || !activeView.file) {
            new Notice('No active markdown file');
            return;
        }

        await this.formatFile(activeView.file, false, activeView.editor); // false = not silent, show notices
    }

    async formatFile(file: TFile, silent: boolean = false, editor?: Editor) {
        // Mark as currently formatting to prevent recursive calls
        this.currentlyFormatting.add(file.path);
        
        // Save cursor position if editor is provided
        let savedPosition: {line: number, ch: number} | undefined;
        if (editor) {
            savedPosition = this.saveCursorPosition(editor);
        }
        
        try {
            const content = await this.app.vault.read(file);
            
            // Ensure content ends with newline for proper formatting
            const contentToFormat = content.endsWith('\n') ? content : content + '\n';
            const formatted = await this.runFormatter(contentToFormat);
            
            // Preserve original newline ending
            const formattedResult = content.endsWith('\n') ? formatted : formatted.trimEnd();
            
            if (formattedResult !== content) {
                await this.app.vault.modify(file, formattedResult);
                
                // Restore cursor position if we saved it
                if (editor && savedPosition) {
                    // Small delay to ensure the editor has updated
                    setTimeout(() => {
                        if (savedPosition) {
                            this.restoreCursorPosition(editor, savedPosition);
                        }
                    }, 50);
                }
                
                if (!silent) {
                    new Notice('File formatted successfully');
                }
            } else {
                if (!silent) {
                    new Notice('No formatting changes needed');
                }
            }
        } catch (error) {
            console.error('Format error:', error);
            if (!silent) {
                new Notice(`Formatting failed: ${error.message}`);
            }
        } finally {
            // Always remove from formatting set
            this.currentlyFormatting.delete(file.path);
        }
    }

    async formatSelection(editor: Editor) {
        const selection = editor.getSelection();
        if (!selection) {
            new Notice('No text selected');
            return;
        }

        try {
            // Expand selection to full lines
            const selectionRange = {
                from: editor.getCursor('from'),
                to: editor.getCursor('to')
            };

            // Expand to start of first line and end of last line
            const expandedFrom = {
                line: selectionRange.from.line,
                ch: 0
            };
            const lastLine = editor.getLine(selectionRange.to.line);
            const expandedTo = {
                line: selectionRange.to.line,
                ch: lastLine.length
            };

            // Get the expanded selection text
            const expandedSelection = editor.getRange(expandedFrom, expandedTo);
            
            // Count leading newlines to preserve them
            const leadingNewlines = this.countLeadingNewlines(expandedSelection);
            
            // Strip leading newlines for formatting but preserve the content
            const contentWithoutLeading = expandedSelection.substring(leadingNewlines);
            
            // Ensure we have a newline at the end for proper formatting
            const contentToFormat = contentWithoutLeading.endsWith('\n') ? contentWithoutLeading : contentWithoutLeading + '\n';
            
            // Format the pre-processed selected text content 
            const formatted = await this.runFormatter(contentToFormat);
            
            // Remove trailing newline if we added one
            let formattedResult = contentWithoutLeading.endsWith('\n') ? formatted : formatted.trimEnd();
            
            // Restore leading newlines
            formattedResult = this.ensureLeadingNewlines(formattedResult, leadingNewlines);
            
            // Replace the expanded selection
            editor.replaceRange(formattedResult, expandedFrom, expandedTo);
            
            new Notice('Selection formatted successfully');
        } catch (error) {
            console.error('Format error:', error);
            new Notice(`Formatting failed: ${error.message}`);
        }
    }

    async runFormatter(content: string): Promise<string> {
        // If mdformat is requested and available, use it directly
        if (this.settings.useMdformat && this.mdformatAvailable && this.mdformatPath) {
            return this.runMdformat(content);
        }
        
        // Otherwise, use the included tight-lists script
        return this.runTightListsScript(content);
    }

    private async runMdformat(content: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const child = spawn(this.mdformatPath!, ['--no-validate', '-'], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('error', (error: any) => {
                reject(new Error(`Failed to run mdformat: ${error.message}`));
            });

            child.on('close', (code) => {
                if (code === 0) {
                    if (!stdout || stdout.trim() === '') {
                        reject(new Error('mdformat returned empty output'));
                    } else {
                        resolve(stdout);
                    }
                } else {
                    reject(new Error(`mdformat exited with code ${code}: ${stderr}`));
                }
            });

            // Write input to stdin
            child.stdin.write(content);
            child.stdin.end();
        });
    }

    private async runTightListsScript(content: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const child = spawn(this.scriptPath, [], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('error', (error: any) => {
                if (error.code === 'ENOENT') {
                    reject(new Error('Formatter script not found. Please ensure md-tight-lists.sh is in the plugin directory.'));
                } else if (error.code === 'EACCES') {
                    reject(new Error('Formatter script is not executable. Please check file permissions.'));
                } else {
                    reject(error);
                }
            });

            child.on('close', (code) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`Formatter exited with code ${code}: ${stderr}`));
                }
            });

            // Write input to stdin
            child.stdin.write(content);
            child.stdin.end();
        });
    }

    // Helper methods for cursor and selection management
    private hasActiveSelection(editor: Editor): boolean {
        const selection = editor.getSelection();
        return selection.length > 0;
    }

    private saveCursorPosition(editor: Editor): {line: number, ch: number} {
        return editor.getCursor();
    }

    private restoreCursorPosition(editor: Editor, pos: {line: number, ch: number}) {
        // Get document length to bound the position
        const lastLine = editor.lastLine();
        const boundedLine = Math.min(pos.line, lastLine);
        const lineLength = editor.getLine(boundedLine).length;
        const boundedCh = Math.min(pos.ch, lineLength);
        
        // Set the post-format bounded cursor position
        editor.setCursor({line: boundedLine, ch: boundedCh});

        // Clear any selection
        editor.setSelection({line: boundedLine, ch: boundedCh}, {line: boundedLine, ch: boundedCh});
    }

    private countLeadingNewlines(text: string): number {
        const match = text.match(/^(\n*)/);
        return match ? match[1].length : 0;
    }

    private ensureLeadingNewlines(text: string, count: number): string {
        const currentCount = this.countLeadingNewlines(text);
        if (currentCount < count) {
            return '\n'.repeat(count - currentCount) + text;
        }
        return text;
    }

    private updateStatusBar() {
        // Clear existing content
        this.statusBarItem.empty();
        
        // Get current file
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView || !activeView.file) {
            this.statusBarItem.hide();
            return;
        }
        
        const file = activeView.file;
        const isAutoFormatEnabled = this.shouldAutoFormatFile(file);
        
        // Determine which type of auto-format is active
        let statusText = '';
        let statusClass = '';
        
        if (!isAutoFormatEnabled) {
            // Auto-format is disabled
            statusText = '◎ manual';
            statusClass = 'tight-lists-status-disabled';
        } else {
            // Check if it's folder-based or global
            const isFolderBased = this.isFolderBasedAutoFormat(file);
            if (isFolderBased) {
                statusText = '⦿ dirfmt';
                statusClass = 'tight-lists-status-folder';
            } else {
                statusText = '◉ autofmt';
                statusClass = 'tight-lists-status-global';
            }
        }
        
        // Create status bar element
        const statusEl = this.statusBarItem.createEl('span', {
            text: statusText,
            cls: `tight-lists-status ${statusClass}`
        });
        
        // Add hover text
        statusEl.setAttr('title', 
            isAutoFormatEnabled 
                ? `Auto-format enabled${this.isFolderBasedAutoFormat(file) ? ' (folder rule)' : ' (global)'}`
                : 'Auto-format disabled'
        );
        
        this.statusBarItem.show();
    }

    private isFolderBasedAutoFormat(file: TFile): boolean {
        const filePath = file.path;
        
        // Check if any folder rule applies to this file
        for (const [folderPath, rule] of Object.entries(this.settings.folderRules)) {
            const isInFolder = filePath.startsWith(folderPath + '/') || 
                              filePath === folderPath ||
                              (filePath.startsWith(folderPath) && filePath.charAt(folderPath.length) === '/');
            
            if (isInFolder && rule.enabled) {
                return true;
            }
        }
        
        return false;
    }

    private async triggerEventBasedFormat(file: TFile, trigger: string) {
        // Check if file should be auto-formatted
        if (!this.shouldAutoFormatFile(file)) {
            return;
        }
        
        // Check if event-based formatting is enabled
        if (!this.settings.eventBasedFormatting) {
            return;
        }
        
        // Avoid formatting if already in progress
        if (this.currentlyFormatting.has(file.path)) {
            return;
        }
        
        // Get the editor for cursor preservation (if file is currently open)
        let editor: Editor | undefined;
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView && activeView.file === file) {
            editor = activeView.editor;
        }
        
        // Format the file
        await this.formatFile(file, true, editor);  // true = silent mode for auto-format
    }
}

class TightListsSettingTab extends PluginSettingTab {
    plugin: TightListsFormatterPlugin;

    constructor(app: App, plugin: TightListsFormatterPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h1', { text: 'Tight Lists Formatter Settings' });

        // mdformat toggle section
        containerEl.createEl('h2', { text: 'Global Formatting Options' });

        // Auto-format toggle
        new Setting(containerEl)
            .setName('Enable global automatic formatting')
            .setDesc('When enabled, the note file in the active editor pane will be automatically formatted using the formatting modes selected below.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoFormatEnabled)
                .onChange(async (value) => {
                    if (value && !this.plugin.settings.enableDelayBasedFormatting && !this.plugin.settings.eventBasedFormatting) {
                        // Auto-enable delay-based formatting if no modes are enabled
                        this.plugin.settings.enableDelayBasedFormatting = true;
                        new Notice('Delay-based formatting has been enabled');
                    }
                    this.plugin.settings.autoFormatEnabled = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        // mdformat section
        if (this.plugin.mdformatAvailable) {
            // Show toggle when mdformat is available
            const mdformatSetting = new Setting(containerEl)
                .setName('Use mdformat for comprehensive Markdown formatting')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.useMdformat)
                    .onChange(async (value) => {
                        this.plugin.settings.useMdformat = value;
                        await this.plugin.saveSettings();
                    }));

            if (this.plugin.mdformatTightListsAvailable) {
                mdformatSetting.setDesc('✅ mdformat with tight-lists plugin available. When enabled, applies comprehensive CommonMark spec with tight-lists formatting.');
            } else {
                mdformatSetting.setDesc('⚠️ mdformat available but tight-lists plugin not found. Install with: pipx inject mdformat mdformat-tight-lists');
            }
        } else {
            // Show installation instructions when mdformat is not available
            new Setting(containerEl)
                .setName('Enhanced formatting')
                .setDesc('Install mdformat for enhanced formatting:\n\npipx install mdformat\npipx inject mdformat mdformat-gfm mdformat-frontmatter mdformat-footnote mdformat-gfm-alerts mdformat-tight-lists');
        }

        // Auto-format settings section
        containerEl.createEl('h2', { text: 'Auto-Formatting Modes' });

        // Show info message when auto-formatting is enabled
        if (this.plugin.settings.autoFormatEnabled) {
            const infoEl = containerEl.createEl('p', { 
                text: 'Note: At least one formatting mode must remain enabled while global auto-formatting is active.',
                cls: 'setting-item-description'
            });
            infoEl.style.marginBottom = '20px';
        }

        // Show delay-based options
        new Setting(containerEl)
            .setName('Delay-based auto-formatting mode')
            .setDesc('Enable this mode to format the current note file at a fixed interval since your last edit')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableDelayBasedFormatting)
                .onChange(async (value) => {
                    // If trying to disable and this is the last enabled mode
                    if (!value && this.plugin.settings.autoFormatEnabled && !this.plugin.settings.eventBasedFormatting) {
                        new Notice('At least one formatting mode must be enabled when auto-formatting is active');
                        toggle.setValue(true);
                        return;
                    }
                    this.plugin.settings.enableDelayBasedFormatting = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (this.plugin.settings.enableDelayBasedFormatting) {
            // Debounce delay
            new Setting(containerEl)
                .setName(`Auto-format delay (${this.plugin.settings.debounceDelay} seconds since last edit)`)
                .addSlider(slider => slider
                    .setLimits(1, 10, 1)
                    .setValue(this.plugin.settings.debounceDelay)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.debounceDelay = value;
                        await this.plugin.saveSettings();
                        this.display();
                    }));
        }

        new Setting(containerEl)
            .setName('Event-based auto-formatting mode')
            .setDesc('Enable this mode to format the current note file after certain editor actions selected below')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.eventBasedFormatting)
                .onChange(async (value) => {
                    // If trying to disable and this is the last enabled mode
                    if (!value && this.plugin.settings.autoFormatEnabled && !this.plugin.settings.enableDelayBasedFormatting) {
                        new Notice('At least one formatting mode must be enabled when auto-formatting is active');
                        toggle.setValue(true);
                        return;
                    }
                    this.plugin.settings.eventBasedFormatting = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (this.plugin.settings.eventBasedFormatting) {
            // Show event trigger options
            new Setting(containerEl)
                .setName('Format when a note file is opened')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.formatOnFileOpen)
                    .onChange(async (value) => {
                        this.plugin.settings.formatOnFileOpen = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('Format when the note pane gains focus')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.formatOnFocusGain)
                    .onChange(async (value) => {
                        this.plugin.settings.formatOnFocusGain = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('Format when the note pane loses focus')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.formatOnFocusLoss)
                    .onChange(async (value) => {
                        this.plugin.settings.formatOnFocusLoss = value;
                        await this.plugin.saveSettings();
                    }));
        }

        // Folder rules section
        containerEl.createEl('h2', { text: 'Folder-Specific Auto-Formatting' });

        // Add new folder rule button
        new Setting(containerEl)
            .setName('Add folder rule')
            .setDesc('Add a new folder-specific rule for auto-formatting note files')
            .addButton(button => button
                .setButtonText('Add rule')
                .onClick(() => {
                    this.addFolderRule();
                }));

        // Display existing folder rules
        const rulesContainer = containerEl.createDiv('folder-rules-container');
        this.displayFolderRules(rulesContainer);
        containerEl.createEl('p', { 
            text: 'Note: Adding a folder rule enables auto-formatting for all notes in that folder even if global auto-formatting is disabled.',
            cls: 'mod-warning'
        });
    }

    displayFolderRules(container: HTMLElement) {
        container.empty();

        for (const [folderPath, rule] of Object.entries(this.plugin.settings.folderRules)) {
            // Create a container for this folder rule
            const ruleContainer = container.createDiv('folder-rule-container');
            ruleContainer.style.border = '1px solid var(--background-modifier-border)';
            ruleContainer.style.borderRadius = '6px';
            ruleContainer.style.padding = '12px';
            ruleContainer.style.marginBottom = '12px';
            ruleContainer.style.backgroundColor = 'var(--background-secondary)';

            // Folder rule with auto-format toggle and remove button
            new Setting(ruleContainer)
                .setName(`${folderPath}/`)
                .addToggle(toggle => toggle
                    .setValue(rule.enabled)
                    .onChange(async (value) => {
                        this.plugin.settings.folderRules[folderPath].enabled = value;
                        await this.plugin.saveSettings();
                    }))
                .addButton(button => button
                    .setButtonText('Remove rule')
                    .setWarning()
                    .onClick(async () => {
                        delete this.plugin.settings.folderRules[folderPath];
                        await this.plugin.saveSettings();
                        this.display();
                    }));
        }
    }

    private validateFolderPath(folderPath: string): boolean {
        // Check if path exists in vault as a folder
        const abstractFile = this.app.vault.getAbstractFileByPath(folderPath);
        return abstractFile instanceof TFolder;
    }

    async addFolderRule() {
        const modal = new FolderRuleModal(this.app, async (folderPath) => {
            if (!folderPath) {
                return;
            }

            // Validate folder path
            if (!this.validateFolderPath(folderPath)) {
                new Notice(`Folder not found: "${folderPath}". Please enter a valid folder path.`);
                return;
            }

            // Check if rule already exists
            if (this.plugin.settings.folderRules[folderPath]) {
                new Notice(`Folder rule for "${folderPath}" already exists.`);
                return;
            }

            // Add the rule
            this.plugin.settings.folderRules[folderPath] = {
                enabled: true
            };
            await this.plugin.saveSettings();
            this.display();
            new Notice(`Added folder rule for "${folderPath}"`);
        });
        modal.open();
    }
}

class FolderRuleModal extends Modal {
    constructor(app: App, private onSubmit: (folderPath: string) => void) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Add folder rule' });

        // Add explanation
        const explanationEl = contentEl.createEl('p', { cls: 'setting-item-description' });
        explanationEl.innerHTML = `
            Enter the path to a folder in your vault. This will enable auto-formatting (using the current delay and/or event settings) for all files contained in the folder or any of its subfolders. 
            <br><br>
            <strong>Examples:</strong>
            <br>• <code>Notes</code> - Top-level folder
            <br>• <code>Notes/Daily</code> - Subfolder
            <br>• <code>Projects/Work/Documentation</code> - Nested folder
        `;

        let textInput: HTMLInputElement;
        new Setting(contentEl)
            .setName('Folder path')
            .setDesc('Enter the exact folder path as it appears in your vault')
            .addText(text => {
                textInput = text.inputEl;
                text.setPlaceholder('e.g., Notes/Daily');
                text.inputEl.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        this.onSubmit(text.getValue().trim());
                        this.close();
                    }
                });
                // Focus the input
                setTimeout(() => text.inputEl.focus(), 100);
            });

        new Setting(contentEl)
            .addButton(button => button
                .setButtonText('Cancel')
                .onClick(() => {
                    this.close();
                }))
            .addButton(button => button
                .setButtonText('Add')
                .setCta()
                .onClick(() => {
                    this.onSubmit(textInput.value.trim());
                    this.close();
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
