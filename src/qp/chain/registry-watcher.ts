/**
 * Registry Watcher
 * Monitors QP registry addresses for SERVICE_ADVERTISE messages
 * and maintains a local service directory.
 */

import { QPMessageType } from '../types.js';
import type { ServiceAdvertisePayload } from '../types.js';
import { REGISTRY_ADDRESSES, isRegistryAddress } from '../registry.js';
import type { DogeApiProvider } from '../../types.js';
import { scanAddress } from './scanner.js';
import type {
  ServiceListing,
  WatcherState,
  WatcherOptions,
  ChainStatus,
  OnChainQPMessage,
} from './types.js';

/**
 * Convert a SERVICE_ADVERTISE on-chain message to a ServiceListing
 */
function toServiceListing(msg: OnChainQPMessage): ServiceListing | null {
  if (msg.message.type !== QPMessageType.SERVICE_ADVERTISE) return null;

  const payload = msg.message.payload as ServiceAdvertisePayload;

  const expiresAtBlock = msg.blockHeight
    ? msg.blockHeight + payload.ttlBlocks
    : undefined;

  return {
    txid: msg.txid,
    providerAddress: msg.senderAddress,
    providerPubkey: payload.pubkey,
    skillCode: payload.skillCode,
    priceKoinu: payload.priceKoinu,
    priceUnit: payload.priceUnit,
    flags: payload.flags,
    ttlBlocks: payload.ttlBlocks,
    description: typeof payload.metadata === 'string'
      ? payload.metadata.replace(/\0+$/, '').trim()
      : '',
    blockHeight: msg.blockHeight,
    confirmations: msg.confirmations,
    expiresAtBlock,
    timestamp: msg.timestamp,
  };
}

/**
 * In-memory service directory
 */
export class ServiceDirectory {
  private listings: Map<string, ServiceListing> = new Map();

  /** Add or update a listing */
  add(listing: ServiceListing): void {
    this.listings.set(listing.txid, listing);
  }

  /** Remove a listing by txid */
  remove(txid: string): void {
    this.listings.delete(txid);
  }

  /** Get a listing by txid */
  get(txid: string): ServiceListing | undefined {
    return this.listings.get(txid);
  }

  /** Get all active listings (not expired) */
  getActive(currentBlock: number): ServiceListing[] {
    return Array.from(this.listings.values()).filter(l => {
      if (!l.expiresAtBlock) return true; // No expiry info — keep
      return l.expiresAtBlock > currentBlock;
    });
  }

  /** Search by skill code */
  findBySkill(skillCode: number, currentBlock: number): ServiceListing[] {
    return this.getActive(currentBlock).filter(l => l.skillCode === skillCode);
  }

  /** Search by provider address (optionally filter expired) */
  findByProvider(address: string, currentBlock?: number): ServiceListing[] {
    const all = Array.from(this.listings.values()).filter(
      l => l.providerAddress === address
    );
    if (currentBlock === undefined) return all;
    return all.filter(l => {
      if (!l.expiresAtBlock) return true;
      return l.expiresAtBlock > currentBlock;
    });
  }

  /** Prune expired listings */
  pruneExpired(currentBlock: number): number {
    let count = 0;
    for (const [txid, listing] of this.listings) {
      if (listing.expiresAtBlock && listing.expiresAtBlock <= currentBlock) {
        this.listings.delete(txid);
        count++;
      }
    }
    return count;
  }

  /** Get total count */
  get size(): number {
    return this.listings.size;
  }

  /** Export all listings (for persistence) */
  toArray(): ServiceListing[] {
    return Array.from(this.listings.values());
  }

  /** Import listings (from persistence) */
  loadFrom(listings: ServiceListing[]): void {
    for (const l of listings) {
      this.listings.set(l.txid, l);
    }
  }

  /** Clear all */
  clear(): void {
    this.listings.clear();
  }
}

/**
 * Registry Watcher — scans registry addresses and populates a ServiceDirectory
 */
/** Default minimum interval between scans (60 seconds) */
const DEFAULT_MIN_SCAN_INTERVAL_MS = 60_000;

export class RegistryWatcher {
  private state: WatcherState;
  private directory: ServiceDirectory;
  private options: Required<WatcherOptions>;
  private minScanIntervalMs: number;
  /** Track processed revocation txids to avoid re-processing (bounded) */
  private processedRevocations: Set<string> = new Set();
  private static readonly MAX_PROCESSED_REVOCATIONS = 10_000;

  constructor(
    private provider: DogeApiProvider,
    directory?: ServiceDirectory,
    options?: WatcherOptions & { minScanIntervalMs?: number }
  ) {
    this.directory = directory ?? new ServiceDirectory();
    this.options = {
      categories: options?.categories ?? Object.keys(REGISTRY_ADDRESSES),
      minConfirmations: options?.minConfirmations ?? 1,
      txLimit: options?.txLimit ?? 50,
    };
    this.minScanIntervalMs = options?.minScanIntervalMs ?? DEFAULT_MIN_SCAN_INTERVAL_MS;
    this.state = {
      lastScannedBlock: {},
      lastScanTime: 0,
    };
  }

  /** Get the service directory */
  getDirectory(): ServiceDirectory {
    return this.directory;
  }

  /** Get current watcher state */
  getState(): WatcherState {
    return { ...this.state };
  }

  /** Restore watcher state (e.g. from disk) */
  restoreState(state: WatcherState): void {
    this.state = { ...state };
  }

  /**
   * Scan all configured registry addresses for new advertisements.
   * Returns newly discovered listings.
   * Respects minScanIntervalMs to avoid API rate limiting.
   */
  async scan(): Promise<ServiceListing[]> {
    const now = Date.now();
    const elapsed = now - this.state.lastScanTime;
    if (this.state.lastScanTime > 0 && elapsed < this.minScanIntervalMs) {
      return []; // Too soon — skip scan
    }

    const newListings: ServiceListing[] = [];

    for (const category of this.options.categories) {
      const address = REGISTRY_ADDRESSES[category as keyof typeof REGISTRY_ADDRESSES];
      if (!address) continue;

      const fromBlock = this.state.lastScannedBlock[category] ?? 0;

      const messages = await scanAddress(
        this.provider,
        address,
        this.options.txLimit,
        {
          messageTypes: [QPMessageType.SERVICE_ADVERTISE],
          minConfirmations: this.options.minConfirmations,
          fromBlock: fromBlock > 0 ? fromBlock + 1 : undefined,
        }
      );

      for (const msg of messages) {
        // Skip if we already have this listing
        if (this.directory.get(msg.txid)) continue;

        const listing = toServiceListing(msg);
        if (!listing) continue;

        this.directory.add(listing);
        newListings.push(listing);

        // Always advance block checkpoint regardless of whether listing was new
        if (msg.blockHeight) {
          const prev = this.state.lastScannedBlock[category] ?? 0;
          if (msg.blockHeight > prev) {
            this.state.lastScannedBlock[category] = msg.blockHeight;
          }
        }
      }
    }

    this.state.lastScanTime = Date.now();
    return newListings;
  }

  /**
   * Also check for REVOKE_SERVICE messages and remove listings
   */
  async scanRevocations(): Promise<string[]> {
    const revoked: string[] = [];

    for (const category of this.options.categories) {
      const address = REGISTRY_ADDRESSES[category as keyof typeof REGISTRY_ADDRESSES];
      if (!address) continue;

      const messages = await scanAddress(
        this.provider,
        address,
        this.options.txLimit,
        {
          messageTypes: [QPMessageType.REVOKE_SERVICE],
          minConfirmations: this.options.minConfirmations,
        }
      );

      for (const msg of messages) {
        // Skip already-processed revocations
        if (this.processedRevocations.has(msg.txid)) continue;
        this.processedRevocations.add(msg.txid);

        // A REVOKE_SERVICE from an address removes all that provider's listings
        const providerListings = this.directory.findByProvider(msg.senderAddress);
        for (const listing of providerListings) {
          this.directory.remove(listing.txid);
          revoked.push(listing.txid);
        }
      }
    }

    return revoked;
  }

  /**
   * Get current chain status
   */
  async getChainStatus(): Promise<ChainStatus> {
    const info = await this.provider.getNetworkInfo();
    return {
      blockHeight: info.height,
      feeEstimate: info.feeEstimate,
      provider: this.provider.name,
    };
  }

  /**
   * Prune expired listings based on current block height
   */
  async pruneExpired(): Promise<number> {
    const info = await this.provider.getNetworkInfo();
    return this.directory.pruneExpired(info.height);
  }
}
