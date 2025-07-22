import { App, Editor, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile, Modal } from 'obsidian';
import { spawn } from 'child_process';
import * as path from 'path';

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

	async onload() {
		await this.loadSettings();

		// Set the path to the shell script
		this.scriptPath = path.join((this.app.vault.adapter as any).basePath, '.obsidian', 'plugins', this.manifest.id, 'md-tight-lists.sh');

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

		// Add command to format current file with mdformat
		this.addCommand({
			id: 'format-current-file-with-mdformat',
			name: 'Format current file (with mdformat)',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.formatCurrentFile(true);
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
				new Notice(`Auto-format ${this.settings.autoFormatEnabled ? 'enabled' : 'disabled'}`);
			}
		});

		// Add settings tab
		this.addSettingTab(new TightListsSettingTab(this.app, this));

		// Register editor change event for auto-formatting
		this.registerEvent(
			this.app.workspace.on('editor-change', (editor: Editor, view: MarkdownView) => {
				if (this.settings.autoFormatEnabled && view.file) {
					this.scheduleAutoFormat(view.file);
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

	private shouldAutoFormatFile(file: TFile): { enabled: boolean; useMdformat: boolean } {
		const filePath = file.path;
		
		// Check folder-specific rules
		let mostSpecificRule = { enabled: this.settings.autoFormatEnabled, useMdformat: this.settings.useMdformat };
		let maxDepth = -1;

		for (const [folderPath, rule] of Object.entries(this.settings.folderRules)) {
			if (filePath.startsWith(folderPath)) {
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
				await this.formatFile(file, rule.useMdformat);
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
		await this.formatFile(activeView.file, useMdformat);
	}

	async formatFile(file: TFile, useMdformat: boolean) {
		try {
			const content = await this.app.vault.read(file);
			const formatted = await this.runFormatter(content, useMdformat);
			
			if (formatted !== content) {
				await this.app.vault.modify(file, formatted);
				new Notice('File formatted successfully');
			} else {
				new Notice('No formatting changes needed');
			}
		} catch (error) {
			console.error('Format error:', error);
			new Notice(`Formatting failed: ${error.message}`);
		}
	}

	async formatSelection(editor: Editor) {
		const selection = editor.getSelection();
		if (!selection) {
			new Notice('No text selected');
			return;
		}

		try {
			const formatted = await this.runFormatter(selection, this.settings.useMdformat);
			editor.replaceSelection(formatted);
			new Notice('Selection formatted successfully');
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

			const child = spawn(this.scriptPath, args, {
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
		new Setting(containerEl)
			.setName('Use mdformat')
			.setDesc('Additionally format with mdformat (CommonMark formatter) if available')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.useMdformat)
				.onChange(async (value) => {
					this.plugin.settings.useMdformat = value;
					await this.plugin.saveSettings();
				}));

		// Folder rules section
		containerEl.createEl('h3', { text: 'Folder-specific rules' });
		containerEl.createEl('p', { 
			text: 'Configure auto-format settings for specific folders. More specific paths take precedence.',
			cls: 'setting-item-description'
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
			const ruleSetting = new Setting(container)
				.setName(folderPath)
				.addToggle(toggle => toggle
					.setValue(rule.enabled)
					.onChange(async (value) => {
						this.plugin.settings.folderRules[folderPath].enabled = value;
						await this.plugin.saveSettings();
					}))
				.addToggle(toggle => toggle
					.setValue(rule.useMdformat ?? this.plugin.settings.useMdformat)
					.setTooltip('Use mdformat')
					.onChange(async (value) => {
						this.plugin.settings.folderRules[folderPath].useMdformat = value;
						await this.plugin.saveSettings();
					}))
				.addButton(button => button
					.setButtonText('Remove')
					.setWarning()
					.onClick(async () => {
						delete this.plugin.settings.folderRules[folderPath];
						await this.plugin.saveSettings();
						this.display();
					}));
		}
	}

	async addFolderRule() {
		const modal = new FolderRuleModal(this.app, async (folderPath) => {
			if (folderPath && !this.plugin.settings.folderRules[folderPath]) {
				this.plugin.settings.folderRules[folderPath] = {
					enabled: true,
					useMdformat: this.plugin.settings.useMdformat
				};
				await this.plugin.saveSettings();
				this.display();
			}
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

		new Setting(contentEl)
			.setName('Folder path')
			.setDesc('Enter the folder path (e.g., "Notes/Daily")')
			.addText(text => {
				text.setPlaceholder('Folder path');
				text.inputEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						this.onSubmit(text.getValue());
						this.close();
					}
				});
			});

		new Setting(contentEl)
			.addButton(button => button
				.setButtonText('Add')
				.setCta()
				.onClick(() => {
					const input = contentEl.querySelector('input');
					if (input) {
						this.onSubmit(input.value);
						this.close();
					}
				}));
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}