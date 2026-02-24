/**
 * QP Transaction Builder
 * High-level helpers for building QP-annotated Dogecoin transactions.
 */
import { randomFillSync } from 'crypto';
import { encodeMessage } from '../messages.js';
import { QPMessageType, QP_MAGIC, QP_VERSION } from '../types.js';
import { getRegistryAddress } from '../registry.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const bitcore = require('bitcore-lib-doge');
const { Transaction, Script, PrivateKey } = bitcore;
/**
 * Build the OP_RETURN output data for a SERVICE_ADVERTISE message.
 */
export function buildAdvertiseOpReturn(params) {
    // Generate random nonce
    const nonce = Buffer.alloc(4);
    randomFillSync(nonce);
    const payload = {
        skillCode: params.skillCode,
        priceKoinu: params.priceKoinu,
        priceUnit: params.priceUnit,
        flags: params.flags,
        ttlBlocks: params.ttlBlocks,
        nonce,
        pubkey: params.pubkey,
        metadata: params.description.padEnd(20, '\0').slice(0, 20),
    };
    return encodeMessage({
        magic: QP_MAGIC,
        version: QP_VERSION,
        type: QPMessageType.SERVICE_ADVERTISE,
        payload,
    });
}
/**
 * Build a SERVICE_ADVERTISE transaction.
 *
 * Outputs:
 *   0: Dust amount to registry address (makes it scannable)
 *   1: OP_RETURN with SERVICE_ADVERTISE payload
 *   2: Change
 */
export function buildAdvertiseTx(params) {
    const { advertise, utxos, changeAddress, feeKoinu = 1_000_000 } = params;
    const registryAddress = getRegistryAddress(advertise.category);
    const opReturnData = buildAdvertiseOpReturn(advertise);
    const dustAmount = 100_000_000; // 1 DOGE dust to registry
    // Validate UTXO sufficiency
    const totalInput = utxos.reduce((sum, u) => sum + u.amount, 0);
    const minRequired = dustAmount + feeKoinu;
    if (totalInput < minRequired) {
        throw new Error(`Insufficient funds: have ${totalInput} koinu, need at least ${minRequired} koinu ` +
            `(${dustAmount} dust + ${feeKoinu} fee)`);
    }
    const tx = new Transaction();
    // Add inputs
    for (const utxo of utxos) {
        tx.from({
            txId: utxo.txid,
            outputIndex: utxo.vout,
            satoshis: utxo.amount,
            script: utxo.scriptPubKey,
        });
    }
    // Output 0: Dust to registry address
    tx.to(registryAddress, dustAmount);
    // Output 1: OP_RETURN
    tx.addOutput(new Transaction.Output({
        satoshis: 0,
        script: Script.buildDataOut(opReturnData),
    }));
    // Change
    tx.change(changeAddress);
    tx.fee(feeKoinu);
    return tx;
}
/**
 * Build the OP_RETURN output data for a RATING message.
 */
export function buildRatingOpReturn(params) {
    const payload = {
        sessionId: params.sessionId,
        ratedAgent: params.ratedAgent,
        rating: params.rating,
        flags: {
            tipIncluded: params.tipIncluded,
            dispute: params.dispute,
        },
        skillCode: params.skillCode,
        paymentTxid: params.paymentTxid,
        reserved: Buffer.alloc(3),
    };
    return encodeMessage({
        magic: QP_MAGIC,
        version: QP_VERSION,
        type: QPMessageType.RATING,
        payload,
    });
}
/**
 * Build a RATING transaction.
 */
export function buildRatingTx(params) {
    const { rating, utxos, changeAddress, feeKoinu = 1_000_000 } = params;
    const opReturnData = buildRatingOpReturn(rating);
    const dustAmount = 100_000_000; // 1 DOGE to provider
    // Validate UTXO sufficiency
    const totalInput = utxos.reduce((sum, u) => sum + u.amount, 0);
    const minRequired = dustAmount + feeKoinu;
    if (totalInput < minRequired) {
        throw new Error(`Insufficient funds: have ${totalInput} koinu, need at least ${minRequired} koinu`);
    }
    const tx = new Transaction();
    for (const utxo of utxos) {
        tx.from({
            txId: utxo.txid,
            outputIndex: utxo.vout,
            satoshis: utxo.amount,
            script: utxo.scriptPubKey,
        });
    }
    // Output 0: Payment to provider
    tx.to(rating.providerAddress, dustAmount);
    // Output 1: OP_RETURN with rating
    tx.addOutput(new Transaction.Output({
        satoshis: 0,
        script: Script.buildDataOut(opReturnData),
    }));
    tx.change(changeAddress);
    tx.fee(feeKoinu);
    return tx;
}
/**
 * Sign a transaction with a private key.
 */
export function signTx(tx, privateKeyBuf) {
    const privKey = new PrivateKey(privateKeyBuf);
    tx.sign(privKey);
    return tx;
}
/**
 * Serialize a transaction for broadcasting.
 */
export function serializeTx(tx) {
    return tx.uncheckedSerialize();
}
/**
 * Broadcast a signed transaction.
 */
export async function broadcastTx(provider, txHex) {
    return provider.broadcastTx(txHex);
}
//# sourceMappingURL=tx-builder.js.map