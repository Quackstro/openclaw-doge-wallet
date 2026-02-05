/**
 * DOGE Wallet — Transaction Signer
 *
 * Signs raw transactions with ECDSA using bitcore-lib-doge.
 * Private key handling follows strict security rules:
 *   - NEVER logged
 *   - NEVER in error messages
 *   - Zeroed after use
 *
 * Much sign. Very ECDSA. Wow. 🐕
 */
import type { UTXO } from "../types.js";
export interface SignTransactionResult {
    /** Signed transaction hex */
    signedTx: string;
    /** Transaction ID */
    txid: string;
    /** Whether the transaction is fully signed */
    isFullySigned: boolean;
}
export interface SignTransactionOptions {
    /** Raw unsigned transaction hex */
    rawTx: string;
    /** Raw private key buffer (32 bytes). NEVER LOG THIS. */
    privateKey: Buffer;
    /** Network: "mainnet" or "testnet" */
    network: "mainnet" | "testnet";
    /** UTXOs used as inputs — required to create proper PublicKeyHashInput objects */
    utxos: UTXO[];
}
/**
 * Sign a raw (unsigned) transaction with a private key.
 *
 * IMPORTANT: UTXOs must be provided to properly reconstruct the input types.
 * When deserializing from raw hex, bitcore creates generic Input objects that
 * lack methods like clearSignatures(). Passing UTXOs allows us to use
 * associateInputs() to recreate proper PublicKeyHashInput objects.
 *
 * NOTE: If a UTXO's scriptPubKey is empty (some API providers don't return it),
 * we generate it from the address. This is safe for P2PKH addresses.
 *
 * @param rawTx - Unsigned transaction hex from the builder
 * @param privateKey - Raw private key buffer (32 bytes). NEVER LOG THIS.
 * @param network - "mainnet" or "testnet"
 * @param utxos - UTXOs used as inputs (required for proper input type reconstruction)
 * @returns SignTransactionResult with signed tx hex and txid
 * @throws Error if signing fails or signature verification fails
 */
export declare function signTransaction(rawTx: string, privateKey: Buffer, network: "mainnet" | "testnet", utxos?: UTXO[]): SignTransactionResult;
//# sourceMappingURL=signer.d.ts.map