/**
 * Type declarations for bs58check (Base58Check encoding)
 */
declare module "bs58check" {
  /**
   * Encode a Buffer to a Base58Check string.
   */
  export function encode(payload: Buffer): string;

  /**
   * Decode a Base58Check string to a Buffer.
   * Throws if checksum validation fails.
   */
  export function decode(string: string): Buffer;

  /**
   * Decode a Base58Check string to a Buffer without checksum validation.
   */
  export function decodeUnsafe(string: string): Buffer | undefined;
}
