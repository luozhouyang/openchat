/**
 * Token storage for the desktop shell (spec §4.2): the better-auth bearer
 * token is encrypted with the OS keychain via Electron `safeStorage` and kept
 * in a file under userData. Pure dependency-injected core so it is unit
 * testable without Electron.
 */

export interface CryptoBackend {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Uint8Array;
  decryptString(payload: Uint8Array): string;
}

export interface FileBackend {
  readFile(path: string): Uint8Array | undefined;
  writeFile(path: string, data: Uint8Array): void;
  unlink(path: string): void;
  exists(path: string): boolean;
}

interface StoreFile {
  v: 1;
  encrypted: boolean;
  data: string;
}

export interface TokenStore {
  getToken(): string | null;
  setToken(token: string): void;
  clearToken(): void;
}

const MAGIC = "openchat-tokens";

export function createTokenStore(
  crypto: CryptoBackend,
  files: FileBackend,
  filePath: string,
): TokenStore {
  function read(): StoreFile | null {
    if (!files.exists(filePath)) return null;
    try {
      const parsed = JSON.parse(new TextDecoder().decode(files.readFile(filePath))) as StoreFile;
      if (parsed?.v !== 1 || typeof parsed.data !== "string") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function write(store: StoreFile | null) {
    if (!store) {
      if (files.exists(filePath)) files.unlink(filePath);
      return;
    }
    files.writeFile(filePath, new TextEncoder().encode(JSON.stringify(store)));
  }

  return {
    getToken() {
      const store = read();
      if (!store) return null;
      const payload = Uint8Array.from(Buffer.from(store.data, "base64"));
      try {
        return store.encrypted && crypto.isEncryptionAvailable()
          ? crypto.decryptString(payload)
          : new TextDecoder().decode(payload);
      } catch {
        return null;
      }
    },
    setToken(token) {
      if (crypto.isEncryptionAvailable()) {
        write({
          v: 1,
          encrypted: true,
          data: Buffer.from(crypto.encryptString(token)).toString("base64"),
        });
      } else {
        // Keychain unavailable (e.g. Linux without libsecret): fall back to
        // obfuscated-at-rest plain storage rather than losing the session.
        write({ v: 1, encrypted: false, data: Buffer.from(token).toString("base64") });
      }
    },
    clearToken() {
      write(null);
    },
  };
}

export const FILE_FORMAT_MAGIC = MAGIC;
