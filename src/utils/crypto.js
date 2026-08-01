import crypto from 'crypto';

const ALG = 'aes-256-gcm';

// PASSWORD_ENCRYPTION_KEY must be a 64-character hex string (32 bytes).
// Generate once and set in your server environment (Render dashboard):
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
// Never commit the real key. Never store it in the DB.
const KEY_HEX = process.env.PASSWORD_ENCRYPTION_KEY || '';
const KEY = KEY_HEX ? Buffer.from(KEY_HEX, 'hex') : null;

function assertKey() {
    if (!KEY || KEY.length !== 32) {
        throw new Error(
            'PASSWORD_ENCRYPTION_KEY is not set or invalid. ' +
            'Set a 64-character hex string in your environment variables.'
        );
    }
}

/**
 * Encrypts a plaintext password using AES-256-GCM.
 * Returns a colon-separated string: iv:authTag:ciphertext (all hex).
 * Each call produces a different output (random IV) so two identical
 * passwords don't produce the same ciphertext in the DB.
 */
export function encryptPassword(plain) {
    assertKey();
    const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
    const cipher = crypto.createCipheriv(ALG, KEY, iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag(); // 128-bit auth tag
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a value produced by encryptPassword().
 * Throws if the key is wrong or the ciphertext has been tampered with
 * (GCM auth tag verification fails).
 */
export function decryptPassword(stored) {
    assertKey();
    const parts = stored.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted password format');
    const [ivHex, tagHex, encHex] = parts;
    const decipher = crypto.createDecipheriv(ALG, KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return decipher.update(Buffer.from(encHex, 'hex'), undefined, 'utf8') + decipher.final('utf8');
}