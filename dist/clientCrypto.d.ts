export declare function encryptString(plaintext: string, password: string): Promise<string>;
export declare function decryptString(encrypted: string, password: string): Promise<string>;
export declare function obfuscateKey(plaintext: string): Promise<string>;
export declare function deobfuscateKey(blob: string): Promise<string>;
export declare function isEncryptedSchedule(bytes: Uint8Array): boolean;
export declare function encryptBytes(plain: Uint8Array, password: string): Promise<Uint8Array>;
export declare function decryptBytes(blob: Uint8Array, password: string): Promise<Uint8Array>;
//# sourceMappingURL=clientCrypto.d.ts.map