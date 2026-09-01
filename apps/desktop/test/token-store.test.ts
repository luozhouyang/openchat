import { describe, expect, it } from "vite-plus/test";
import { createTokenStore, type CryptoBackend, type FileBackend } from "../src/lib/token-store";

class FakeCrypto implements CryptoBackend {
  available = true;
  #store = new Map<string, string>();
  isEncryptionAvailable() {
    return this.available;
  }
  encryptString(plain: string) {
    const payload = new TextEncoder().encode(`enc:${plain}`);
    this.#store.set(Buffer.from(payload).toString("base64"), plain);
    return payload;
  }
  decryptString(payload: Uint8Array) {
    return this.#store.get(Buffer.from(payload).toString("base64")) ?? "";
  }
}

class FakeFiles implements FileBackend {
  #files = new Map<string, Uint8Array>();
  readFile(path: string) {
    return this.#files.get(path);
  }
  writeFile(path: string, data: Uint8Array) {
    this.#files.set(path, data);
  }
  unlink(path: string) {
    this.#files.delete(path);
  }
  exists(path: string) {
    return this.#files.has(path);
  }
}

function make(available = true) {
  const crypto = new FakeCrypto();
  crypto.available = available;
  const files = new FakeFiles();
  const store = createTokenStore(crypto, files, "/userData/tokens.bin");
  return { crypto, files, store };
}

describe("token store (safeStorage-backed)", () => {
  it("round-trips a token through encryption", () => {
    const { store } = make();
    store.setToken("tok-123");
    expect(store.getToken()).toBe("tok-123");
  });

  it("writes encrypted payloads when the keychain is available", () => {
    const { store, files } = make();
    store.setToken("secret");
    const raw = new TextDecoder().decode(files.readFile("/userData/tokens.bin"));
    expect(raw).toContain('"encrypted":true');
    expect(raw).not.toContain("secret");
  });

  it("falls back to unencrypted-at-rest when the keychain is unavailable", () => {
    const { store, files } = make(false);
    store.setToken("plain-tok");
    const raw = new TextDecoder().decode(files.readFile("/userData/tokens.bin"));
    expect(raw).toContain('"encrypted":false');
    expect(store.getToken()).toBe("plain-tok");
  });

  it("clearToken removes the backing file", () => {
    const { store, files } = make();
    store.setToken("tok");
    store.clearToken();
    expect(files.exists("/userData/tokens.bin")).toBe(false);
    expect(store.getToken()).toBeNull();
  });

  it("returns null for missing or corrupt files", () => {
    const { store, files } = make();
    expect(store.getToken()).toBeNull();
    files.writeFile("/userData/tokens.bin", new TextEncoder().encode("{not json"));
    expect(store.getToken()).toBeNull();
  });
});
