/**
 * Payment Channel Manager
 * Lifecycle management for 2-of-2 multisig payment channels
 */

import { randomBytes } from 'crypto';
import { Mutex } from 'async-mutex';
import { createMultisig } from './multisig.js';
import {
  createInitialCommitment,
  createNextCommitment,
  signCommitment,
  verifyCommitmentSig,
  completeCommitment,
  createSignedCommitment,
  txFromSignedCommitment,
  buildCooperativeCloseTx,
  calculateTimelock,
  maxChannelCalls,
} from './commitment.js';
import type {
  ChannelParams,
  ChannelFunding,
  ChannelRecord,
  CommitmentState,
  SignedCommitment,
} from './types.js';
import { ChannelState, CHANNEL_DEFAULTS } from './types.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const bitcore = require('bitcore-lib-doge');
const { Transaction } = bitcore;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Serialize a transaction for broadcasting with structural validation.
 * Disables fee and signing checks (cooperative close txs may not be fully
 * signed at serialization time) but validates output amounts, inputs, etc.
 */
function serializeForBroadcast(tx: typeof Transaction): string {
  return tx.checkedSerialize({
    disableSmallFees: true,
    disableLargeFees: true,
    disableIsFullySigned: true,
  });
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

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
export class InMemoryChannelStorage implements ChannelStorage {
  private records: Map<string, ChannelRecord> = new Map();
  private locks: Map<string, Mutex> = new Map();

  async save(record: ChannelRecord): Promise<void> {
    this.records.set(record.id, record);
  }

  async load(id: string): Promise<ChannelRecord | null> {
    return this.records.get(id) || null;
  }

  async loadByChannelId(channelId: number): Promise<ChannelRecord | null> {
    for (const record of this.records.values()) {
      if (record.params.channelId === channelId) {
        return record;
      }
    }
    return null;
  }

  async loadByState(state: ChannelState): Promise<ChannelRecord[]> {
    return Array.from(this.records.values()).filter(r => r.state === state);
  }

  async loadAll(): Promise<ChannelRecord[]> {
    return Array.from(this.records.values());
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
    this.locks.delete(id);
  }

  async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    if (!this.locks.has(id)) {
      this.locks.set(id, new Mutex());
    }
    return this.locks.get(id)!.runExclusive(fn);
  }
}

// ---------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------

/**
 * Base channel manager with shared functionality
 */
abstract class BaseChannelManager {
  constructor(
    protected storage: ChannelStorage,
    protected pubkey: Buffer,
    protected privkey: Buffer,
    protected address: string
  ) {}

  /**
   * Get channel capacity info
   */
  async getChannelInfo(id: string): Promise<{
    record: ChannelRecord;
    remainingCalls: number;
    remainingBalance: number;
    expiresAtBlock: number;
  }> {
    const record = await this.storage.load(id);
    if (!record) {
      throw new Error(`Channel not found: ${id}`);
    }

    const maxCalls = maxChannelCalls(record.params);
    const currentCalls = record.latestCommitment?.callCount || 0;
    const remainingCalls = maxCalls - currentCalls;

    const remainingBalance = record.role === 'consumer'
      ? (record.latestCommitment?.consumerBalance || 0)
      : (record.latestCommitment?.providerBalance || 0);

    const expiresAtBlock = record.params.openBlock + record.params.ttlBlocks;

    return { record, remainingCalls, remainingBalance, expiresAtBlock };
  }

  /**
   * Sign a commitment transaction
   */
  protected signCommitmentTx(
    tx: typeof Transaction,
    funding: ChannelFunding
  ): Buffer {
    return signCommitment(tx, this.privkey, funding.redeemScript, funding.depositKoinu);
  }

  /**
   * Get all open channels
   */
  async getOpenChannels(): Promise<ChannelRecord[]> {
    return this.storage.loadByState(ChannelState.OPEN);
  }

  /**
   * Check for channels nearing expiry (not already expired)
   */
  async getExpiringChannels(currentBlock: number, warningBlocks: number = 144): Promise<ChannelRecord[]> {
    const open = await this.getOpenChannels();
    return open.filter(record => {
      const expiresAt = record.params.openBlock + record.params.ttlBlocks;
      const remaining = expiresAt - currentBlock;
      // Only flag if expiring soon but not yet expired
      return remaining > 0 && remaining <= warningBlocks;
    });
  }

  /**
   * Get channels that have already expired
   */
  async getExpiredChannels(currentBlock: number): Promise<ChannelRecord[]> {
    const open = await this.getOpenChannels();
    return open.filter(record => {
      const expiresAt = record.params.openBlock + record.params.ttlBlocks;
      return currentBlock >= expiresAt;
    });
  }

  /**
   * Zero out sensitive key material.
   * Call this when the manager is no longer needed.
   */
  destroy(): void {
    this.privkey.fill(0);
  }
}

// ---------------------------------------------------------------------------
// Consumer Manager
// ---------------------------------------------------------------------------

/**
 * Channel manager for consumer (channel funder)
 */
export class ChannelConsumerManager extends BaseChannelManager {
  constructor(
    storage: ChannelStorage,
    consumerPubkey: Buffer,
    consumerPrivkey: Buffer,
    consumerAddress: string
  ) {
    super(storage, consumerPubkey, consumerPrivkey, consumerAddress);
  }

  /**
   * Create a new channel with a provider
   */
  async createChannel(params: {
    providerPubkey: Buffer;
    depositKoinu: number;
    ttlBlocks?: number;
    timelockGap?: number;
    openBlock: number;
  }): Promise<{
    record: ChannelRecord;
    multisig: ReturnType<typeof createMultisig>;
  }> {
    const { providerPubkey, depositKoinu, openBlock } = params;
    const ttlBlocks = params.ttlBlocks || CHANNEL_DEFAULTS.defaultTtlBlocks;
    const timelockGap = params.timelockGap || CHANNEL_DEFAULTS.defaultTimelockGap;

    // Validate deposit
    if (depositKoinu < CHANNEL_DEFAULTS.minDepositKoinu) {
      throw new Error(`Deposit too small: min ${CHANNEL_DEFAULTS.minDepositKoinu} koinu`);
    }
    if (depositKoinu > CHANNEL_DEFAULTS.maxDepositKoinu) {
      throw new Error(`Deposit too large: max ${CHANNEL_DEFAULTS.maxDepositKoinu} koinu`);
    }

    // Validate timelockGap
    if (timelockGap <= 0) {
      throw new Error('timelockGap must be positive');
    }

    // Check concurrent channel limit
    const openChannels = await this.getOpenChannels();
    if (openChannels.length >= CHANNEL_DEFAULTS.maxConcurrentChannels) {
      throw new Error(`Max concurrent channels reached: ${CHANNEL_DEFAULTS.maxConcurrentChannels}`);
    }

    // Generate channel ID
    const channelId = randomBytes(4).readUInt32BE();

    // Create channel params
    const channelParams: ChannelParams = {
      channelId,
      consumerPubkey: this.pubkey,
      providerPubkey,
      ttlBlocks,
      openBlock,
      timelockGap,
    };

    // Create multisig
    const multisig = createMultisig(this.pubkey, providerPubkey);

    // Create record
    const record: ChannelRecord = {
      id: randomBytes(16).toString('hex'),
      state: ChannelState.CREATED,
      params: channelParams,
      role: 'consumer',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this.storage.save(record);

    return { record, multisig };
  }

  /**
   * Set funding info after funding tx is broadcast.
   * Locked per-channel to prevent concurrent state mutations.
   */
  async setFunding(
    id: string,
    funding: ChannelFunding,
    providerAddress: string
  ): Promise<{
    record: ChannelRecord;
    refundCommitment: SignedCommitment;
    consumerSig: Buffer;
  }> {
    return this.storage.withLock(id, async () => {
      const record = await this.storage.load(id);
      if (!record) {
        throw new Error(`Channel not found: ${id}`);
      }
      if (record.state !== ChannelState.CREATED) {
        throw new Error(`Cannot set funding: channel is in state '${record.state}', expected 'created'`);
      }

      // Validate funding txId format
      if (!/^[0-9a-fA-F]{64}$/.test(funding.fundingTxId)) {
        throw new Error('Invalid funding txId: must be 64 hex characters');
      }

      // Create initial/refund commitment
      const { state, tx } = createInitialCommitment(
        record.params,
        funding,
        this.address,
        providerAddress
      );

      // Sign refund commitment
      const consumerSig = this.signCommitmentTx(tx, funding);

      const refundCommitment = createSignedCommitment(state, tx, consumerSig, undefined);

      // Update record
      record.funding = funding;
      record.state = ChannelState.FUNDING_PENDING;
      record.refundCommitment = refundCommitment;
      record.latestCommitment = refundCommitment;
      record.updatedAt = Date.now();

      await this.storage.save(record);

      return { record, refundCommitment, consumerSig };
    });
  }

  /**
   * Complete refund commitment with provider's signature and mark channel open.
   * Locked per-channel.
   */
  async completeRefundAndOpen(id: string, providerSig: Buffer): Promise<ChannelRecord> {
    return this.storage.withLock(id, async () => {
      const record = await this.storage.load(id);
      if (!record || !record.refundCommitment || !record.funding) {
        throw new Error(`Channel not found or not ready: ${id}`);
      }
      if (record.state !== ChannelState.FUNDING_PENDING) {
        throw new Error(`Channel not in FUNDING_PENDING state: ${record.state}`);
      }

      // Verify provider's signature on the refund commitment
      const refundTx = txFromSignedCommitment(record.refundCommitment);
      const providerSigValid = verifyCommitmentSig(
        refundTx, providerSig, record.params.providerPubkey, record.funding.redeemScript
      );
      if (!providerSigValid) {
        throw new Error('Invalid provider signature on refund commitment');
      }

      // Add provider signature
      record.refundCommitment.providerSig = providerSig;
      record.refundCommitment.isComplete = true;
      record.latestCommitment = record.refundCommitment;
      record.state = ChannelState.OPEN;
      record.updatedAt = Date.now();

      await this.storage.save(record);

      return record;
    });
  }

  /**
   * Create a payment (new commitment).
   * Locked to prevent concurrent payment creation on the same channel.
   */
  async createPayment(
    id: string,
    paymentKoinu: number,
    providerAddress: string
  ): Promise<{
    state: CommitmentState;
    consumerSig: Buffer;
  }> {
    return this.storage.withLock(id, async () => {
      const record = await this.storage.load(id);
      if (!record || record.state !== ChannelState.OPEN || !record.funding || !record.latestCommitment) {
        throw new Error(`Channel not open: ${id}`);
      }

      // Create next commitment
      const { state, tx } = createNextCommitment(
        record.params,
        record.funding,
        record.latestCommitment,
        paymentKoinu,
        this.address,
        providerAddress
      );

      // Sign it
      const consumerSig = this.signCommitmentTx(tx, record.funding);

      return { state, consumerSig };
    });
  }

  /**
   * Accept provider's signature for a payment and update state.
   * Locked per-channel.
   */
  async acceptPaymentSignature(
    id: string,
    state: CommitmentState,
    providerSig: Buffer,
    providerAddress: string
  ): Promise<ChannelRecord> {
    return this.storage.withLock(id, async () => {
      const record = await this.storage.load(id);
      if (!record || !record.funding) {
        throw new Error(`Channel not found: ${id}`);
      }

      if (record.state !== ChannelState.OPEN) {
        throw new Error(`Channel not in OPEN state: ${record.state}`);
      }

      // Validate sequence continuity
      if (record.latestCommitment && state.sequence !== record.latestCommitment.sequence + 1) {
        throw new Error(
          `Sequence mismatch: expected ${record.latestCommitment.sequence + 1}, got ${state.sequence}`
        );
      }

      // Rebuild transaction
      const { tx } = createNextCommitment(
        record.params,
        record.funding,
        record.latestCommitment!,
        state.providerBalance - (record.latestCommitment?.providerBalance || 0),
        this.address,
        providerAddress
      );

      // Verify provider's signature before accepting
      const providerSigValid = verifyCommitmentSig(
        tx, providerSig, record.params.providerPubkey, record.funding.redeemScript
      );
      if (!providerSigValid) {
        throw new Error('Invalid provider signature on payment commitment');
      }

      // Sign it
      const consumerSig = this.signCommitmentTx(tx, record.funding);

      // Update record
      record.latestCommitment = createSignedCommitment(state, tx, consumerSig, providerSig);
      record.updatedAt = Date.now();

      await this.storage.save(record);

      return record;
    });
  }

  /**
   * Initiate cooperative close.
   * Locked per-channel.
   */
  async initiateCooperativeClose(
    id: string,
    providerAddress: string
  ): Promise<{
    closeTx: typeof Transaction;
    consumerSig: Buffer;
  }> {
    return this.storage.withLock(id, async () => {
      const record = await this.storage.load(id);
      if (!record || record.state !== ChannelState.OPEN || !record.funding || !record.latestCommitment) {
        throw new Error(`Channel not open: ${id}`);
      }

      const closeTx = buildCooperativeCloseTx(
        record.params,
        record.funding,
        record.latestCommitment,
        this.address,
        providerAddress
      );

      const consumerSig = this.signCommitmentTx(closeTx, record.funding);

      record.state = ChannelState.CLOSING;
      record.updatedAt = Date.now();
      await this.storage.save(record);

      return { closeTx, consumerSig };
    });
  }

  /**
   * Complete cooperative close with provider's signature.
   * Locked per-channel. Uses checked serialization for broadcast.
   */
  async completeCooperativeClose(
    id: string,
    providerSig: Buffer,
    providerAddress: string
  ): Promise<{ closeTxHex: string; closeTxId: string }> {
    return this.storage.withLock(id, async () => {
      const record = await this.storage.load(id);
      if (!record || !record.funding || !record.latestCommitment) {
        throw new Error(`Channel not found: ${id}`);
      }

      const closeTx = buildCooperativeCloseTx(
        record.params,
        record.funding,
        record.latestCommitment,
        this.address,
        providerAddress
      );

      const consumerSig = this.signCommitmentTx(closeTx, record.funding);

      // Verify provider's close signature
      const providerSigValid = verifyCommitmentSig(
        closeTx, providerSig, record.params.providerPubkey, record.funding.redeemScript
      );
      if (!providerSigValid) {
        throw new Error('Invalid provider signature on cooperative close');
      }

      // Complete with both signatures
      completeCommitment(
        closeTx,
        consumerSig,
        providerSig,
        record.funding.redeemScript,
        record.params.consumerPubkey,
        record.params.providerPubkey
      );

      const closeTxHex = serializeForBroadcast(closeTx);
      const closeTxId = closeTx.id;

      record.state = ChannelState.CLOSED_COOPERATIVE;
      record.closeTxId = closeTxId;
      record.updatedAt = Date.now();
      await this.storage.save(record);

      return { closeTxHex, closeTxId };
    });
  }

  /**
   * Unilateral close (broadcast latest commitment).
   * Locked per-channel.
   */
  async unilateralClose(id: string): Promise<{ closeTxHex: string; closeTxId: string }> {
    return this.storage.withLock(id, async () => {
      const record = await this.storage.load(id);
      if (!record || !record.latestCommitment?.isComplete) {
        throw new Error(`No complete commitment to broadcast: ${id}`);
      }

      const closeTxHex = record.latestCommitment.txHex;
      const closeTxId = new Transaction(closeTxHex).id;

      record.state = ChannelState.CLOSED_UNILATERAL_CONSUMER;
      record.closeTxId = closeTxId;
      record.updatedAt = Date.now();
      await this.storage.save(record);

      return { closeTxHex, closeTxId };
    });
  }
}

// ---------------------------------------------------------------------------
// Provider Manager
// ---------------------------------------------------------------------------

/**
 * Channel manager for provider
 */
export class ChannelProviderManager extends BaseChannelManager {
  constructor(
    storage: ChannelStorage,
    providerPubkey: Buffer,
    providerPrivkey: Buffer,
    providerAddress: string
  ) {
    super(storage, providerPubkey, providerPrivkey, providerAddress);
  }

  /**
   * Accept a channel from consumer
   */
  async acceptChannel(params: {
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
  }> {
    const { channelId, consumerPubkey, depositKoinu, ttlBlocks, timelockGap, openBlock, fundingTxId, fundingOutputIndex } = params;

    // Validate deposit
    if (depositKoinu < CHANNEL_DEFAULTS.minDepositKoinu) {
      throw new Error(`Deposit too small: min ${CHANNEL_DEFAULTS.minDepositKoinu} koinu`);
    }
    if (depositKoinu > CHANNEL_DEFAULTS.maxDepositKoinu) {
      throw new Error(`Deposit too large: max ${CHANNEL_DEFAULTS.maxDepositKoinu} koinu`);
    }

    // Validate timelockGap
    if (timelockGap <= 0) {
      throw new Error('timelockGap must be positive');
    }

    // Validate funding txId format
    if (!/^[0-9a-fA-F]{64}$/.test(fundingTxId)) {
      throw new Error('Invalid funding txId: must be 64 hex characters');
    }

    // Create channel params
    const channelParams: ChannelParams = {
      channelId,
      consumerPubkey,
      providerPubkey: this.pubkey,
      ttlBlocks,
      openBlock,
      timelockGap,
    };

    // Create multisig
    const multisig = createMultisig(consumerPubkey, this.pubkey);

    // Create funding info
    const funding: ChannelFunding = {
      fundingTxId,
      fundingOutputIndex,
      depositKoinu,
      redeemScript: multisig.redeemScript,
      p2shAddress: multisig.p2shAddress,
    };

    // Create record
    const record: ChannelRecord = {
      id: randomBytes(16).toString('hex'),
      state: ChannelState.FUNDING_PENDING,
      params: channelParams,
      funding,
      role: 'provider',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this.storage.save(record);

    return { record, multisig };
  }

  /**
   * Sign refund commitment and return signature.
   * Locked per-channel.
   */
  async signRefundCommitment(
    id: string,
    consumerSig: Buffer,
    consumerAddress: string
  ): Promise<{
    record: ChannelRecord;
    providerSig: Buffer;
  }> {
    return this.storage.withLock(id, async () => {
      const record = await this.storage.load(id);
      if (!record || !record.funding) {
        throw new Error(`Channel not found: ${id}`);
      }
      if (record.state !== ChannelState.CREATED && record.state !== ChannelState.FUNDING_PENDING) {
        throw new Error(`Channel not in expected state for refund signing: ${record.state}`);
      }

      // Create initial/refund commitment
      const { state, tx } = createInitialCommitment(
        record.params,
        record.funding,
        consumerAddress,
        this.address
      );

      // Verify consumer's signature before accepting
      const consumerSigValid = verifyCommitmentSig(
        tx, consumerSig, record.params.consumerPubkey, record.funding.redeemScript
      );
      if (!consumerSigValid) {
        throw new Error('Invalid consumer signature on refund commitment');
      }

      // Sign it
      const providerSig = this.signCommitmentTx(tx, record.funding);

      // Store commitment
      record.refundCommitment = createSignedCommitment(state, tx, consumerSig, providerSig);
      record.latestCommitment = record.refundCommitment;
      record.state = ChannelState.OPEN;
      record.updatedAt = Date.now();

      await this.storage.save(record);

      return { record, providerSig };
    });
  }

  /**
   * Accept a payment and return signature.
   * Locked per-channel.
   */
  async acceptPayment(
    id: string,
    state: CommitmentState,
    consumerSig: Buffer,
    consumerAddress: string
  ): Promise<{
    providerSig: Buffer;
    record: ChannelRecord;
  }> {
    return this.storage.withLock(id, async () => {
      const record = await this.storage.load(id);
      if (!record || record.state !== ChannelState.OPEN || !record.funding || !record.latestCommitment) {
        throw new Error(`Channel not open: ${id}`);
      }

      // Validate state transition
      if (state.sequence !== record.latestCommitment.sequence + 1) {
        throw new Error('Invalid sequence number');
      }
      if (state.consumerBalance + state.providerBalance !== record.funding.depositKoinu) {
        throw new Error('Balance mismatch');
      }
      if (state.providerBalance <= record.latestCommitment.providerBalance) {
        throw new Error('Provider balance must increase');
      }

      // Build and sign the commitment
      const paymentKoinu = state.providerBalance - record.latestCommitment.providerBalance;
      const { tx } = createNextCommitment(
        record.params,
        record.funding,
        record.latestCommitment,
        paymentKoinu,
        consumerAddress,
        this.address
      );

      // Verify consumer's signature
      const consumerSigValid = verifyCommitmentSig(
        tx, consumerSig, record.params.consumerPubkey, record.funding.redeemScript
      );
      if (!consumerSigValid) {
        throw new Error('Invalid consumer signature on payment commitment');
      }

      const providerSig = this.signCommitmentTx(tx, record.funding);

      // Update record
      record.latestCommitment = createSignedCommitment(state, tx, consumerSig, providerSig);
      record.updatedAt = Date.now();
      await this.storage.save(record);

      return { providerSig, record };
    });
  }

  /**
   * Sign cooperative close.
   * Locked per-channel. Uses checked serialization for broadcast.
   */
  async signCooperativeClose(
    id: string,
    consumerAddress: string
  ): Promise<{
    providerSig: Buffer;
    closeTxHex: string;
    closeTxId: string;
  }> {
    return this.storage.withLock(id, async () => {
      const record = await this.storage.load(id);
      if (!record || !record.funding || !record.latestCommitment) {
        throw new Error(`Channel not found: ${id}`);
      }

      const closeTx = buildCooperativeCloseTx(
        record.params,
        record.funding,
        record.latestCommitment,
        consumerAddress,
        this.address
      );

      const providerSig = this.signCommitmentTx(closeTx, record.funding);
      const closeTxHex = serializeForBroadcast(closeTx);
      const closeTxId = closeTx.id;

      record.state = ChannelState.CLOSED_COOPERATIVE;
      record.closeTxId = closeTxId;
      record.updatedAt = Date.now();
      await this.storage.save(record);

      return { providerSig, closeTxHex, closeTxId };
    });
  }

  /**
   * Unilateral close (broadcast latest commitment).
   * Locked per-channel.
   */
  async unilateralClose(id: string): Promise<{ closeTxHex: string; closeTxId: string }> {
    return this.storage.withLock(id, async () => {
      const record = await this.storage.load(id);
      if (!record || !record.latestCommitment?.isComplete) {
        throw new Error(`No complete commitment to broadcast: ${id}`);
      }

      const closeTxHex = record.latestCommitment.txHex;
      const closeTxId = new Transaction(closeTxHex).id;

      record.state = ChannelState.CLOSED_UNILATERAL_PROVIDER;
      record.closeTxId = closeTxId;
      record.updatedAt = Date.now();
      await this.storage.save(record);

      return { closeTxHex, closeTxId };
    });
  }
}
