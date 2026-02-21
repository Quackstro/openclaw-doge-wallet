/**
 * HTLC Manager
 * Lifecycle management for Hash Time-Locked Contracts
 */

import { randomBytes } from 'crypto';
import { hash160 } from '../crypto.js';
import { createHTLC, verifySecret } from './script.js';
import {
  buildFundingTransaction,
  buildClaimTransaction,
  buildRefundTransaction,
  serializeTransaction,
  getTransactionId,
} from './transactions.js';
import type {
  HTLCParams,
  HTLCDetails,
  HTLCRecord,
  UTXO,
} from './types.js';
import { HTLCState, HTLC_DEFAULTS } from './types.js';

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
export class InMemoryHTLCStorage implements HTLCStorage {
  private records: Map<string, HTLCRecord> = new Map();

  async save(record: HTLCRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async load(id: string): Promise<HTLCRecord | null> {
    return this.records.get(id) || null;
  }

  async loadByFundingTx(txId: string): Promise<HTLCRecord | null> {
    for (const record of this.records.values()) {
      if (record.fundingTxId === txId) {
        return record;
      }
    }
    return null;
  }

  async loadByState(state: HTLCState): Promise<HTLCRecord[]> {
    const result: HTLCRecord[] = [];
    for (const record of this.records.values()) {
      if (record.state === state) {
        result.push(record);
      }
    }
    return result;
  }

  async loadAll(): Promise<HTLCRecord[]> {
    return Array.from(this.records.values());
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }
}

/**
 * HTLC Manager for provider-side operations
 */
export class HTLCProviderManager {
  constructor(
    private storage: HTLCStorage,
    private providerPubkey: Buffer,
    private providerPrivkey: Buffer,
    private providerAddress: string
  ) {}

  /**
   * Create a new HTLC offer (provider generates secret)
   */
  async createOffer(params: {
    consumerPubkey: Buffer;
    timeoutBlock: number;
    sessionId: number;
    skillCode: number;
  }): Promise<{ htlc: HTLCDetails; secret: Buffer; record: HTLCRecord }> {
    // Generate random secret
    const secret = randomBytes(HTLC_DEFAULTS.SECRET_SIZE);
    const secretHash = hash160(secret);

    // Create HTLC
    const htlcParams: HTLCParams = {
      secretHash,
      providerPubkey: this.providerPubkey,
      consumerPubkey: params.consumerPubkey,
      timeoutBlock: params.timeoutBlock,
    };
    const htlc = createHTLC(htlcParams);

    // Create record
    const record: HTLCRecord = {
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
  async markFunded(id: string, fundingTxId: string, amountKoinu: number): Promise<HTLCRecord> {
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
  async claim(id: string, feeKoinu: number = HTLC_DEFAULTS.FEE_BUFFER_KOINU): Promise<{
    claimTx: string;
    claimTxId: string;
    secret: Buffer;
  }> {
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

    // Update record
    record.state = HTLCState.CLAIMED;
    record.claimTxId = claimTxId;
    record.updatedAt = Date.now();
    await this.storage.save(record);

    return {
      claimTx: claimTxHex,
      claimTxId,
      secret: record.secret,
    };
  }

  /**
   * Get pending HTLCs that need attention
   */
  async getPendingHTLCs(): Promise<HTLCRecord[]> {
    const active = await this.storage.loadByState(HTLCState.ACTIVE);
    const fundingPending = await this.storage.loadByState(HTLCState.FUNDING_PENDING);
    return [...active, ...fundingPending];
  }

  /**
   * Check for expired HTLCs
   */
  async checkExpired(currentBlock: number): Promise<HTLCRecord[]> {
    const active = await this.storage.loadByState(HTLCState.ACTIVE);
    const expired: HTLCRecord[] = [];

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
  constructor(
    private storage: HTLCStorage,
    private consumerPubkey: Buffer,
    private consumerPrivkey: Buffer,
    private consumerAddress: string
  ) {}

  /**
   * Accept an HTLC offer from provider
   */
  async acceptOffer(params: {
    secretHash: Buffer;
    providerPubkey: Buffer;
    timeoutBlock: number;
    sessionId: number;
    skillCode: number;
  }): Promise<{ htlc: HTLCDetails; record: HTLCRecord }> {
    const htlcParams: HTLCParams = {
      secretHash: params.secretHash,
      providerPubkey: params.providerPubkey,
      consumerPubkey: this.consumerPubkey,
      timeoutBlock: params.timeoutBlock,
    };
    const htlc = createHTLC(htlcParams);

    const record: HTLCRecord = {
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
  buildFundingTx(params: {
    htlc: HTLCDetails;
    amountKoinu: number;
    feeBufferKoinu: number;
    sessionId: number;
    skillCode: number;
    utxos: UTXO[];
    changeAddress: string;
    feeKoinu: number;
  }): { fundingTx: string; fundingTxId: string } {
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
  async markFunded(id: string, fundingTxId: string, amountKoinu: number): Promise<HTLCRecord> {
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
  async markActive(id: string): Promise<HTLCRecord> {
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
  async verifyAndMarkClaimed(id: string, secret: Buffer, claimTxId: string): Promise<boolean> {
    const record = await this.storage.load(id);
    if (!record) {
      throw new Error(`HTLC not found: ${id}`);
    }

    const valid = verifySecret(secret, record.params.secretHash);
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
  buildRefundTx(params: {
    record: HTLCRecord;
    feeKoinu: number;
  }): { refundTx: string; refundTxId: string } {
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
  async markRefunded(id: string, refundTxId: string): Promise<HTLCRecord> {
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
  async getRefundableHTLCs(currentBlock: number): Promise<HTLCRecord[]> {
    const active = await this.storage.loadByState(HTLCState.ACTIVE);
    const expired = await this.storage.loadByState(HTLCState.EXPIRED);
    
    return [...active, ...expired].filter(
      record => currentBlock >= record.params.timeoutBlock
    );
  }
}
