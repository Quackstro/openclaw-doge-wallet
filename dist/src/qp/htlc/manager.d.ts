/**
 * HTLC Manager
 * Lifecycle management for Hash Time-Locked Contracts
 */
import type { HTLCDetails, HTLCRecord, UTXO } from './types.js';
import { HTLCState } from './types.js';
/**
 * Storage interface for HTLC records
 */
export interface HTLCStorage {
    save(record: HTLCRecord): Promise<void>;
    load(id: string): Promise<HTLCRecord | null>;
    loadByFundingTx(txId: string): Promise<HTLCRecord | null>;
    loadByState(state: HTLCState): Promise<HTLCRecord[]>;
    loadAll(): Promise<HTLCRecord[]>;
    delete(id: string): Promise<void>;
}
/**
 * In-memory HTLC storage (for testing/simple use)
 */
export declare class InMemoryHTLCStorage implements HTLCStorage {
    private records;
    save(record: HTLCRecord): Promise<void>;
    load(id: string): Promise<HTLCRecord | null>;
    loadByFundingTx(txId: string): Promise<HTLCRecord | null>;
    loadByState(state: HTLCState): Promise<HTLCRecord[]>;
    loadAll(): Promise<HTLCRecord[]>;
    delete(id: string): Promise<void>;
}
/**
 * HTLC Manager for provider-side operations
 */
export declare class HTLCProviderManager {
    private storage;
    private providerPubkey;
    private providerPrivkey;
    private providerAddress;
    constructor(storage: HTLCStorage, providerPubkey: Buffer, providerPrivkey: Buffer, providerAddress: string);
    /** Zero sensitive key material */
    destroy(): void;
    /**
     * Create a new HTLC offer (provider generates secret)
     */
    createOffer(params: {
        consumerPubkey: Buffer;
        timeoutBlock: number;
        sessionId: number;
        skillCode: number;
    }): Promise<{
        htlc: HTLCDetails;
        secret: Buffer;
        record: HTLCRecord;
    }>;
    /**
     * Mark HTLC as funded (after consumer broadcasts funding tx)
     */
    markFunded(id: string, fundingTxId: string, amountKoinu: number): Promise<HTLCRecord>;
    /**
     * Claim an HTLC (reveal secret and take payment)
     */
    claim(id: string, feeKoinu?: number): Promise<{
        claimTx: string;
        claimTxId: string;
        /** OP_RETURN data for HTLC_CLAIM on-chain announcement (80 bytes) */
        claimOpReturn: Buffer;
        secret: Buffer;
    }>;
    /**
     * Get pending HTLCs that need attention
     */
    getPendingHTLCs(): Promise<HTLCRecord[]>;
    /**
     * Check for expired HTLCs
     */
    checkExpired(currentBlock: number): Promise<HTLCRecord[]>;
}
/**
 * HTLC Manager for consumer-side operations
 */
export declare class HTLCConsumerManager {
    private storage;
    private consumerPubkey;
    private consumerPrivkey;
    private consumerAddress;
    constructor(storage: HTLCStorage, consumerPubkey: Buffer, consumerPrivkey: Buffer, consumerAddress: string);
    /** Zero sensitive key material */
    destroy(): void;
    /**
     * Accept an HTLC offer from provider
     */
    acceptOffer(params: {
        secretHash: Buffer;
        providerPubkey: Buffer;
        timeoutBlock: number;
        sessionId: number;
        skillCode: number;
    }): Promise<{
        htlc: HTLCDetails;
        record: HTLCRecord;
    }>;
    /**
     * Build funding transaction for an HTLC
     */
    buildFundingTx(params: {
        htlc: HTLCDetails;
        amountKoinu: number;
        feeBufferKoinu: number;
        sessionId: number;
        skillCode: number;
        utxos: UTXO[];
        changeAddress: string;
        feeKoinu: number;
    }): {
        fundingTx: string;
        fundingTxId: string;
    };
    /**
     * Mark HTLC as funded after broadcasting
     */
    markFunded(id: string, fundingTxId: string, amountKoinu: number): Promise<HTLCRecord>;
    /**
     * Mark HTLC as active after funding confirms
     */
    markActive(id: string): Promise<HTLCRecord>;
    /**
     * Verify provider revealed the correct secret
     */
    verifyAndMarkClaimed(id: string, secret: Buffer, claimTxId: string): Promise<boolean>;
    /**
     * Build refund transaction (after timeout)
     */
    buildRefundTx(params: {
        record: HTLCRecord;
        feeKoinu: number;
    }): {
        refundTx: string;
        refundTxId: string;
    };
    /**
     * Mark HTLC as refunded
     */
    markRefunded(id: string, refundTxId: string): Promise<HTLCRecord>;
    /**
     * Get HTLCs eligible for refund
     */
    getRefundableHTLCs(currentBlock: number): Promise<HTLCRecord[]>;
}
//# sourceMappingURL=manager.d.ts.map