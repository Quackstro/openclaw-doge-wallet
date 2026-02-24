/**
 * Payment Channel Manager
 * Lifecycle management for 2-of-2 multisig payment channels
 */
import { createMultisig } from './multisig.js';
import type { ChannelFunding, ChannelRecord, CommitmentState, SignedCommitment } from './types.js';
import { ChannelState } from './types.js';
declare const Transaction: any;
/**
 * Storage interface for channel records
 */
export interface ChannelStorage {
    save(record: ChannelRecord): Promise<void>;
    load(id: string): Promise<ChannelRecord | null>;
    loadByChannelId(channelId: number): Promise<ChannelRecord | null>;
    loadByState(state: ChannelState): Promise<ChannelRecord[]>;
    loadAll(): Promise<ChannelRecord[]>;
    delete(id: string): Promise<void>;
    /** Acquire a per-channel lock for exclusive state mutation */
    withLock<T>(id: string, fn: () => Promise<T>): Promise<T>;
}
/**
 * In-memory channel storage (for testing)
 */
export declare class InMemoryChannelStorage implements ChannelStorage {
    private records;
    private locks;
    save(record: ChannelRecord): Promise<void>;
    load(id: string): Promise<ChannelRecord | null>;
    loadByChannelId(channelId: number): Promise<ChannelRecord | null>;
    loadByState(state: ChannelState): Promise<ChannelRecord[]>;
    loadAll(): Promise<ChannelRecord[]>;
    delete(id: string): Promise<void>;
    withLock<T>(id: string, fn: () => Promise<T>): Promise<T>;
}
/**
 * Base channel manager with shared functionality
 */
declare abstract class BaseChannelManager {
    protected storage: ChannelStorage;
    protected pubkey: Buffer;
    protected privkey: Buffer;
    protected address: string;
    constructor(storage: ChannelStorage, pubkey: Buffer, privkey: Buffer, address: string);
    /**
     * Get channel capacity info
     */
    getChannelInfo(id: string): Promise<{
        record: ChannelRecord;
        remainingCalls: number;
        remainingBalance: number;
        expiresAtBlock: number;
    }>;
    /**
     * Sign a commitment transaction
     */
    protected signCommitmentTx(tx: typeof Transaction, funding: ChannelFunding): Buffer;
    /**
     * Get all open channels
     */
    getOpenChannels(): Promise<ChannelRecord[]>;
    /**
     * Check for channels nearing expiry (not already expired)
     */
    getExpiringChannels(currentBlock: number, warningBlocks?: number): Promise<ChannelRecord[]>;
    /**
     * Get channels that have already expired
     */
    getExpiredChannels(currentBlock: number): Promise<ChannelRecord[]>;
}
/**
 * Channel manager for consumer (channel funder)
 */
export declare class ChannelConsumerManager extends BaseChannelManager {
    constructor(storage: ChannelStorage, consumerPubkey: Buffer, consumerPrivkey: Buffer, consumerAddress: string);
    /**
     * Create a new channel with a provider
     */
    createChannel(params: {
        providerPubkey: Buffer;
        depositKoinu: number;
        ttlBlocks?: number;
        timelockGap?: number;
        openBlock: number;
    }): Promise<{
        record: ChannelRecord;
        multisig: ReturnType<typeof createMultisig>;
    }>;
    /**
     * Set funding info after funding tx is broadcast
     */
    setFunding(id: string, funding: ChannelFunding, providerAddress: string): Promise<{
        record: ChannelRecord;
        refundCommitment: SignedCommitment;
        consumerSig: Buffer;
    }>;
    /**
     * Complete refund commitment with provider's signature and mark channel open
     */
    completeRefundAndOpen(id: string, providerSig: Buffer): Promise<ChannelRecord>;
    /**
     * Create a payment (new commitment)
     */
    createPayment(id: string, paymentKoinu: number, providerAddress: string): Promise<{
        state: CommitmentState;
        consumerSig: Buffer;
    }>;
    /**
     * Accept provider's signature for a payment and update state
     */
    acceptPaymentSignature(id: string, state: CommitmentState, providerSig: Buffer, providerAddress: string): Promise<ChannelRecord>;
    /**
     * Initiate cooperative close
     */
    initiateCooperativeClose(id: string, providerAddress: string): Promise<{
        closeTx: typeof Transaction;
        consumerSig: Buffer;
    }>;
    /**
     * Complete cooperative close with provider's signature
     */
    completeCooperativeClose(id: string, providerSig: Buffer, providerAddress: string): Promise<{
        closeTxHex: string;
        closeTxId: string;
    }>;
    /**
     * Unilateral close (broadcast latest commitment)
     */
    unilateralClose(id: string): Promise<{
        closeTxHex: string;
        closeTxId: string;
    }>;
}
/**
 * Channel manager for provider
 */
export declare class ChannelProviderManager extends BaseChannelManager {
    constructor(storage: ChannelStorage, providerPubkey: Buffer, providerPrivkey: Buffer, providerAddress: string);
    /**
     * Accept a channel from consumer
     */
    acceptChannel(params: {
        channelId: number;
        consumerPubkey: Buffer;
        depositKoinu: number;
        ttlBlocks: number;
        timelockGap: number;
        openBlock: number;
        fundingTxId: string;
        fundingOutputIndex: number;
    }): Promise<{
        record: ChannelRecord;
        multisig: ReturnType<typeof createMultisig>;
    }>;
    /**
     * Sign refund commitment and return signature
     */
    signRefundCommitment(id: string, consumerSig: Buffer, consumerAddress: string): Promise<{
        record: ChannelRecord;
        providerSig: Buffer;
    }>;
    /**
     * Accept a payment and return signature
     */
    acceptPayment(id: string, state: CommitmentState, consumerSig: Buffer, consumerAddress: string): Promise<{
        providerSig: Buffer;
        record: ChannelRecord;
    }>;
    /**
     * Sign cooperative close
     */
    signCooperativeClose(id: string, consumerAddress: string): Promise<{
        providerSig: Buffer;
        closeTxHex: string;
        closeTxId: string;
    }>;
    /**
     * Unilateral close (broadcast latest commitment)
     */
    unilateralClose(id: string): Promise<{
        closeTxHex: string;
        closeTxId: string;
    }>;
}
export {};
//# sourceMappingURL=manager.d.ts.map