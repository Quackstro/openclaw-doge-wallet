/**
 * HTLC Settlement Module
 *
 * Implements the atomic HTLC payment flow between consumer and provider:
 *
 * 1. Provider creates offer (secret + secretHash)
 * 2. Provider sends secretHash to consumer via sideload
 * 3. Consumer accepts offer, builds + broadcasts funding tx
 * 4. Consumer sends fundingTxId to provider via sideload
 * 5. Provider delivers service
 * 6. Provider claims HTLC (reveals secret on-chain)
 * 7. Consumer verifies claim
 *
 * Sideload message types used:
 *   - htlc_offer: provider → consumer (secretHash, timeoutBlock)
 *   - htlc_funded: consumer → provider (fundingTxId, htlcId)
 *   - htlc_claim: provider → consumer (secret, claimTxId)
 */
import type { HTLCDetails, HTLCRecord } from '../htlc/types.js';
import type { UTXO } from '../htlc/types.js';
import type { SessionManager } from '../sideload/session-manager.js';
import type { SideloadTransport } from './types.js';
import type { SideloadConnectionInfo } from '../sideload/types.js';
export interface HtlcOfferMessage {
    type: 'htlc_offer';
    secretHash: string;
    timeoutBlock: number;
    sessionId: number;
    skillCode: number;
}
export interface HtlcFundedMessage {
    type: 'htlc_funded';
    fundingTxId: string;
    htlcId: string;
    amountKoinu: number;
}
export interface HtlcClaimMessage {
    type: 'htlc_claim';
    secret: string;
    claimTxId: string;
}
export interface ConsumerSettlementConfig {
    consumerPubkey: Buffer;
    consumerPrivkey: Buffer;
    consumerAddress: string;
    getUtxos: () => Promise<UTXO[]>;
    changeAddress: string;
    provider: {
        broadcastTransaction(txHex: string): Promise<{
            txid: string;
        }>;
    };
}
/**
 * Consumer-side HTLC settlement.
 *
 * Handles: receive offer → accept → fund → wait for claim → verify
 */
export declare class ConsumerSettlement {
    private config;
    private htlcManager;
    private storage;
    constructor(config: ConsumerSettlementConfig);
    /**
     * Execute consumer side of HTLC settlement.
     *
     * @param sessionManager — active sideload session
     * @param transport — for sending/receiving wire messages
     * @param remoteInfo — provider's connection info
     * @param providerPubkey — provider's compressed public key
     * @param amountKoinu — amount to lock in HTLC
     * @param feeKoinu — tx fee
     * @param timeoutMs — max time to wait for offer/claim
     * @returns HTLC record and claim details
     */
    settle(params: {
        sessionManager: SessionManager;
        transport: SideloadTransport;
        remoteInfo: SideloadConnectionInfo;
        providerPubkey: Buffer;
        amountKoinu: number;
        feeKoinu: number;
        timeoutMs?: number;
    }): Promise<{
        htlcId: string;
        fundingTxId: string;
        secret?: Buffer;
        claimTxId?: string;
        record: HTLCRecord;
    }>;
    destroy(): void;
}
export interface ProviderSettlementConfig {
    providerPubkey: Buffer;
    providerPrivkey: Buffer;
    providerAddress: string;
    provider: {
        broadcastTransaction(txHex: string): Promise<{
            txid: string;
        }>;
    };
}
/**
 * Provider-side HTLC settlement.
 *
 * Handles: create offer → send secretHash → wait for funding → deliver → claim
 */
export declare class ProviderSettlement {
    private config;
    private htlcManager;
    private storage;
    constructor(config: ProviderSettlementConfig);
    /**
     * Create HTLC offer and send secretHash to consumer via sideload.
     *
     * @returns The offer details (including secret for later claiming)
     */
    createAndSendOffer(params: {
        sessionManager: SessionManager;
        transport: SideloadTransport;
        remoteInfo: SideloadConnectionInfo;
        consumerPubkey: Buffer;
        timeoutBlock: number;
        sessionId: number;
        skillCode: number;
    }): Promise<{
        htlcId: string;
        secret: Buffer;
        secretHash: Buffer;
        htlc: HTLCDetails;
        record: HTLCRecord;
        offerMessageId: string;
    }>;
    /**
     * Wait for consumer's funding confirmation, then claim the HTLC.
     *
     * @returns Claim tx details
     */
    waitForFundingAndClaim(params: {
        sessionManager: SessionManager;
        transport: SideloadTransport;
        remoteInfo: SideloadConnectionInfo;
        htlcId: string;
        offerMessageId: string;
        timeoutMs?: number;
        feeKoinu?: number;
    }): Promise<{
        claimTxHex: string;
        claimTxId: string;
        claimOpReturn: Buffer;
        secret: Buffer;
    }>;
    destroy(): void;
}
//# sourceMappingURL=htlc-settlement.d.ts.map