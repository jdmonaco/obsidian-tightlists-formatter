import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, TFolder, Modal } from 'obsidian';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

interface TightListsSettings {
	autoFormatEnabled: boolean;
	debounceDelay: number;
	useMdformat: boolean;
	folderRules: Record<string, { enabled: boolean; useMdformat?: boolean }>;
}

const DEFAULT_SETTINGS: TightListsSettings = {
	autoFormatEnabled: false,
	debounceDelay: 5,
	useMdformat: false,
	folderRules: {}
};

export default class TightListsFormatterPlugin extends Plugin {
	settings: TightListsSettings;
	private formatDebounceTimers: Map<string, NodeJS.Timeout> = new Map();
	private scriptPath: string;
	public mdformatAvailable: boolean = false;
	public mdformatPath: string | null = null;
	private currentlyFormatting: Set<string> = new Set();

	async onload() {
		await this.loadSettings();

		// Set the path to the shell script
		// Simple path resolution - the script is in the same directory as the plugin
		const adapter = this.app.vault.adapter as any;
		const pluginDir = path.join(adapter.basePath, '.obsidian', 'plugins', this.manifest.id);
		this.scriptPath = path.join(pluginDir, 'md-tight-lists.sh');
		
		// Check for mdformat availability
		await this.checkMdformatAvailability();

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

		// Add command to format current file with mdformat (only if available)
		if (this.mdformatAvailable) {
			this.addCommand({
				id: 'format-current-file-with-mdformat',
				name: 'Format current file (with mdformat)',
				editorCallback: (editor: Editor, view: MarkdownView) => {
					this.formatCurrentFile(true);
				}
			});
		}

		// Add command to format selection
		this.addCommand({
			id: 'format-selection',
			name: 'Format selected text',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.formatSelection(editor);
			}
		});

		// Add command to format selection with mdformat (only if available)
		if (this.mdformatAvailable) {
			this.addCommand({
				id: 'format-selection-with-mdformat',
				name: 'Format selected text (with mdformat)',
				editorCallback: (editor: Editor, view: MarkdownView) => {
					this.formatSelection(editor, true);
				}
			});
		}

		// Add command to toggle auto-format
		this.addCommand({
			id: 'toggle-auto-format',
			name: 'Toggle auto-format',
			callback: () => {
				this.settings.autoFormatEnabled = !this.settings.autoFormatEnabled;
				this.saveSettings();
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
					// Only add mdformat option if available
					if (this.mdformatAvailable) {
						menu.addItem((item) => {
							item
								.setTitle('Format Tight Lists (mdformat)')
								.setIcon('list')
								.onClick(() => {
									this.formatSelection(editor, true);
								});
						});
					}
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
					
					const rule = this.shouldAutoFormatFile(view.file);
					
					if (rule.enabled) {
						this.scheduleAutoFormat(view.file);
					}
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
	}

	private async checkMdformatAvailability(): Promise<void> {
		// Priority order for checking mdformat locations
		const possiblePaths = [
			// pipx default installation
			path.join(process.env.HOME || '', '.local', 'bin', 'mdformat'),
			// Homebrew installation
			'/opt/homebrew/bin/mdformat',
			// System installation
			'/usr/local/bin/mdformat',
			// Legacy locations
			'/usr/bin/mdformat'
		];

		// Check each possible path
		for (const mdformatPath of possiblePaths) {
			try {
				if (fs.existsSync(mdformatPath)) {
					// Verify it's executable
					const stats = fs.statSync(mdformatPath);
					if (stats.isFile() && (stats.mode & 0o111)) {
						this.mdformatAvailable = true;
						this.mdformatPath = mdformatPath;
						return;
					}
				}
			} catch (error) {
				// Continue checking other paths
			}
		}

		// If not found in standard locations, try PATH
		try {
			const pathEnv = process.env.PATH || '';
			const pathDirs = pathEnv.split(':');
			
			for (const dir of pathDirs) {
				const mdformatPath = path.join(dir, 'mdformat');
				if (fs.existsSync(mdformatPath)) {
					const stats = fs.statSync(mdformatPath);
					if (stats.isFile() && (stats.mode & 0o111)) {
						this.mdformatAvailable = true;
						this.mdformatPath = mdformatPath;
						return;
					}
				}
			}
		} catch (error) {
			// PATH search failed
		}

		this.mdformatAvailable = false;
		this.mdformatPath = null;
	}

	private shouldAutoFormatFile(file: TFile): { enabled: boolean; useMdformat: boolean } {
		const filePath = file.path;
		
		// Check folder-specific rules
		let mostSpecificRule = { enabled: this.settings.autoFormatEnabled, useMdformat: this.settings.useMdformat };
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
					mostSpecificRule = {
						enabled: rule.enabled,
						useMdformat: rule.useMdformat !== undefined ? rule.useMdformat : this.settings.useMdformat
					};
				}
			}
		}

		return mostSpecificRule;
	}

	private scheduleAutoFormat(file: TFile) {
		// Clear existing timer for this file
		const existingTimer = this.formatDebounceTimers.get(file.path);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		// Schedule new format
		const timer = setTimeout(async () => {
			const rule = this.shouldAutoFormatFile(file);
			if (rule.enabled) {
				await this.formatFile(file, rule.useMdformat, true); // true = silent mode for auto-format
			}
			this.formatDebounceTimers.delete(file.path);
		}, this.settings.debounceDelay * 1000);

		this.formatDebounceTimers.set(file.path, timer);
	}

	async formatCurrentFile(forceUseMdformat = false) {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView || !activeView.file) {
			new Notice('No active markdown file');
			return;
		}

		const useMdformat = forceUseMdformat || this.settings.useMdformat;
		await this.formatFile(activeView.file, useMdformat, false); // false = not silent, show notices
	}

	async formatFile(file: TFile, useMdformat: boolean, silent: boolean = false) {
		// Mark as currently formatting to prevent recursive calls
		this.currentlyFormatting.add(file.path);
		
		try {
			const content = await this.app.vault.read(file);
			const formatted = await this.runFormatter(content, useMdformat);
			
			if (formatted !== content) {
				await this.app.vault.modify(file, formatted);
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

	async formatSelection(editor: Editor, forceUseMdformat = false) {
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
			
			const useMdformat = forceUseMdformat || this.settings.useMdformat;
			
			const formatted = await this.runFormatter(expandedSelection, useMdformat);
			
			// Replace the expanded selection
			editor.replaceRange(formatted, expandedFrom, expandedTo);
			
			new Notice(`Selection formatted successfully ${useMdformat ? '(with mdformat)' : ''}`);
		} catch (error) {
			console.error('Format error:', error);
			new Notice(`Formatting failed: ${error.message}`);
		}
	}

	async runFormatter(content: string, useMdformat: boolean): Promise<string> {
		return new Promise((resolve, reject) => {
			const args = [];
			if (useMdformat) {
				args.push('-f');
			}

			// Build enhanced environment with proper PATH
			const env = { ...process.env };
			
			if (useMdformat && this.mdformatPath) {
				// If we have a specific mdformat path, ensure its directory is in PATH
				const mdformatDir = path.dirname(this.mdformatPath);
				const currentPath = env.PATH || '';
				if (!currentPath.includes(mdformatDir)) {
					env.PATH = `${mdformatDir}:${currentPath}`;
				}
			}

			const child = spawn(this.scriptPath, args, {
				stdio: ['pipe', 'pipe', 'pipe'],
				env
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

		containerEl.createEl('h2', { text: 'Tight Lists Formatter Settings' });

		// Auto-format toggle
		new Setting(containerEl)
			.setName('Enable auto-format')
			.setDesc('Automatically format files when editing')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoFormatEnabled)
				.onChange(async (value) => {
					this.plugin.settings.autoFormatEnabled = value;
					await this.plugin.saveSettings();
				}));

		// Debounce delay
		new Setting(containerEl)
			.setName('Auto-format delay')
			.setDesc('Seconds to wait after last edit before formatting (1-30)')
			.addSlider(slider => slider
				.setLimits(1, 30, 1)
				.setValue(this.plugin.settings.debounceDelay)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.debounceDelay = value;
					await this.plugin.saveSettings();
				}));

		// Use mdformat
		const mdformatSetting = new Setting(containerEl)
			.setName('Use mdformat')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useMdformat)
				.setDisabled(!this.plugin.mdformatAvailable)
				.onChange(async (value) => {
					this.plugin.settings.useMdformat = value;
					await this.plugin.saveSettings();
				}));

		if (this.plugin.mdformatAvailable) {
			mdformatSetting.setDesc(`✅ mdformat available at: ${this.plugin.mdformatPath}\nAdditionally format with mdformat (GitHub-flavored Markdown)`);
		} else {
			mdformatSetting.setDesc(`❌ mdformat not found\nInstall with: pipx install mdformat && pipx inject mdformat mdformat-gfm mdformat-frontmatter mdformat-footnote mdformat-gfm-alerts`);
		}

		// Folder rules section
		containerEl.createEl('h3', { text: 'Folder-specific rules' });
		
		const descEl = containerEl.createEl('div', { cls: 'setting-item-description' });
		descEl.createEl('p', { 
			text: `Configure automatic formatting for specific folders. When enabled, files in these folders will be auto-formatted after the global delay (currently ${this.plugin.settings.debounceDelay} seconds). Folder rules override global auto-format settings, and more specific paths take precedence over less specific ones.`
		});
		descEl.createEl('p', { 
			text: 'Note: Adding a folder rule enables automatic formatting for that folder, even if global auto-format is disabled.',
			cls: 'mod-warning'
		});

		// Add new folder rule button
		new Setting(containerEl)
			.setName('Add folder rule')
			.setDesc('Add a new folder-specific formatting rule')
			.addButton(button => button
				.setButtonText('Add rule')
				.onClick(() => {
					this.addFolderRule();
				}));

		// Display existing folder rules
		const rulesContainer = containerEl.createDiv('folder-rules-container');
		this.displayFolderRules(rulesContainer);
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

			// Folder path header
			const headerEl = ruleContainer.createEl('h4', { 
				text: folderPath,
				cls: 'setting-item-name'
			});
			headerEl.style.marginTop = '0';
			headerEl.style.marginBottom = '8px';

			// Auto-format toggle
			new Setting(ruleContainer)
				.setName('Auto-format')
				.setDesc('Enable automatic formatting for files in this folder')
				.addToggle(toggle => toggle
					.setValue(rule.enabled)
					.onChange(async (value) => {
						this.plugin.settings.folderRules[folderPath].enabled = value;
						await this.plugin.saveSettings();
					}));

			// mdformat toggle (only if mdformat is available)
			if (this.plugin.mdformatAvailable) {
				new Setting(ruleContainer)
					.setName('Use mdformat')
					.setDesc('Apply mdformat in addition to tight lists formatting')
					.addToggle(toggle => toggle
						.setValue(rule.useMdformat ?? this.plugin.settings.useMdformat)
						.onChange(async (value) => {
							this.plugin.settings.folderRules[folderPath].useMdformat = value;
							await this.plugin.saveSettings();
						}));
			} else {
				// Show mdformat unavailable message
				const mdformatSetting = new Setting(ruleContainer)
					.setName('Use mdformat')
					.setDesc('❌ mdformat not available - install mdformat to enable this option');
				mdformatSetting.settingEl.style.opacity = '0.6';
			}

			// Remove button
			new Setting(ruleContainer)
				.addButton(button => button
					.setButtonText('Remove folder rule')
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
				enabled: true,
				useMdformat: this.plugin.settings.useMdformat
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
			Enter the path to a folder in your vault. This will enable automatic formatting for all files in that folder.
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