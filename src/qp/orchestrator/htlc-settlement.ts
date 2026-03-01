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

import { randomBytes } from 'crypto';
import { HTLCProviderManager, HTLCConsumerManager, InMemoryHTLCStorage } from '../htlc/manager.js';
import type { HTLCDetails, HTLCRecord } from '../htlc/types.js';
import type { UTXO } from '../htlc/types.js';

import type { SessionManager } from '../sideload/session-manager.js';
import type { SideloadTransport } from './types.js';
import type { SideloadConnectionInfo } from '../sideload/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HtlcOfferMessage {
  type: 'htlc_offer';
  secretHash: string;   // hex
  timeoutBlock: number;
  sessionId: number;
  skillCode: number;
}

export interface HtlcFundedMessage {
  type: 'htlc_funded';
  fundingTxId: string;  // hex
  htlcId: string;
  amountKoinu: number;
}

export interface HtlcClaimMessage {
  type: 'htlc_claim';
  secret: string;       // hex
  claimTxId: string;
}

// ---------------------------------------------------------------------------
// Consumer Settlement
// ---------------------------------------------------------------------------

export interface ConsumerSettlementConfig {
  consumerPubkey: Buffer;
  consumerPrivkey: Buffer;
  consumerAddress: string;
  getUtxos: () => Promise<UTXO[]>;
  changeAddress: string;
  provider: { broadcastTransaction(txHex: string): Promise<{ txid: string }> };
}

/**
 * Consumer-side HTLC settlement.
 *
 * Handles: receive offer → accept → fund → wait for claim → verify
 */
export class ConsumerSettlement {
  private htlcManager: HTLCConsumerManager;
  private storage = new InMemoryHTLCStorage();

  constructor(private config: ConsumerSettlementConfig) {
    this.htlcManager = new HTLCConsumerManager(
      this.storage,
      config.consumerPubkey,
      config.consumerPrivkey,
      config.consumerAddress,
    );
  }

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
  async settle(params: {
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
  }> {
    const { sessionManager, transport, remoteInfo, providerPubkey, amountKoinu, feeKoinu } = params;
    const timeoutMs = params.timeoutMs ?? 300_000; // 5 min default

    // Step 1: Wait for HTLC offer from provider
    const offerWire = await transport.receive(remoteInfo.sessionId, timeoutMs);
    const offerMsg = sessionManager.processIncoming(offerWire);
    const offer = offerMsg.body as unknown as HtlcOfferMessage;

    if (offer.type !== 'htlc_offer') {
      throw new Error(`Expected htlc_offer, got ${offer.type}`);
    }

    // Step 2: Accept offer and create our HTLC record
    const secretHash = Buffer.from(offer.secretHash, 'hex');
    const { htlc, record } = await this.htlcManager.acceptOffer({
      secretHash,
      providerPubkey,
      timeoutBlock: offer.timeoutBlock,
      sessionId: offer.sessionId,
      skillCode: offer.skillCode,
    });

    // Step 3: Build and broadcast funding tx
    const utxos = await this.config.getUtxos();
    const { fundingTx, fundingTxId } = this.htlcManager.buildFundingTx({
      htlc,
      amountKoinu,
      feeBufferKoinu: feeKoinu,
      sessionId: offer.sessionId,
      skillCode: offer.skillCode,
      utxos,
      changeAddress: this.config.changeAddress,
      feeKoinu,
    });

    // Sign and broadcast
    const { txid: confirmedTxId } = await this.config.provider.broadcastTransaction(fundingTx);

    // Mark funded
    await this.htlcManager.markFunded(record.id, confirmedTxId, amountKoinu);
    await this.htlcManager.markActive(record.id);

    // Step 4: Notify provider that HTLC is funded
    const fundedMsg: HtlcFundedMessage = {
      type: 'htlc_funded',
      fundingTxId: confirmedTxId,
      htlcId: record.id,
      amountKoinu,
    };
    const fundedWire = sessionManager.buildResponse(offerMsg.id, fundedMsg as any);
    await transport.send(remoteInfo, fundedWire);

    // Step 5: Wait for provider to claim (reveals secret)
    // This happens on-chain — provider broadcasts claim tx
    // For now, we return and the caller can poll or listen for the claim
    const updatedRecord = await this.storage.load(record.id);

    return {
      htlcId: record.id,
      fundingTxId: confirmedTxId,
      record: updatedRecord ?? record,
    };
  }

  destroy(): void {
    this.htlcManager.destroy();
  }
}

// ---------------------------------------------------------------------------
// Provider Settlement
// ---------------------------------------------------------------------------

export interface ProviderSettlementConfig {
  providerPubkey: Buffer;
  providerPrivkey: Buffer;
  providerAddress: string;
  provider: { broadcastTransaction(txHex: string): Promise<{ txid: string }> };
}

/**
 * Provider-side HTLC settlement.
 *
 * Handles: create offer → send secretHash → wait for funding → deliver → claim
 */
export class ProviderSettlement {
  private htlcManager: HTLCProviderManager;
  private storage = new InMemoryHTLCStorage();

  constructor(private config: ProviderSettlementConfig) {
    this.htlcManager = new HTLCProviderManager(
      this.storage,
      config.providerPubkey,
      config.providerPrivkey,
      config.providerAddress,
    );
  }

  /**
   * Create HTLC offer and send secretHash to consumer via sideload.
   *
   * @returns The offer details (including secret for later claiming)
   */
  async createAndSendOffer(params: {
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
  }> {
    const { sessionManager, transport, remoteInfo, consumerPubkey, timeoutBlock, sessionId, skillCode } = params;

    // Create the HTLC offer (generates secret)
    const { htlc, secret, record } = await this.htlcManager.createOffer({
      consumerPubkey,
      timeoutBlock,
      sessionId,
      skillCode,
    });

    // Send secretHash to consumer
    const offerMsg: HtlcOfferMessage = {
      type: 'htlc_offer',
      secretHash: record.params.secretHash.toString('hex'),
      timeoutBlock,
      sessionId,
      skillCode,
    };

    const { wire, messageId } = sessionManager.buildRequest(offerMsg as any);
    await transport.send(remoteInfo, wire);

    return {
      htlcId: record.id,
      secret,
      secretHash: record.params.secretHash,
      htlc,
      record,
      offerMessageId: messageId,
    };
  }

  /**
   * Wait for consumer's funding confirmation, then claim the HTLC.
   *
   * @returns Claim tx details
   */
  async waitForFundingAndClaim(params: {
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
  }> {
    const { sessionManager, transport, remoteInfo, htlcId } = params;
    const timeoutMs = params.timeoutMs ?? 300_000;
    const feeKoinu = params.feeKoinu ?? 100_000; // 0.001 DOGE default

    // Wait for htlc_funded message
    const fundedWire = await transport.receive(remoteInfo.sessionId, timeoutMs);
    const fundedMsg = sessionManager.processIncoming(fundedWire);
    const funded = fundedMsg.body as unknown as HtlcFundedMessage;

    if (funded.type !== 'htlc_funded') {
      throw new Error(`Expected htlc_funded, got ${funded.type}`);
    }

    // Mark HTLC as funded
    await this.htlcManager.markFunded(htlcId, funded.fundingTxId, funded.amountKoinu);

    // Claim the HTLC (reveal secret, build claim tx)
    const claimResult = await this.htlcManager.claim(htlcId, feeKoinu);

    // Broadcast claim tx
    const { txid: claimTxId } = await this.config.provider.broadcastTransaction(claimResult.claimTx);

    // Notify consumer of claim
    const claimMsg: HtlcClaimMessage = {
      type: 'htlc_claim',
      secret: claimResult.secret.toString('hex'),
      claimTxId,
    };
    const claimWire = sessionManager.buildResponse(fundedMsg.id, claimMsg as any);
    await transport.send(remoteInfo, claimWire);

    return {
      claimTxHex: claimResult.claimTx,
      claimTxId,
      claimOpReturn: claimResult.claimOpReturn,
      secret: claimResult.secret,
    };
  }

  destroy(): void {
    this.htlcManager.destroy();
  }
}
