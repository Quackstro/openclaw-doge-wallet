/**
 * HTLC Manager
 * Lifecycle management for Hash Time-Locked Contracts
 */
import { randomBytes } from 'crypto';
import { hash160 } from '../crypto.js';
import { createHTLC, verifySecret } from './script.js';
import { buildFundingTransaction, buildClaimTransaction, buildRefundTransaction, createHtlcClaimOpReturn, serializeTransaction, getTransactionId, } from './transactions.js';
import { HTLCState, HTLC_DEFAULTS } from './types.js';
/**
 * In-memory HTLC storage (for testing/simple use)
 */
export class InMemoryHTLCStorage {
    records = new Map();
    async save(record) {
        this.records.set(record.id, record);
    }
    async load(id) {
        return this.records.get(id) || null;
    }
    async loadByFundingTx(txId) {
        for (const record of this.records.values()) {
            if (record.fundingTxId === txId) {
                return record;
            }
        }
        return null;
    }
    async loadByState(state) {
        const result = [];
        for (const record of this.records.values()) {
            if (record.state === state) {
                result.push(record);
            }
        }
        return result;
    }
    async loadAll() {
        return Array.from(this.records.values());
    }
    async delete(id) {
        this.records.delete(id);
    }
}
/**
 * HTLC Manager for provider-side operations
 */
export class HTLCProviderManager {
    storage;
    providerPubkey;
    providerPrivkey;
    providerAddress;
    constructor(storage, providerPubkey, providerPrivkey, providerAddress) {
        this.storage = storage;
        this.providerPubkey = providerPubkey;
        this.providerPrivkey = providerPrivkey;
        this.providerAddress = providerAddress;
    }
    /** Zero sensitive key material */
    destroy() {
        this.providerPrivkey.fill(0);
    }
    /**
     * Create a new HTLC offer (provider generates secret)
     */
    async createOffer(params) {
        // Generate random secret
        const secret = randomBytes(HTLC_DEFAULTS.SECRET_SIZE);
        const secretHash = hash160(secret);
        // Create HTLC
        const htlcParams = {
            secretHash,
            providerPubkey: this.providerPubkey,
            consumerPubkey: params.consumerPubkey,
            timeoutBlock: params.timeoutBlock,
        };
        const htlc = createHTLC(htlcParams);
        // Create record
        const record = {
            id: randomBytes(16).toString('hex'),
            state: HTLCState.CREATED,
            params: htlcParams,
            redeemScript: htlc.redeemScript,
            p2shAddress: htlc.p2shAddress,
            secret,
            sessionId: params.sessionId,
            skillCode: params.skillCode,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        await this.storage.save(record);
        return { htlc, secret, record };
    }
    /**
     * Mark HTLC as funded (after consumer broadcasts funding tx)
     */
    async markFunded(id, fundingTxId, amountKoinu) {
        const record = await this.storage.load(id);
        if (!record) {
            throw new Error(`HTLC not found: ${id}`);
        }
        record.state = HTLCState.ACTIVE;
        record.fundingTxId = fundingTxId;
        record.amountKoinu = amountKoinu;
        record.updatedAt = Date.now();
        await this.storage.save(record);
        return record;
    }
    /**
     * Claim an HTLC (reveal secret and take payment)
     */
    async claim(id, feeKoinu = HTLC_DEFAULTS.FEE_BUFFER_KOINU) {
        const record = await this.storage.load(id);
        if (!record) {
            throw new Error(`HTLC not found: ${id}`);
        }
        if (record.state !== HTLCState.ACTIVE) {
            throw new Error(`HTLC not in ACTIVE state: ${record.state}`);
        }
        if (!record.fundingTxId || !record.amountKoinu) {
            throw new Error('HTLC funding info missing');
        }
        if (!record.secret) {
            throw new Error('HTLC secret missing (not provider?)');
        }
        // Build claim transaction
        const claimTx = buildClaimTransaction({
            fundingTxId: record.fundingTxId,
            fundingOutputIndex: 0, // HTLC is always output 0
            secret: record.secret,
            redeemScript: record.redeemScript,
            providerPrivkey: this.providerPrivkey,
            providerAddress: this.providerAddress,
            htlcAmountKoinu: record.amountKoinu,
            feeKoinu,
        });
        const claimTxHex = serializeTransaction(claimTx);
        const claimTxId = getTransactionId(claimTx);
        // Generate OP_RETURN metadata for on-chain claim announcement
        const claimOpReturn = createHtlcClaimOpReturn({
            sessionId: record.sessionId,
            fundingTxId: record.fundingTxId,
            claimedKoinu: record.amountKoinu - feeKoinu,
        });
        // Update record
        record.state = HTLCState.CLAIMED;
        record.claimTxId = claimTxId;
        record.updatedAt = Date.now();
        await this.storage.save(record);
        return {
            claimTx: claimTxHex,
            claimTxId,
            claimOpReturn,
            secret: record.secret,
        };
    }
    /**
     * Get pending HTLCs that need attention
     */
    async getPendingHTLCs() {
        const active = await this.storage.loadByState(HTLCState.ACTIVE);
        const fundingPending = await this.storage.loadByState(HTLCState.FUNDING_PENDING);
        return [...active, ...fundingPending];
    }
    /**
     * Check for expired HTLCs
     */
    async checkExpired(currentBlock) {
        const active = await this.storage.loadByState(HTLCState.ACTIVE);
        const expired = [];
        for (const record of active) {
            if (currentBlock >= record.params.timeoutBlock) {
                record.state = HTLCState.EXPIRED;
                record.updatedAt = Date.now();
                await this.storage.save(record);
                expired.push(record);
            }
        }
        return expired;
    }
}
/**
 * HTLC Manager for consumer-side operations
 */
export class HTLCConsumerManager {
    storage;
    consumerPubkey;
    consumerPrivkey;
    consumerAddress;
    constructor(storage, consumerPubkey, consumerPrivkey, consumerAddress) {
        this.storage = storage;
        this.consumerPubkey = consumerPubkey;
        this.consumerPrivkey = consumerPrivkey;
        this.consumerAddress = consumerAddress;
    }
    /** Zero sensitive key material */
    destroy() {
        this.consumerPrivkey.fill(0);
    }
    /**
     * Accept an HTLC offer from provider
     */
    async acceptOffer(params) {
        const htlcParams = {
            secretHash: params.secretHash,
            providerPubkey: params.providerPubkey,
            consumerPubkey: this.consumerPubkey,
            timeoutBlock: params.timeoutBlock,
        };
        const htlc = createHTLC(htlcParams);
        const record = {
            id: randomBytes(16).toString('hex'),
            state: HTLCState.CREATED,
            params: htlcParams,
            redeemScript: htlc.redeemScript,
            p2shAddress: htlc.p2shAddress,
            sessionId: params.sessionId,
            skillCode: params.skillCode,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        await this.storage.save(record);
        return { htlc, record };
    }
    /**
     * Build funding transaction for an HTLC
     */
    buildFundingTx(params) {
        const tx = buildFundingTransaction({
            htlc: params.htlc,
            amountKoinu: params.amountKoinu,
            feeBufferKoinu: params.feeBufferKoinu,
            sessionId: params.sessionId,
            skillCode: params.skillCode,
            consumerPubkey: this.consumerPubkey,
            utxos: params.utxos,
            changeAddress: params.changeAddress,
            feeKoinu: params.feeKoinu,
        });
        return {
            fundingTx: serializeTransaction(tx),
            fundingTxId: getTransactionId(tx),
        };
    }
    /**
     * Mark HTLC as funded after broadcasting
     */
    async markFunded(id, fundingTxId, amountKoinu) {
        const record = await this.storage.load(id);
        if (!record) {
            throw new Error(`HTLC not found: ${id}`);
        }
        record.state = HTLCState.FUNDING_PENDING;
        record.fundingTxId = fundingTxId;
        record.amountKoinu = amountKoinu;
        record.updatedAt = Date.now();
        await this.storage.save(record);
        return record;
    }
    /**
     * Mark HTLC as active after funding confirms
     */
    async markActive(id) {
        const record = await this.storage.load(id);
        if (!record) {
            throw new Error(`HTLC not found: ${id}`);
        }
        record.state = HTLCState.ACTIVE;
        record.updatedAt = Date.now();
        await this.storage.save(record);
        return record;
    }
    /**
     * Verify provider revealed the correct secret
     */
    async verifyAndMarkClaimed(id, secret, claimTxId) {
        const record = await this.storage.load(id);
        if (!record) {
            throw new Error(`HTLC not found: ${id}`);
        }
        const valid = verifySecret(secret, record.params.secretHash);
        if (!valid) {
            // Log failed verification attempt for diagnostics
            const hashHex = record.params.secretHash.toString('hex').slice(0, 16) + '…';
            process.stderr.write(`[QP/HTLC] verifyAndMarkClaimed failed for ${id} (secretHash=${hashHex})\n`);
        }
        if (valid) {
            record.state = HTLCState.CLAIMED;
            record.secret = secret;
            record.claimTxId = claimTxId;
            record.updatedAt = Date.now();
            await this.storage.save(record);
        }
        return valid;
    }
    /**
     * Build refund transaction (after timeout)
     */
    buildRefundTx(params) {
        const { record, feeKoinu } = params;
        if (!record.fundingTxId || !record.amountKoinu) {
            throw new Error('HTLC funding info missing');
        }
        const tx = buildRefundTransaction({
            fundingTxId: record.fundingTxId,
            fundingOutputIndex: 0,
            redeemScript: record.redeemScript,
            consumerPrivkey: this.consumerPrivkey,
            consumerAddress: this.consumerAddress,
            htlcAmountKoinu: record.amountKoinu,
            feeKoinu,
            timeoutBlock: record.params.timeoutBlock,
        });
        return {
            refundTx: serializeTransaction(tx),
            refundTxId: getTransactionId(tx),
        };
    }
    /**
     * Mark HTLC as refunded
     */
    async markRefunded(id, refundTxId) {
        const record = await this.storage.load(id);
        if (!record) {
            throw new Error(`HTLC not found: ${id}`);
        }
        record.state = HTLCState.REFUNDED;
        record.refundTxId = refundTxId;
        record.updatedAt = Date.now();
        await this.storage.save(record);
        return record;
    }
    /**
     * Get HTLCs eligible for refund
     */
    async getRefundableHTLCs(currentBlock) {
        const active = await this.storage.loadByState(HTLCState.ACTIVE);
        const expired = await this.storage.loadByState(HTLCState.EXPIRED);
        return [...active, ...expired].filter(record => currentBlock >= record.params.timeoutBlock);
    }
}
//# sourceMappingURL=manager.js.map