import crypto from 'crypto';
// Simple encryption/decryption for Excel file protection
// In production, use libsodium or other battle-tested crypto libraries
const ALGORITHM = 'aes-256-cbc';
export class ExcelEncryption {
    static encrypt(data, password) {
        // Derive key from password
        const hash = crypto.createHash('sha256');
        hash.update(password);
        const key = hash.digest();
        // Generate IV
        const iv = crypto.randomBytes(16);
        // Encrypt
        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
        let encrypted = cipher.update(data);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        // Prepend IV to encrypted data
        return Buffer.concat([iv, encrypted]);
    }
    static decrypt(encryptedData, password) {
        // Derive key from password
        const hash = crypto.createHash('sha256');
        hash.update(password);
        const key = hash.digest();
        // Extract IV
        const iv = encryptedData.slice(0, 16);
        const encrypted = encryptedData.slice(16);
        // Decrypt
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        let decrypted = decipher.update(encrypted);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted;
    }
    static generatePassword() {
        return crypto.randomBytes(16).toString('hex');
    }
}
//# sourceMappingURL=encryption.js.map