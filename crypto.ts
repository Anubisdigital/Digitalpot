// All crypto uses the platform Web Crypto API (window.crypto.subtle), which
// Obsidian gets for free from Electron/Chromium on desktop and from the
// system WebView on mobile. Nothing here touches disk in plaintext.

const PBKDF2_ITERATIONS = 210_000; // OWASP 2023+ recommendation for PBKDF2-SHA256
const KEY_LENGTH_BITS = 256;

export interface EncryptedPayload {
	// all fields are base64 strings so the whole thing is JSON-serializable
	salt: string;
	iv: string;
	ciphertext: string;
	version: 1;
}

function bufToB64(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let binary = "";
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

function b64ToBuf(b64: string): ArrayBuffer {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
	const enc = new TextEncoder();
	const baseKey = await crypto.subtle.importKey(
		"raw",
		enc.encode(password),
		"PBKDF2",
		false,
		["deriveKey"]
	);
	return crypto.subtle.deriveKey(
		{
			name: "PBKDF2",
			salt: salt as BufferSource,
			iterations: PBKDF2_ITERATIONS,
			hash: "SHA-256",
		},
		baseKey,
		{ name: "AES-GCM", length: KEY_LENGTH_BITS },
		false,
		["encrypt", "decrypt"]
	);
}

export async function encryptString(plaintext: string, password: string): Promise<EncryptedPayload> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await deriveKey(password, salt);
	const enc = new TextEncoder();
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv: iv as BufferSource },
		key,
		enc.encode(plaintext)
	);
	return {
		salt: bufToB64(salt.buffer),
		iv: bufToB64(iv.buffer),
		ciphertext: bufToB64(ciphertext),
		version: 1,
	};
}

export async function decryptString(payload: EncryptedPayload, password: string): Promise<string> {
	const salt = new Uint8Array(b64ToBuf(payload.salt));
	const iv = new Uint8Array(b64ToBuf(payload.iv));
	const key = await deriveKey(password, salt);
	const plainBuf = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: iv as BufferSource },
		key,
		b64ToBuf(payload.ciphertext)
	);
	return new TextDecoder().decode(plainBuf);
}

// --- Password verifier -----------------------------------------------------
// We never store the password. On first setup we encrypt a known constant
// string with it; unlocking re-derives the key and tries to decrypt that
// constant. Success == correct password. This also means a wrong password
// fails via AES-GCM's authentication tag, not a separate weaker check.

const VERIFIER_PLAINTEXT = "digitalpot-verify-v1";

export async function createPasswordVerifier(password: string): Promise<EncryptedPayload> {
	return encryptString(VERIFIER_PLAINTEXT, password);
}

export async function verifyPassword(payload: EncryptedPayload, password: string): Promise<boolean> {
	try {
		const result = await decryptString(payload, password);
		return result === VERIFIER_PLAINTEXT;
	} catch {
		// AES-GCM throws on tag mismatch (wrong password / tampered data)
		return false;
	}
}
