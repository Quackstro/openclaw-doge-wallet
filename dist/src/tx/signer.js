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
// ============================================================================
// Signer
// ============================================================================
/**
 * Generate P2PKH scriptPubKey from a DOGE address using bitcore.
 * Returns the hex string of the script.
 *
 * @param address - DOGE address string
 * @param bitcore - bitcore-lib-doge module
 * @returns Script hex string (e.g., "76a914...88ac")
 */
function generateScriptPubKey(address, bitcore) {
    const { Address, Script } = bitcore;
    const addr = new Address(address);
    return Script.buildPublicKeyHashOut(addr).toHex();
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
export function signTransaction(rawTx, privateKey, network, utxos) {
    if (!privateKey || privateKey.length !== 32) {
        throw new Error("Invalid private key — signing aborted");
    }
    // Import bitcore-lib-doge
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bitcore = require("bitcore-lib-doge");
    const { Transaction, PrivateKey: BPrivateKey, Networks, crypto: { BN } } = bitcore;
    // Determine the network
    const bitcoreNetwork = network === "testnet" ? Networks.testnet : Networks.livenet;
    // Create bitcore PrivateKey from raw buffer WITH COMPRESSED FLAG
    // CRITICAL: The wallet uses compressed public keys for address derivation (hdkey/secp256k1).
    // PrivateKey.fromBuffer() defaults to uncompressed keys, which produces DIFFERENT addresses!
    // We must use `new PrivateKey(bn, network, compressed=true)` to match the wallet's address.
    const bn = BN.fromBuffer(privateKey);
    let privKey = new BPrivateKey(bn, bitcoreNetwork, true);
    try {
        // Deserialize the unsigned transaction
        const tx = new Transaction(rawTx);
        // CRITICAL FIX: When deserializing from hex, bitcore creates generic Input
        // objects that don't implement clearSignatures() (it throws AbstractMethodInvoked).
        // We must use associateInputs() to convert them to proper PublicKeyHashInput objects.
        if (utxos && utxos.length > 0) {
            // Convert UTXOs to the format expected by associateInputs
            // IMPORTANT: If scriptPubKey is empty (BlockCypher sometimes doesn't return it),
            // generate it from the address. This is critical for associateInputs to work.
            const utxoObjects = utxos.map((u) => {
                let script = u.scriptPubKey;
                if (!script || script.length === 0) {
                    // Generate P2PKH script from address
                    script = generateScriptPubKey(u.address, bitcore);
                }
                return {
                    txId: u.txid,
                    outputIndex: u.vout,
                    address: u.address,
                    script: script,
                    satoshis: u.amount,
                };
            });
            // associateInputs replaces generic Input objects with proper typed inputs
            // (e.g., PublicKeyHashInput) that have working clearSignatures() methods
            tx.associateInputs(utxoObjects);
        }
        // Sign each input
        tx.sign(privKey);
        // Verify the transaction is fully signed
        if (!tx.isFullySigned()) {
            throw new Error("Transaction signing incomplete — not all inputs are signed");
        }
        // Verify the transaction integrity
        const verifyResult = tx.verify();
        if (verifyResult !== true) {
            throw new Error(`Transaction verification failed: ${verifyResult}`);
        }
        // Serialize the signed transaction
        const signedTx = tx.serialize({
            disableDustOutputs: true,
            disableSmallFees: true,
            disableLargeFees: true,
        });
        return {
            signedTx,
            txid: tx.hash,
            isFullySigned: true,
        };
    }
    finally {
        // SECURITY [H-1]: Zero private key buffer after signing
        privateKey.fill(0);
        // Zero out the bitcore PrivateKey's internal BigNumber to minimize exposure
        // Note: bitcore uses BN.js internally - we clear the internal state
        if (privKey && privKey.bn) {
            privKey.bn.red = null;
            privKey.bn.words = null;
        }
        privKey = null;
    }
}
//# sourceMappingURL=signer.js.map