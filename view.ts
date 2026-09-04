import { ItemView, WorkspaceLeaf, Menu, Notice, TFile } from "obsidian";
import type DigitalpotPlugin from "./main";
import { BlockStyle, BlockType, ContentBlock, HistoryEntry, UploadedKeyFile, genId } from "./data";
import { ConfirmEditModal } from "./modals";

export const DIGITALPOT_VIEW_TYPE = "digitalpot-view";

export class DigitalpotView extends ItemView {
	plugin: DigitalpotPlugin;
	file: TFile | null = null;
	private historyVisible = false;
	private editingBlockId: string | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: DigitalpotPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return DIGITALPOT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.file ? this.file.basename : "Digitalpot";
	}

	getIcon(): string {
		return "lock";
	}

	async setFile(file: TFile): Promise<void> {
		this.file = file;
		await this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	// Re-render fully; called after any state mutation. Simple and safe for a
	// note-scale amount of data.
	async render(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("digitalpot-root");

		if (this.plugin.isBlurred()) {
			root.addClass("digitalpot-blurred");
		} else {
			root.removeClass("digitalpot-blurred");
		}

		const toolbar = root.createDiv({ cls: "digitalpot-toolbar" });
		const dropdownBtn = toolbar.createEl("button", {
			text: "Digitalpot ▾",
			cls: "digitalpot-dropdown-btn",
		});
		dropdownBtn.addEventListener("click", (evt) => this.openMenu(evt));

		const headBadge = toolbar.createSpan({ cls: "digitalpot-head-badge" });
		if (this.plugin.settings.securityEnabled) {
			headBadge.setText(this.plugin.data?.headActive ? "Head: ON" : "");
		}

		const body = root.createDiv({ cls: "digitalpot-body" });
		if (!this.plugin.data) {
			body.createEl("p", { text: "Locked. Use the Digitalpot ribbon icon to unlock." });
			return;
		}

		for (const block of this.plugin.data.blocks) {
			this.renderBlock(body, block);
		}

		const addRow = body.createDiv({ cls: "digitalpot-add-row" });
		const input = addRow.createEl("textarea", {
			placeholder: this.plugin.data.headActive
				? "Typing in Head style..."
				: "Write or paste text, then choose a type below...",
			cls: "digitalpot-input",
		});
		const typeSelect = addRow.createEl("select", { cls: "digitalpot-type-select" });
		(["head", "secret", "description"] as BlockType[]).forEach((t) => {
			const opt = typeSelect.createEl("option", { text: t, value: t });
			if (this.plugin.data!.headActive && t === "head") opt.selected = true;
		});
		const addBtn = addRow.createEl("button", { text: "Add" });
		addBtn.addEventListener("click", async () => {
			const text = input.value.trim();
			if (!text) return;
			const type = this.plugin.data!.headActive ? "head" : (typeSelect.value as BlockType);
			await this.addBlock(type, text);
			input.value = "";
		});

		if (this.historyVisible) {
			this.renderHistory(root);
		}
	}

	private renderBlock(parent: HTMLElement, block: ContentBlock): void {
		const el = parent.createDiv({ cls: `digitalpot-block digitalpot-block-${block.type}` });
		const textEl = el.createDiv({ cls: "digitalpot-block-text" });
		textEl.setText(block.text);
		textEl.style.fontSize = `${block.style.fontSizePx}px`;
		textEl.style.color = block.style.color;
		if (block.style.fontFamily && block.style.fontFamily !== "inherit") {
			textEl.style.fontFamily = block.style.fontFamily;
		}

		const controls = el.createDiv({ cls: "digitalpot-block-controls" });

		if (block.type === "secret") {
			// double-tap (or double-click on desktop) to copy
			let lastTap = 0;
			textEl.addEventListener("click", () => {
				const now = Date.now();
				if (now - lastTap < 350) {
					this.copySecret(block);
				}
				lastTap = now;
			});
			const copyBtn = controls.createEl("button", { text: "Copy" });
			copyBtn.addEventListener("click", () => this.copySecret(block));
		}

		const editBtn = controls.createEl("button", { text: "Edit" });
		editBtn.addEventListener("click", () => {
			if (block.type === "secret") {
				new ConfirmEditModal(this.app, () => this.beginEdit(el, block)).open();
			} else {
				this.beginEdit(el, block);
			}
		});

		const deleteBtn = controls.createEl("button", { text: "Delete", cls: "digitalpot-danger" });
		deleteBtn.addEventListener("click", () => this.deleteBlock(block));
	}

	private beginEdit(blockEl: HTMLElement, block: ContentBlock): void {
		blockEl.empty();
		const textarea = blockEl.createEl("textarea", { cls: "digitalpot-edit-textarea" });
		textarea.value = block.text;
		const saveBtn = blockEl.createEl("button", { text: "Save" });
		saveBtn.addEventListener("click", async () => {
			block.text = textarea.value;
			block.updatedAt = Date.now();
			await this.plugin.logHistory("edited", block.id, block.type);
			await this.plugin.persist();
			await this.render();
		});
	}

	private async copySecret(block: ContentBlock): Promise<void> {
		await navigator.clipboard.writeText(block.text);
		new Notice("Copied to clipboard.");
		await this.plugin.logHistory("copied", block.id, block.type);
		await this.plugin.persist();
	}

	private async deleteBlock(block: ContentBlock): Promise<void> {
		if (!this.plugin.data) return;
		this.plugin.data.blocks = this.plugin.data.blocks.filter((b) => b.id !== block.id);
		await this.plugin.logHistory("deleted", block.id, block.type);
		await this.plugin.persist();
		await this.render();
	}

	private async addBlock(type: BlockType, text: string): Promise<void> {
		if (!this.plugin.data) return;
		const style: BlockStyle =
			type === "head" && this.plugin.data.headStyleWhenActive
				? this.plugin.data.headStyleWhenActive
				: this.plugin.settings.defaultStyles[type];
		const block: ContentBlock = {
			id: genId(),
			type,
			text,
			style: { ...style },
			createdAt: Date.now(),
			updatedAt: Date.now(),
		};
		this.plugin.data.blocks.push(block);
		await this.plugin.logHistory("created", block.id, block.type);
		await this.plugin.persist();
		await this.render();
	}

	private renderHistory(root: HTMLElement): void {
		const panel = root.createDiv({ cls: "digitalpot-history-panel" });
		panel.createEl("h4", { text: "History" });
		if (!this.plugin.data || this.plugin.data.history.length === 0) {
			panel.createEl("p", { text: "No activity yet." });
			return;
		}
		const list = panel.createEl("ul");
		[...this.plugin.data.history]
			.sort((a, b) => b.startedAt - a.startedAt)
			.forEach((h: HistoryEntry) => {
				const started = new Date(h.startedAt).toLocaleString();
				const finished = new Date(h.finishedAt).toLocaleTimeString();
				list.createEl("li", {
					text: `${h.action}${h.label ? ` (${h.label})` : ""} — started ${started}, finished ${finished}`,
				});
			});
	}

	private openMenu(evt: MouseEvent): void {
		const menu = new Menu();

		menu.addItem((item) =>
			item.setTitle("1. Format").setIcon("paintbrush").onClick(() => {
				this.plugin.openFormatMenu();
			})
		);

		menu.addItem((item) =>
			item
				.setTitle(`2. Head (${this.plugin.data?.headActive ? "ON" : "OFF"})`)
				.setIcon("heading")
				.onClick(async () => {
					if (!this.plugin.data) return;
					this.plugin.data.headActive = !this.plugin.data.headActive;
					this.plugin.data.headStyleWhenActive = this.plugin.data.headActive
						? { ...this.plugin.settings.defaultStyles.head }
						: null;
					await this.plugin.persist();
					await this.render();
				})
		);

		menu.addItem((item) =>
			item.setTitle("3. Secret").setIcon("key").onClick(() => {
				this.focusAddRowWithType("secret");
			})
		);

		menu.addItem((item) =>
			item.setTitle("4. Description").setIcon("align-left").onClick(() => {
				this.focusAddRowWithType("description");
			})
		);

		menu.addItem((item) =>
			item.setTitle("5. Upload key (JSON)").setIcon("upload").onClick(() => {
				this.uploadKeyFile();
			})
		);

		menu.addItem((item) =>
			item
				.setTitle(`6. History (${this.plugin.settings.historyEnabled ? "ON" : "OFF"})`)
				.setIcon("history")
				.onClick(() => {
					this.historyVisible = !this.historyVisible;
					this.render();
				})
		);

		menu.addItem((item) =>
			item.setTitle("7. Change password / security").setIcon("shield").onClick(() => {
				this.plugin.openChangePasswordModal();
			})
		);

		menu.showAtMouseEvent(evt);
	}

	private focusAddRowWithType(type: BlockType): void {
		const select = this.contentEl.querySelector(".digitalpot-type-select") as HTMLSelectElement | null;
		const input = this.contentEl.querySelector(".digitalpot-input") as HTMLTextAreaElement | null;
		if (select) select.value = type;
		if (input) input.focus();
	}

	private uploadKeyFile(): void {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "application/json,.json";
		input.addEventListener("change", async () => {
			const file = input.files?.[0];
			if (!file || !this.plugin.data) return;
			const text = await file.text();
			try {
				JSON.parse(text); // validate
			} catch {
				new Notice("That file isn't valid JSON.");
				return;
			}
			const entry: UploadedKeyFile = {
				id: genId(),
				filename: file.name,
				json: text,
				uploadedAt: Date.now(),
			};
			this.plugin.data.keyFiles.push(entry);
			await this.plugin.logHistory("key-uploaded", entry.id, file.name);
			await this.plugin.persist();
			new Notice(`Uploaded ${file.name}`);
			await this.render();
		});
		input.click();
	}
}
