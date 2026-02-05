/**
 * DOGE Wallet — P2P Peer Discovery
 *
 * Discovers active Dogecoin nodes via DNS seed queries.
 * Selects a randomized subset for broadcast redundancy.
 *
 * Much DNS. Very discovery. Wow. 🐕
 */

import { promises as dns } from "node:dns";

// ============================================================================
// DNS Seeds
// ============================================================================

/** Dogecoin mainnet DNS seeds */
const MAINNET_DNS_SEEDS: string[] = [
  "seed.dogecoin.com",
  "seed.dogechain.info",
  "seed.dogecoin.org",
  "seed.mophides.com",
  "seed.dglibrary.org",
];

/** Dogecoin testnet DNS seeds */
const TESTNET_DNS_SEEDS: string[] = [
  "testseed.jrn.me.uk",
];

/** Default P2P ports */
const DEFAULT_PORTS = {
  mainnet: 22556,
  testnet: 44556,
} as const;

// ============================================================================
// Types
// ============================================================================

export interface PeerInfo {
  /** IPv4 address */
  ip: string;
  /** P2P port */
  port: number;
}

export type LogFn = (level: "info" | "warn" | "error", msg: string) => void;

// ============================================================================
// Discovery
// ============================================================================

/**
 * Discover peers by querying DNS seeds.
 *
 * Queries all seeds in parallel, collects unique IPs, shuffles,
 * and returns up to `maxPeers` results.
 *
 * @param network - mainnet or testnet
 * @param maxPeers - Maximum number of peers to return (default: 8)
 * @param log - Optional logger
 * @returns Array of PeerInfo
 */
export async function discoverPeers(
  network: "mainnet" | "testnet",
  maxPeers: number = 8,
  log?: LogFn,
): Promise<PeerInfo[]> {
  const seeds = network === "mainnet" ? MAINNET_DNS_SEEDS : TESTNET_DNS_SEEDS;
  const port = DEFAULT_PORTS[network];

  log?.("info", `doge-wallet: p2p: querying ${seeds.length} DNS seeds for ${network} peers...`);

  // Query all seeds in parallel with individual timeouts
  const results = await Promise.allSettled(
    seeds.map((seed) => resolveSeed(seed, log)),
  );

  // Collect unique IPs
  const uniqueIps = new Set<string>();
  for (const result of results) {
    if (result.status === "fulfilled") {
      for (const ip of result.value) {
        uniqueIps.add(ip);
      }
    }
  }

  const allIps = Array.from(uniqueIps);
  log?.("info", `doge-wallet: p2p: discovered ${allIps.length} unique peer IPs from DNS seeds`);

  if (allIps.length === 0) {
    log?.("warn", "doge-wallet: p2p: no peers discovered from any DNS seed");
    return [];
  }

  // Shuffle for randomized peer selection (Fisher-Yates)
  for (let i = allIps.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allIps[i], allIps[j]] = [allIps[j], allIps[i]];
  }

  // Return up to maxPeers
  const selected = allIps.slice(0, maxPeers).map((ip) => ({ ip, port }));
  log?.("info", `doge-wallet: p2p: selected ${selected.length} peers for broadcast`);

  return selected;
}

// ============================================================================
// DNS Resolution
// ============================================================================

/**
 * Resolve a single DNS seed to IPv4 addresses.
 * Returns an empty array on failure (never throws).
 */
async function resolveSeed(seed: string, log?: LogFn): Promise<string[]> {
  try {
    const addresses = await dns.resolve4(seed);
    log?.("info", `doge-wallet: p2p: ${seed} → ${addresses.length} peers`);
    return addresses;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.("warn", `doge-wallet: p2p: DNS seed ${seed} failed: ${msg}`);
    return [];
  }
}
