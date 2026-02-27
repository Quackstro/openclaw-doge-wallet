/**
 * Quackstro Protocol Cryptographic Primitives
 * ECDH, HKDF, AES-256-GCM, HASH160
 */
/**
 * HASH160 = RIPEMD160(SHA256(data))
 * Used for HTLC secret hashes and address generation
 */
export declare function hash160(data: Buffer): Buffer;
/**
 * SHA256 hash
 */
export declare function sha256(data: Buffer): Buffer;
/**
 * ECDH shared secret derivation on secp256k1
 * Returns the x-coordinate of the shared point (32 bytes)
 */
export declare function ecdhSharedSecret(privateKey: Buffer, publicKey: Buffer): Buffer;
/**
 * HKDF-SHA256 key derivation
 * RFC 5869 implementation
 */
export declare function hkdfDerive(ikm: Buffer, salt: Buffer, info: string | Buffer, length: number): Buffer;
/**
 * AES-256-GCM encryption
 * Returns ciphertext (same length as plaintext) and 16-byte auth tag
 */
export declare function aesGcmEncrypt(key: Buffer, iv: Buffer, plaintext: Buffer): {
    ciphertext: Buffer;
    tag: Buffer;
};
/**
 * AES-256-GCM decryption
 * Returns plaintext or throws on authentication failure
 */
export declare function aesGcmDecrypt(key: Buffer, iv: Buffer, ciphertext: Buffer, tag: Buffer): Buffer;
/**
 * Derive IV from nonce and timestamp (§5.4.3)
 * IV = SHA-256(nonce || timestamp)[0:12]
 */
export declare function deriveIv(nonce: Buffer, timestamp: number): Buffer;
/**
 * Derive handshake encryption key (§7.3)
 */
export declare function deriveHandshakeKey(sharedSecret: Buffer, nonce: Buffer): Buffer;
/**
 * Derive session key from ephemeral ECDH (§7.4)
 */
export declare function deriveSessionKey(sessionSecret: Buffer, sessionId: number): Buffer;
/**
 * Generate a random ephemeral key pair
 */
export declare function generateEphemeralKeyPair(): {
    privateKey: Buffer;
    publicKey: Buffer;
};
/**
 * Generate random bytes
 */
export declare function randomNonce(size?: number): Buffer;
/**
 * Compress a public key (65 bytes -> 33 bytes)
 */
export declare function compressPublicKey(publicKey: Buffer): Buffer;
/**
 * Decompress a public key (33 bytes -> 65 bytes)
 */
export declare function decompressPublicKey(publicKey: Buffer): Buffer;
/**
 * Verify a public key is valid
 */
export declare function isValidPublicKey(publicKey: Buffer): boolean;
/**
 * Verify a private key is valid (must be 1 < key < N)
 */
export declare function isValidPrivateKey(privateKey: Buffer): boolean;
//# sourceMappingURL=crypto.d.ts.map