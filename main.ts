import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import {
	CustomFont,
	DEFAULT_SETTINGS,
	DigitalpotFile,
	DigitalpotNoteData,
	DigitalpotSettings,
	HistoryEntry,
	LOCKOUT_DURATION_MS,
	MAX_FAILED_ATTEMPTS,
	emptyNoteData,
} from "./data";
import { createPasswordVerifier, decryptString, encryptString, verifyPassword } from "./crypto";
import {
	ChangePasswordModal,
	FormatModal,
	LockedOutModal,
	SetPasswordModal,
	UnlockModal,
} from "./modals";
import { DIGITALPOT_VIEW_TYPE, DigitalpotView } from "./view";

const FILE_EXTENSION = "dpot";

export default class DigitalpotPlugin extends Plugin {
	settings: DigitalpotSettings = DEFAULT_SETTINGS;

	// Session state — lives in memory only, cleared on unload/app close.
	private sessionPassword: string | null = null;
	private blurred = false;

	// The decrypted content of whichever .dpot file is currently open.
	data: DigitalpotNoteData | null = null;
	private currentFile: TFile | null = null;
	private pendingHistoryStart: Map<string, number> = new Map();

	// Obsidian can fire "file-open" more than once for a single open/rename
	// (e.g. once for the outgoing leaf, once for the incoming one). Without a
	// guard, each firing opens its own password modal, and the newer modal
	// closing the older one makes the prompt look like it "flashes and
	// disappears". This tracks whether a prompt is already up and for which
	// file, so repeat events are ignored instead of stacking modals.
	private promptingForFile: TFile | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.injectCustomFontFaces();

		this.registerView(DIGITALPOT_VIEW_TYPE, (leaf) => new DigitalpotView(leaf, this));
		this.registerExtensions([FILE_EXTENSION], DIGITALPOT_VIEW_TYPE);

		this.addRibbonIcon("lock", "Digitalpot: unlock / lock", async () => {
			if (this.sessionPassword) {
				this.lockSession();
			} else {
				await this.promptUnlock();
			}
		});

		this.addCommand({
			id: "digitalpot-new-note",
			name: "New Digitalpot note",
			callback: () => this.createNewNote(),
		});

		this.addCommand({
			id: "digitalpot-lock",
			name: "Lock Digitalpot now",
			callback: () => this.lockSession(),
		});

		if (this.settings.securityEnabled && this.settings.blurOnBlur) {
			this.registerDomEvent(window, "blur", () => {
				this.blurred = true;
				this.refreshActiveView();
			});
			this.registerDomEvent(window, "focus", () => {
				this.blurred = false;
				this.refreshActiveView();
			});
		}

		this.registerEvent(
			this.app.workspace.on("file-open", async (file) => {
				if (file && file.extension === FILE_EXTENSION) {
					await this.handleOpenFile(file);
				}
			})
		);
	}

	onunload(): void {
		this.sessionPassword = null;
		this.data = null;
	}

	isBlurred(): boolean {
		return this.blurred && this.settings.securityEnabled && this.settings.blurOnBlur;
	}

	// --- Settings -------------------------------------------------------------

	async loadSettings(): Promise<void> {
		const loaded = (await this.loadData()) as Partial<DigitalpotSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private injectCustomFontFaces(): void {
		const styleId = "digitalpot-custom-fonts";
		document.getElementById(styleId)?.remove();
		const styleEl = document.createElement("style");
		styleEl.id = styleId;
		styleEl.textContent = this.settings.customFonts
			.map((f: CustomFont) => {
				const mime = f.format === "otf" ? "font/otf" : "font/ttf";
				return `@font-face { font-family: "${f.name}"; src: url(data:${mime};base64,${f.base64}); }`;
			})
			.join("\n");
		document.head.appendChild(styleEl);
	}

	// --- File lifecycle ---------------------------------------------------

	async createNewNote(): Promise<void> {
		const name = `Untitled ${Date.now()}.${FILE_EXTENSION}`;
		const file = await this.app.vault.create(name, "");
		await this.app.workspace.getLeaf(true).openFile(file);
	}

	private async handleOpenFile(file: TFile): Promise<void> {
		this.currentFile = file;

		if (!this.settings.securityEnabled) {
			await this.loadFileWithoutPassword(file);
			this.refreshActiveView();
			return;
		}

		// A prompt for this exact file is already on screen — ignore the
		// duplicate "file-open" firing instead of opening a second modal.
		if (this.promptingForFile === file) {
			return;
		}

		if (!this.settings.passwordVerifier) {
			this.promptingForFile = file;
			new SetPasswordModal(this.app, async (password) => {
				this.promptingForFile = null;
				this.settings.passwordVerifier = await createPasswordVerifier(password);
				await this.saveSettings();
				this.sessionPassword = password;
				await this.loadFileWithPassword(file, password);
				this.refreshActiveView();
			}).open();
			return;
		}

		if (this.isLockedOut()) {
			new LockedOutModal(this.app, this.settings.lockedUntil!).open();
			return;
		}

		if (this.sessionPassword) {
			await this.loadFileWithPassword(file, this.sessionPassword);
			this.refreshActiveView();
			return;
		}

		this.promptingForFile = file;
		await this.promptUnlock();
	}

	async promptUnlock(): Promise<void> {
		if (this.isLockedOut()) {
			this.promptingForFile = null;
			new LockedOutModal(this.app, this.settings.lockedUntil!).open();
			return;
		}
		const remaining = MAX_FAILED_ATTEMPTS - this.settings.failedAttempts;
		new UnlockModal(this.app, remaining, async (password) => {
			this.promptingForFile = null;
			if (!this.settings.passwordVerifier) return;
			const ok = await verifyPassword(this.settings.passwordVerifier, password);
			if (!ok) {
				this.settings.failedAttempts += 1;
				if (this.settings.failedAttempts >= MAX_FAILED_ATTEMPTS) {
					this.settings.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
					new Notice("Too many wrong passwords. Digitalpot is locked for 6 days.");
				} else {
					new Notice(
						`Wrong password. ${MAX_FAILED_ATTEMPTS - this.settings.failedAttempts} attempt(s) left.`
					);
				}
				await this.saveSettings();
				return;
			}
			this.settings.failedAttempts = 0;
			this.settings.lockedUntil = null;
			await this.saveSettings();
			this.sessionPassword = password;
			if (this.currentFile) {
				await this.loadFileWithPassword(this.currentFile, password);
			}
			this.refreshActiveView();
		}).open();
	}

	private isLockedOut(): boolean {
		return !!this.settings.lockedUntil && Date.now() < this.settings.lockedUntil;
	}

	lockSession(): void {
		this.sessionPassword = null;
		this.data = null;
		new Notice("Digitalpot locked.");
		this.refreshActiveView();
	}

	private async loadFileWithPassword(file: TFile, password: string): Promise<void> {
		const raw = await this.app.vault.read(file);
		if (!raw.trim()) {
			this.data = emptyNoteData();
			return;
		}
		try {
			const parsed = JSON.parse(raw) as DigitalpotFile;
			const json = await decryptString(parsed.encrypted, password);
			this.data = JSON.parse(json) as DigitalpotNoteData;
		} catch (e) {
			new Notice("Could not decrypt this note — wrong password or corrupted file.");
			this.data = null;
		}
	}

	private async loadFileWithoutPassword(file: TFile): Promise<void> {
		const raw = await this.app.vault.read(file);
		if (!raw.trim()) {
			this.data = emptyNoteData();
			return;
		}
		try {
			// Security off still means data was written encrypted historically;
			// if we have a session password from earlier this run, try it first.
			if (this.sessionPassword) {
				await this.loadFileWithPassword(file, this.sessionPassword);
				return;
			}
			this.data = JSON.parse(raw) as DigitalpotNoteData;
		} catch {
			this.data = emptyNoteData();
		}
	}

	async persist(): Promise<void> {
		if (!this.currentFile || !this.data) return;
		if (this.settings.securityEnabled) {
			if (!this.sessionPassword) return;
			const encrypted = await encryptString(JSON.stringify(this.data), this.sessionPassword);
			const fileContent: DigitalpotFile = { encrypted };
			await this.app.vault.modify(this.currentFile, JSON.stringify(fileContent));
		} else {
			await this.app.vault.modify(this.currentFile, JSON.stringify(this.data));
		}
	}

	private refreshActiveView(): void {
		this.app.workspace.getLeavesOfType(DIGITALPOT_VIEW_TYPE).forEach((leaf: WorkspaceLeaf) => {
			const view = leaf.view;
			if (view instanceof DigitalpotView) {
				void view.render();
			}
		});
	}

	// --- History ------------------------------------------------------------

	async logHistory(action: HistoryEntry["action"], blockId?: string, label?: string): Promise<void> {
		if (!this.settings.historyEnabled || !this.data) return;
		const now = Date.now();
		const entry: HistoryEntry = {
			action,
			blockId,
			label,
			startedAt: now,
			finishedAt: now,
		};
		this.data.history.push(entry);
	}

	// --- Menu actions called from the view -----------------------------------

	openFormatMenu(): void {
		new FormatModal(
			this.app,
			this.settings,
			async (updated) => {
				this.settings = updated;
				await this.saveSettings();
				this.refreshActiveView();
			},
			async (font) => {
				this.settings.customFonts.push(font);
				await this.saveSettings();
				this.injectCustomFontFaces();
			}
		).open();
	}

	openChangePasswordModal(): void {
		new ChangePasswordModal(this.app, async (currentPassword, newPassword, disable) => {
			if (!this.settings.passwordVerifier) return;
			const ok = await verifyPassword(this.settings.passwordVerifier, currentPassword);
			if (!ok) {
				new Notice("Current password is incorrect.");
				return;
			}

			if (disable) {
				await this.reEncryptAllNotes(currentPassword, null);
				this.settings.securityEnabled = false;
				this.settings.passwordVerifier = null;
				this.sessionPassword = null;
				await this.saveSettings();
				new Notice("Security turned off. Screenshots are no longer blocked.");
				this.refreshActiveView();
				return;
			}

			if (newPassword) {
				await this.reEncryptAllNotes(currentPassword, newPassword);
				this.settings.passwordVerifier = await createPasswordVerifier(newPassword);
				this.sessionPassword = newPassword;
				await this.saveSettings();
				new Notice("Password updated.");
				this.refreshActiveView();
			}
		}).open();
	}

	// Re-keys every .dpot file in the vault. Used on password change and on
	// disabling security (where newPassword === null means "store as plaintext").
	private async reEncryptAllNotes(oldPassword: string, newPassword: string | null): Promise<void> {
		const files = this.app.vault.getFiles().filter((f) => f.extension === FILE_EXTENSION);
		for (const file of files) {
			const raw = await this.app.vault.read(file);
			if (!raw.trim()) continue;
			try {
				const parsed = JSON.parse(raw) as DigitalpotFile;
				const json = await decryptString(parsed.encrypted, oldPassword);
				if (newPassword) {
					const encrypted = await encryptString(json, newPassword);
					await this.app.vault.modify(file, JSON.stringify({ encrypted } as DigitalpotFile));
				} else {
					await this.app.vault.modify(file, json);
				}
			} catch {
				// skip files that don't decrypt with the given password
				continue;
			}
		}
	}
}
