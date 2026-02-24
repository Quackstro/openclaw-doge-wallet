/**
 * Commitment Transaction Builder
 * Time-Decaying Commitments for Payment Channels
 */
import { hash160 } from '../crypto.js';
import { buildMultisigScriptSig, getSignatureOrder } from './multisig.js';
import { DEFAULT_CLOSE_FEE_KOINU, DUST_THRESHOLD_KOINU } from './types.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const bitcore = require('bitcore-lib-doge');
const { Transaction, Script, PrivateKey, PublicKey } = bitcore;
const CryptoSignature = bitcore.crypto.Signature;
/**
 * Calculate timelock block for a commitment
 *
 * Time-decaying model: latest commitment unlocks first
 * Commitment #N has timelock: openBlock + ttlBlocks - (N × timelockGap)
 */
export function calculateTimelock(params, sequence) {
    if (params.timelockGap <= 0) {
        throw new Error('timelockGap must be positive');
    }
    const baseTimelock = params.openBlock + params.ttlBlocks;
    const decay = sequence * params.timelockGap;
    const timelock = baseTimelock - decay;
    if (timelock <= params.openBlock) {
        throw new Error(`Timelock ${timelock} would be at or before openBlock ${params.openBlock} (sequence ${sequence} exceeds channel capacity)`);
    }
    return timelock;
}
/**
 * Calculate maximum calls possible in a channel
 */
export function maxChannelCalls(params) {
    if (params.timelockGap <= 0) {
        throw new Error('timelockGap must be positive');
    }
    return Math.floor(params.ttlBlocks / params.timelockGap);
}
/**
 * Build an unsigned commitment transaction
 *
 * Commitment structure:
 * - Input: Channel funding multisig
 * - Output 0: Consumer's balance (timelocked)
 * - Output 1: Provider's balance (immediate)
 * - nLockTime: commitment timelock
 *
 * NOTE: Commitment txs are intentionally 0-fee. They are held off-chain and
 * only broadcast as a last resort (unilateral close). The broadcaster should
 * use CPFP (child-pays-for-parent) to incentivise confirmation.
 */
export function buildCommitmentTx(params, funding, state, consumerAddress, providerAddress) {
    const tx = new Transaction();
    // Set nLockTime for this commitment
    tx.lockUntilBlockHeight(state.timelockBlock);
    // Add funding input
    const scriptHash = hash160(funding.redeemScript);
    tx.from({
        txId: funding.fundingTxId,
        outputIndex: funding.fundingOutputIndex,
        satoshis: funding.depositKoinu,
        script: Script.buildScriptHashOut(Script.fromBuffer(Buffer.concat([
            Buffer.from([0xa9, 0x14]),
            scriptHash,
            Buffer.from([0x87]),
        ]))),
    });
    // Set sequence to enable CLTV
    tx.inputs[0].sequenceNumber = 0xFFFFFFFE;
    // Output 0: Consumer's balance
    if (state.consumerBalance > 0) {
        tx.to(consumerAddress, state.consumerBalance);
    }
    // Output 1: Provider's balance
    if (state.providerBalance > 0) {
        tx.to(providerAddress, state.providerBalance);
    }
    return tx;
}
/**
 * Sign a commitment transaction
 */
export function signCommitment(tx, privateKey, redeemScript, inputAmount) {
    const privKey = new PrivateKey(privateKey);
    const sighash = Transaction.Sighash.sign(tx, privKey, Transaction.Signature.SIGHASH_ALL, 0, Script.fromBuffer(redeemScript), inputAmount);
    return Buffer.concat([
        sighash.toDER(),
        Buffer.from([Transaction.Signature.SIGHASH_ALL]),
    ]);
}
/**
 * Verify a commitment signature against a public key
 *
 * @returns true if the signature is valid for the given tx + pubkey
 */
export function verifyCommitmentSig(tx, sig, pubkey, redeemScript) {
    try {
        const cryptoSig = CryptoSignature.fromTxFormat(sig);
        const pubKey = PublicKey.fromBuffer(pubkey);
        return Transaction.Sighash.verify(tx, cryptoSig, pubKey, 0, Script.fromBuffer(redeemScript));
    }
    catch {
        return false;
    }
}
/**
 * Complete a commitment with both signatures
 */
export function completeCommitment(tx, consumerSig, providerSig, redeemScript, consumerPubkey, providerPubkey) {
    // Determine signature order based on pubkey order in script
    const order = getSignatureOrder(redeemScript, consumerPubkey, providerPubkey);
    const [sig1, sig2] = order === 'consumer_first'
        ? [consumerSig, providerSig]
        : [providerSig, consumerSig];
    // Build scriptSig
    const scriptSig = buildMultisigScriptSig(sig1, sig2, redeemScript);
    tx.inputs[0].setScript(Script.fromBuffer(scriptSig));
    return tx;
}
/**
 * Create initial commitment (sequence 0, full balance to consumer)
 */
export function createInitialCommitment(params, funding, consumerAddress, providerAddress) {
    const state = {
        sequence: 0,
        consumerBalance: funding.depositKoinu,
        providerBalance: 0,
        callCount: 0,
        timelockBlock: calculateTimelock(params, 0),
    };
    const tx = buildCommitmentTx(params, funding, state, consumerAddress, providerAddress);
    return { state, tx };
}
/**
 * Create next commitment after a payment
 */
export function createNextCommitment(params, funding, currentState, paymentKoinu, consumerAddress, providerAddress) {
    // Validate payment
    if (paymentKoinu <= 0) {
        throw new Error('Payment must be positive');
    }
    if (paymentKoinu > currentState.consumerBalance) {
        throw new Error('Insufficient consumer balance');
    }
    const nextSequence = currentState.sequence + 1;
    const maxCalls = maxChannelCalls(params);
    if (nextSequence > maxCalls) {
        throw new Error(`Channel exhausted: max ${maxCalls} calls`);
    }
    const state = {
        sequence: nextSequence,
        consumerBalance: currentState.consumerBalance - paymentKoinu,
        providerBalance: currentState.providerBalance + paymentKoinu,
        callCount: currentState.callCount + 1,
        timelockBlock: calculateTimelock(params, nextSequence),
    };
    // Balance conservation invariant
    if (state.consumerBalance + state.providerBalance !== funding.depositKoinu) {
        throw new Error(`Balance conservation violated: ${state.consumerBalance} + ${state.providerBalance} !== ${funding.depositKoinu}`);
    }
    const tx = buildCommitmentTx(params, funding, state, consumerAddress, providerAddress);
    return { state, tx };
}
/**
 * Create a signed commitment record
 */
export function createSignedCommitment(state, tx, consumerSig, providerSig) {
    return {
        ...state,
        txHex: tx.uncheckedSerialize(),
        consumerSig,
        providerSig,
        isComplete: !!(consumerSig && providerSig),
    };
}
/**
 * Rebuild transaction from signed commitment
 */
export function txFromSignedCommitment(commitment) {
    return new Transaction(commitment.txHex);
}
/**
 * Build cooperative close transaction (no timelocks)
 *
 * @param feeKoinu - Optional fee override (defaults to DEFAULT_CLOSE_FEE_KOINU)
 */
export function buildCooperativeCloseTx(params, funding, state, consumerAddress, providerAddress, feeKoinu = DEFAULT_CLOSE_FEE_KOINU) {
    if (feeKoinu < 0) {
        throw new Error('Fee cannot be negative');
    }
    if (feeKoinu >= funding.depositKoinu) {
        throw new Error('Fee exceeds deposit');
    }
    const tx = new Transaction();
    // No nLockTime for cooperative close
    // Add funding input
    const scriptHash = hash160(funding.redeemScript);
    tx.from({
        txId: funding.fundingTxId,
        outputIndex: funding.fundingOutputIndex,
        satoshis: funding.depositKoinu,
        script: Script.buildScriptHashOut(Script.fromBuffer(Buffer.concat([
            Buffer.from([0xa9, 0x14]),
            scriptHash,
            Buffer.from([0x87]),
        ]))),
    });
    // Fee from consumer's balance (or split proportionally)
    const consumerPays = Math.min(state.consumerBalance, feeKoinu);
    const providerPays = feeKoinu - consumerPays;
    // Output 0: Consumer's balance minus fee share
    const consumerOutput = state.consumerBalance - consumerPays;
    if (consumerOutput > 0) {
        if (consumerOutput < DUST_THRESHOLD_KOINU) {
            // Below dust — fold into fee to avoid unspendable output
        }
        else {
            tx.to(consumerAddress, consumerOutput);
        }
    }
    // Output 1: Provider's balance minus fee share
    const providerOutput = state.providerBalance - providerPays;
    if (providerOutput > 0) {
        if (providerOutput < DUST_THRESHOLD_KOINU) {
            // Below dust — fold into fee
        }
        else {
            tx.to(providerAddress, providerOutput);
        }
    }
    return tx;
}
//# sourceMappingURL=commitment.js.map