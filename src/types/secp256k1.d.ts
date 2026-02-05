/**
 * Type declarations for secp256k1 (transitive dependency of hdkey)
 */
declare module "secp256k1" {
  export function privateKeyVerify(privateKey: Buffer): boolean;
  export function publicKeyCreate(privateKey: Buffer, compressed?: boolean): Uint8Array;
  export function publicKeyConvert(publicKey: Buffer, compressed?: boolean): Uint8Array;
  export function publicKeyVerify(publicKey: Buffer): boolean;
  export function ecdsaSign(message: Buffer, privateKey: Buffer): { signature: Uint8Array; recid: number };
  export function ecdsaVerify(signature: Buffer, message: Buffer, publicKey: Buffer): boolean;
}
