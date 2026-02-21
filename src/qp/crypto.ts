/**
 * Quackstro Protocol Cryptographic Primitives
 * ECDH, HKDF, AES-256-GCM, HASH160
 */

import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const bitcore = require('bitcore-lib-doge');
const { Point, BN } = bitcore.crypto;

/**
 * HASH160 = RIPEMD160(SHA256(data))
 * Used for HTLC secret hashes and address generation
 */
export function hash160(data: Buffer): Buffer {
  const sha256 = createHash('sha256').update(data).digest();
  return createHash('ripemd160').update(sha256).digest();
}

/**
 * SHA256 hash
 */
export function sha256(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

/**
 * ECDH shared secret derivation on secp256k1
 * Returns the x-coordinate of the shared point (32 bytes)
 */
export function ecdhSharedSecret(privateKey: Buffer, publicKey: Buffer): Buffer {
  if (privateKey.length !== 32) {
    throw new Error('Private key must be 32 bytes');
  }
  if (publicKey.length !== 33 && publicKey.length !== 65) {
    throw new Error('Public key must be 33 (compressed) or 65 (uncompressed) bytes');
  }
  
  // Parse the public key as an elliptic curve point
  const pubPoint = Point.fromX(publicKey[0] === 0x03, publicKey.subarray(1, 33));
  
  // Multiply point by private key scalar: sharedPoint = privateKey × publicKey
  const privBN = BN.fromBuffer(privateKey);
  const sharedPoint = pubPoint.mul(privBN);
  
  // Return x-coordinate (32 bytes)
  const xCoord = sharedPoint.getX().toBuffer({ size: 32 });
  return Buffer.from(xCoord);
}

/**
 * HKDF-SHA256 key derivation
 * RFC 5869 implementation
 */
export function hkdfDerive(
  ikm: Buffer,
  salt: Buffer,
  info: string | Buffer,
  length: number
): Buffer {
  const infoBuffer = typeof info === 'string' ? Buffer.from(info, 'utf8') : info;
  
  // Extract: PRK = HMAC-Hash(salt, IKM)
  const prk = createHmac('sha256', salt.length > 0 ? salt : Buffer.alloc(32)).update(ikm).digest();
  
  // Expand: OKM = T(1) || T(2) || T(3) || ...
  const hashLen = 32; // SHA-256 output length
  const n = Math.ceil(length / hashLen);
  
  const okm: Buffer[] = [];
  let t = Buffer.alloc(0);
  
  for (let i = 1; i <= n; i++) {
    const hmac = createHmac('sha256', prk);
    hmac.update(t);
    hmac.update(infoBuffer);
    hmac.update(Buffer.from([i]));
    t = hmac.digest();
    okm.push(t);
  }
  
  return Buffer.concat(okm).subarray(0, length);
}

/**
 * AES-256-GCM encryption
 * Returns ciphertext (same length as plaintext) and 16-byte auth tag
 */
export function aesGcmEncrypt(
  key: Buffer,
  iv: Buffer,
  plaintext: Buffer
): { ciphertext: Buffer; tag: Buffer } {
  if (key.length !== 32) {
    throw new Error('AES-256 key must be 32 bytes');
  }
  if (iv.length !== 12) {
    throw new Error('GCM IV must be 12 bytes');
  }
  
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  
  return { ciphertext, tag };
}

/**
 * AES-256-GCM decryption
 * Returns plaintext or throws on authentication failure
 */
export function aesGcmDecrypt(
  key: Buffer,
  iv: Buffer,
  ciphertext: Buffer,
  tag: Buffer
): Buffer {
  if (key.length !== 32) {
    throw new Error('AES-256 key must be 32 bytes');
  }
  if (iv.length !== 12) {
    throw new Error('GCM IV must be 12 bytes');
  }
  if (tag.length !== 16) {
    throw new Error('GCM auth tag must be 16 bytes');
  }
  
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Derive IV from nonce and timestamp (§5.4.3)
 * IV = SHA-256(nonce || timestamp)[0:12]
 */
export function deriveIv(nonce: Buffer, timestamp: number): Buffer {
  const timestampBuf = Buffer.alloc(4);
  timestampBuf.writeUInt32BE(timestamp);
  
  const hash = sha256(Buffer.concat([nonce, timestampBuf]));
  return hash.subarray(0, 12);
}

/**
 * Derive handshake encryption key (§7.3)
 */
export function deriveHandshakeKey(sharedSecret: Buffer, nonce: Buffer): Buffer {
  return hkdfDerive(sharedSecret, nonce, 'qp-handshake-v1', 32);
}

/**
 * Derive session key from ephemeral ECDH (§7.4)
 */
export function deriveSessionKey(sessionSecret: Buffer, sessionId: number): Buffer {
  const sessionIdBuf = Buffer.alloc(4);
  sessionIdBuf.writeUInt32BE(sessionId);
  
  return hkdfDerive(sessionSecret, sessionIdBuf, 'qp-session-v1', 32);
}

/**
 * Generate a random ephemeral key pair
 */
export function generateEphemeralKeyPair(): { privateKey: Buffer; publicKey: Buffer } {
  const N = Point.getN();
  let privateKey: Buffer;
  let privBN: typeof BN;
  
  do {
    privateKey = randomBytes(32);
    privBN = BN.fromBuffer(privateKey);
  } while (privBN.cmp(N) >= 0 || privBN.isZero());
  
  // Compute public key: G × privateKey
  const G = Point.getG();
  const pubPoint = G.mul(privBN);
  const publicKey = pointToCompressed(pubPoint);
  
  return { privateKey, publicKey };
}

/**
 * Compress a point to 33-byte compressed public key format
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pointToCompressed(point: any): Buffer {
  const x = point.getX().toBuffer({ size: 32 });
  const y = point.getY();
  const prefix = y.isEven() ? 0x02 : 0x03;
  
  const result = Buffer.alloc(33);
  result[0] = prefix;
  x.copy(result, 1);
  return result;
}

/**
 * Generate random bytes
 */
export function randomNonce(size: number = 4): Buffer {
  return randomBytes(size);
}

/**
 * Compress a public key (65 bytes -> 33 bytes)
 */
export function compressPublicKey(publicKey: Buffer): Buffer {
  if (publicKey.length === 33) {
    return publicKey; // Already compressed
  }
  if (publicKey.length !== 65) {
    throw new Error('Public key must be 33 or 65 bytes');
  }
  
  // Uncompressed format: 0x04 || x (32 bytes) || y (32 bytes)
  const x = publicKey.subarray(1, 33);
  const y = publicKey.subarray(33, 65);
  const yBN = BN.fromBuffer(y);
  const prefix = yBN.isEven() ? 0x02 : 0x03;
  
  const result = Buffer.alloc(33);
  result[0] = prefix;
  x.copy(result, 1);
  return result;
}

/**
 * Decompress a public key (33 bytes -> 65 bytes)
 */
export function decompressPublicKey(publicKey: Buffer): Buffer {
  if (publicKey.length === 65) {
    return publicKey; // Already uncompressed
  }
  if (publicKey.length !== 33) {
    throw new Error('Public key must be 33 or 65 bytes');
  }
  
  const isOdd = publicKey[0] === 0x03;
  const x = publicKey.subarray(1, 33);
  const point = Point.fromX(isOdd, x);
  
  const result = Buffer.alloc(65);
  result[0] = 0x04;
  point.getX().toBuffer({ size: 32 }).copy(result, 1);
  point.getY().toBuffer({ size: 32 }).copy(result, 33);
  return result;
}

/**
 * Verify a public key is valid
 */
export function isValidPublicKey(publicKey: Buffer): boolean {
  try {
    if (publicKey.length === 33) {
      const isOdd = publicKey[0] === 0x03;
      const x = publicKey.subarray(1, 33);
      const point = Point.fromX(isOdd, x);
      return point.validate();
    } else if (publicKey.length === 65) {
      if (publicKey[0] !== 0x04) return false;
      const x = publicKey.subarray(1, 33);
      const y = publicKey.subarray(33, 65);
      // Try to recreate point from x and check if y matches
      const xBN = BN.fromBuffer(x);
      const yBN = BN.fromBuffer(y);
      const point = Point.fromX(yBN.isOdd(), x);
      return point.getY().eq(yBN);
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Verify a private key is valid (must be 1 < key < N)
 */
export function isValidPrivateKey(privateKey: Buffer): boolean {
  if (privateKey.length !== 32) return false;
  const N = Point.getN();
  const keyBN = BN.fromBuffer(privateKey);
  return !keyBN.isZero() && keyBN.cmp(N) < 0;
}
