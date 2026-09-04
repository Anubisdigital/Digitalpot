import { App, Modal, Setting, Notice } from "obsidian";
import { BlockStyle, BlockType, CustomFont, DigitalpotSettings, genId } from "./data";

export class SetPasswordModal extends Modal {
	private onSubmit: (password: string) => void;

	constructor(app: App, onSubmit: (password: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Set Digitalpot password" });
		contentEl.createEl("p", {
			text: "This password encrypts your secrets. Digitalpot cannot recover it if you forget it.",
			cls: "digitalpot-modal-hint",
		});

		let pw1 = "";
		let pw2 = "";

		new Setting(contentEl).setName("Password").addText((text) => {
			text.inputEl.type = "password";
			text.onChange((v) => (pw1 = v));
		});
		new Setting(contentEl).setName("Confirm password").addText((text) => {
			text.inputEl.type = "password";
			text.onChange((v) => (pw2 = v));
		});

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Set password")
				.setCta()
				.onClick(() => {
					if (pw1.length < 6) {
						new Notice("Password must be at least 6 characters.");
						return;
					}
					if (pw1 !== pw2) {
						new Notice("Passwords do not match.");
						return;
					}
					this.close();
					this.onSubmit(pw1);
				})
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class UnlockModal extends Modal {
	private onSubmit: (password: string) => void;
	private attemptsRemaining: number;

	constructor(app: App, attemptsRemaining: number, onSubmit: (password: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
		this.attemptsRemaining = attemptsRemaining;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Unlock Digitalpot" });
		if (this.attemptsRemaining < 20) {
			contentEl.createEl("p", {
				text: `${this.attemptsRemaining} attempt(s) remaining before lockout.`,
				cls: "digitalpot-modal-warning",
			});
		}

		let password = "";
		const setting = new Setting(contentEl).setName("Password").addText((text) => {
			text.inputEl.type = "password";
			text.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") submit();
			});
			text.onChange((v) => (password = v));
			setTimeout(() => text.inputEl.focus(), 0);
		});

		const submit = () => {
			this.close();
			this.onSubmit(password);
		};

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText("Unlock").setCta().onClick(submit)
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class LockedOutModal extends Modal {
	private unlockAt: number;

	constructor(app: App, unlockAt: number) {
		super(app);
		this.unlockAt = unlockAt;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Digitalpot is locked" });
		const date = new Date(this.unlockAt);
		contentEl.createEl("p", {
			text: `Too many incorrect attempts. Try again after ${date.toLocaleString()}.`,
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class FormatModal extends Modal {
	private settings: DigitalpotSettings;
	private onChange: (settings: DigitalpotSettings) => void;
	private onFontUpload: (font: CustomFont) => void;

	constructor(
		app: App,
		settings: DigitalpotSettings,
		onChange: (settings: DigitalpotSettings) => void,
		onFontUpload: (font: CustomFont) => void
	) {
		super(app);
		this.settings = settings;
		this.onChange = onChange;
		this.onFontUpload = onFontUpload;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Format" });

		(["head", "secret", "description"] as BlockType[]).forEach((type) => {
			contentEl.createEl("h3", { text: type[0].toUpperCase() + type.slice(1) });
			const style: BlockStyle = this.settings.defaultStyles[type];

			new Setting(contentEl).setName("Font size (px)").addText((text) => {
				text.setValue(String(style.fontSizePx));
				text.onChange((v) => {
					const n = parseInt(v, 10);
					if (!isNaN(n) && n > 0) style.fontSizePx = n;
				});
			});

			new Setting(contentEl)
				.setName("Color")
				.setDesc("Hex (#ff0000) or a name (red, blue, purple...)")
				.addText((text) => {
					text.setValue(style.color);
					text.onChange((v) => (style.color = v || "inherit"));
				});

			new Setting(contentEl)
				.setName("Font")
				.addDropdown((drop) => {
					drop.addOption("inherit", "Default");
					drop.addOption("monospace", "Monospace");
					drop.addOption("serif", "Serif");
					drop.addOption("sans-serif", "Sans-serif");
					this.settings.customFonts.forEach((f) => drop.addOption(f.name, `${f.name} (custom)`));
					drop.setValue(style.fontFamily);
					drop.onChange((v) => (style.fontFamily = v));
				});
		});

		contentEl.createEl("h3", { text: "Custom fonts" });
		contentEl.createEl("p", {
			text: "Upload a .ttf or .otf from this device to use it on any section above.",
			cls: "digitalpot-modal-hint",
		});
		const uploadBtn = contentEl.createEl("button", { text: "Upload font file" });
		uploadBtn.addEventListener("click", () => {
			const input = document.createElement("input");
			input.type = "file";
			input.accept = ".ttf,.otf,font/ttf,font/otf";
			input.addEventListener("change", async () => {
				const file = input.files?.[0];
				if (!file) return;
				const ext = file.name.toLowerCase().endsWith(".otf") ? "otf" : "ttf";
				const buf = await file.arrayBuffer();
				const bytes = new Uint8Array(buf);
				let binary = "";
				for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
				const base64 = btoa(binary);
				const font: CustomFont = {
					id: genId(),
					name: file.name.replace(/\.(ttf|otf)$/i, ""),
					format: ext,
					base64,
				};
				this.onFontUpload(font);
				new Notice(`Font "${font.name}" added.`);
			});
			input.click();
		});

		new Setting(contentEl).addButton((btn) =>
			btn
				.setButtonText("Apply")
				.setCta()
				.onClick(() => {
					this.close();
					this.onChange(this.settings);
				})
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class ConfirmEditModal extends Modal {
	private onConfirm: () => void;

	constructor(app: App, onConfirm: () => void) {
		super(app);
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Confirm edit" });
		contentEl.createEl("p", { text: 'Type "I am sure" to edit this secret.' });

		let value = "";
		new Setting(contentEl).addText((text) => {
			text.onChange((v) => (value = v));
			text.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") submit();
			});
			setTimeout(() => text.inputEl.focus(), 0);
		});

		const submit = () => {
			if (value.trim().toLowerCase() === "i am sure") {
				this.close();
				this.onConfirm();
			} else {
				new Notice('You must type exactly "I am sure".');
			}
		};

		new Setting(contentEl).addButton((btn) =>
			btn.setButtonText("Confirm").setCta().onClick(submit)
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class ChangePasswordModal extends Modal {
	private onSubmit: (currentPassword: string, newPassword: string | null, disable: boolean) => void;

	constructor(
		app: App,
		onSubmit: (currentPassword: string, newPassword: string | null, disable: boolean) => void
	) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Change password / security" });

		let current = "";
		let next = "";
		let next2 = "";

		new Setting(contentEl).setName("Current password").addText((t) => {
			t.inputEl.type = "password";
			t.onChange((v) => (current = v));
		});
		new Setting(contentEl).setName("New password").addText((t) => {
			t.inputEl.type = "password";
			t.onChange((v) => (next = v));
		});
		new Setting(contentEl).setName("Confirm new password").addText((t) => {
			t.inputEl.type = "password";
			t.onChange((v) => (next2 = v));
		});

		new Setting(contentEl)
			.addButton((btn) =>
				btn
					.setButtonText("Update password")
					.setCta()
					.onClick(() => {
						if (!current) {
							new Notice("Enter your current password.");
							return;
						}
						if (next.length < 6 || next !== next2) {
							new Notice("New passwords must match and be 6+ characters.");
							return;
						}
						this.close();
						this.onSubmit(current, next, false);
					})
			)
			.addButton((btn) =>
				btn
					.setWarning()
					.setButtonText("Turn off security")
					.onClick(() => {
						if (!current) {
							new Notice("Enter your current password to disable security.");
							return;
						}
						this.close();
						this.onSubmit(current, null, true);
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
