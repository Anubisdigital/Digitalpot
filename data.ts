import { EncryptedPayload } from "./crypto";

export type BlockType = "head" | "secret" | "description";

export interface BlockStyle {
	fontSizePx: number;
	color: string; // hex ("#ff0000") or a CSS color name ("red")
	fontFamily: string; // "inherit" | system font name | custom font id
}

export interface ContentBlock {
	id: string;
	type: BlockType;
	text: string;
	style: BlockStyle;
	createdAt: number;
	updatedAt: number;
}

export interface HistoryEntry {
	action: "created" | "edited" | "deleted" | "copied" | "key-uploaded" | "unlocked" | "locked";
	blockId?: string;
	label?: string;
	startedAt: number;
	finishedAt: number;
}

export interface UploadedKeyFile {
	id: string;
	filename: string;
	// the raw JSON file content, stored as a string inside the encrypted note
	json: string;
	uploadedAt: number;
}

// The decrypted shape of a single .dpot note, once unlocked.
export interface DigitalpotNoteData {
	blocks: ContentBlock[];
	keyFiles: UploadedKeyFile[];
	history: HistoryEntry[];
	headActive: boolean; // "Head" toggle from the dropdown: while on, new text defaults to head style
	headStyleWhenActive: BlockStyle | null;
}

export function emptyNoteData(): DigitalpotNoteData {
	return {
		blocks: [],
		keyFiles: [],
		history: [],
		headActive: false,
		headStyleWhenActive: null,
	};
}

// On-disk shape: everything except salt/iv/ciphertext is opaque to anyone
// without the password.
export interface DigitalpotFile {
	encrypted: EncryptedPayload;
}

export type CustomFontFormat = "ttf" | "otf";

export interface CustomFont {
	id: string;
	name: string; // user-facing name, also used as the CSS font-family
	format: CustomFontFormat;
	base64: string; // font binary, base64-encoded
}

export interface DigitalpotSettings {
	// password verifier, not the password itself
	passwordVerifier: EncryptedPayload | null;
	securityEnabled: boolean;
	historyEnabled: boolean;
	blurOnBlur: boolean; // blur secret content when Obsidian loses focus

	failedAttempts: number;
	lockedUntil: number | null; // epoch ms; null when not locked out

	customFonts: CustomFont[];

	// last-used style per block type, so the Format menu remembers your choices
	defaultStyles: Record<BlockType, BlockStyle>;
}

export const DEFAULT_STYLES: Record<BlockType, BlockStyle> = {
	head: { fontSizePx: 22, color: "inherit", fontFamily: "inherit" },
	secret: { fontSizePx: 15, color: "inherit", fontFamily: "monospace" },
	description: { fontSizePx: 14, color: "inherit", fontFamily: "inherit" },
};

export const DEFAULT_SETTINGS: DigitalpotSettings = {
	passwordVerifier: null,
	securityEnabled: true,
	historyEnabled: true,
	blurOnBlur: true,
	failedAttempts: 0,
	lockedUntil: null,
	customFonts: [],
	defaultStyles: DEFAULT_STYLES,
};

export const MAX_FAILED_ATTEMPTS = 20;
export const LOCKOUT_DURATION_MS = 6 * 24 * 60 * 60 * 1000; // 6 days

export function genId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
