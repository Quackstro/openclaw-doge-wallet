/**
 * Type declarations for hdkey (BIP32 HD key derivation)
 */
declare module "hdkey" {
  class HDKey {
    versions: { private: number; public: number };
    depth: number;
    index: number;
    chainCode: Buffer | null;
    parentFingerprint: number;

    get fingerprint(): number;
    get identifier(): Buffer;
    get pubKeyHash(): Buffer;

    privateKey: Buffer | null;
    publicKey: Buffer | null;

    derive(path: string): HDKey;
    deriveChild(index: number): HDKey;

    sign(hash: Buffer): Buffer;
    verify(hash: Buffer, signature: Buffer): boolean;

    wipePrivateData(): HDKey;

    toJSON(): { xpriv: string; xpub: string };

    privateExtendedKey: string;
    publicExtendedKey: string;

    static fromMasterSeed(seed: Buffer, versions?: { private: number; public: number }): HDKey;
    static fromExtendedKey(key: string, versions?: { private: number; public: number }, skipVerification?: boolean): HDKey;
    static fromJSON(obj: { xpriv: string }): HDKey;

    static HARDENED_OFFSET: number;
  }

  export = HDKey;
}
