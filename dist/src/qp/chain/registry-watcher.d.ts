/**
 * Registry Watcher
 * Monitors QP registry addresses for SERVICE_ADVERTISE messages
 * and maintains a local service directory.
 */
import type { DogeApiProvider } from '../../types.js';
import type { ServiceListing, WatcherState, WatcherOptions, ChainStatus } from './types.js';
/**
 * In-memory service directory
 */
export declare class ServiceDirectory {
    private listings;
    /** Add or update a listing */
    add(listing: ServiceListing): void;
    /** Remove a listing by txid */
    remove(txid: string): void;
    /** Get a listing by txid */
    get(txid: string): ServiceListing | undefined;
    /** Get all active listings (not expired) */
    getActive(currentBlock: number): ServiceListing[];
    /** Search by skill code */
    findBySkill(skillCode: number, currentBlock: number): ServiceListing[];
    /** Search by provider address (optionally filter expired) */
    findByProvider(address: string, currentBlock?: number): ServiceListing[];
    /** Prune expired listings */
    pruneExpired(currentBlock: number): number;
    /** Get total count */
    get size(): number;
    /** Export all listings (for persistence) */
    toArray(): ServiceListing[];
    /** Import listings (from persistence) */
    loadFrom(listings: ServiceListing[]): void;
    /** Clear all */
    clear(): void;
}
export declare class RegistryWatcher {
    private provider;
    private state;
    private directory;
    private options;
    private minScanIntervalMs;
    /** Track processed revocation txids to avoid re-processing (bounded) */
    private processedRevocations;
    private static readonly MAX_PROCESSED_REVOCATIONS;
    constructor(provider: DogeApiProvider, directory?: ServiceDirectory, options?: WatcherOptions & {
        minScanIntervalMs?: number;
    });
    /** Get the service directory */
    getDirectory(): ServiceDirectory;
    /** Get current watcher state */
    getState(): WatcherState;
    /** Restore watcher state (e.g. from disk) */
    restoreState(state: WatcherState): void;
    /**
     * Scan all configured registry addresses for new advertisements.
     * Returns newly discovered listings.
     * Respects minScanIntervalMs to avoid API rate limiting.
     */
    scan(): Promise<ServiceListing[]>;
    /**
     * Also check for REVOKE_SERVICE messages and remove listings
     */
    scanRevocations(): Promise<string[]>;
    /**
     * Get current chain status
     */
    getChainStatus(): Promise<ChainStatus>;
    /**
     * Prune expired listings based on current block height
     */
    pruneExpired(): Promise<number>;
}
//# sourceMappingURL=registry-watcher.d.ts.map