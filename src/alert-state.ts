/**
 * DOGE Wallet — Low Balance Alert State Manager
 *
 * Tracks dismiss/snooze state for low balance notifications.
 * Persists to disk so state survives restarts.
 *
 * Much state. Very remember. Wow. 🐕
 */

import { readFile } from 'node:fs/promises';
import { secureWriteFile } from './secure-fs.js';
import { join } from 'node:path';

// ============================================================================
// Types
// ============================================================================

export interface LowBalanceAlertState {
  /** User dismissed the alert — don't notify until balance recovers */
  dismissed: boolean;
  /** Timestamp (ms) when snooze expires, null if not snoozed */
  snoozedUntil: number | null;
  /** Last balance when we decided to alert (to detect recovery) */
  lastAlertedBalance: number | null;
  /** Threshold that was active when dismissed (for reset detection) */
  dismissedAtThreshold: number | null;
  /** Timestamp (ms) when last notification was sent */
  lastNotifiedAt: number | null;
}

const DEFAULT_STATE: LowBalanceAlertState = {
  dismissed: false,
  snoozedUntil: null,
  lastAlertedBalance: null,
  dismissedAtThreshold: null,
  lastNotifiedAt: null,
};

// ============================================================================
// AlertStateManager
// ============================================================================

export class AlertStateManager {
  private readonly statePath: string;
  private state: LowBalanceAlertState = { ...DEFAULT_STATE };
  private loaded = false;
  private readonly log: (level: 'info' | 'warn' | 'error', msg: string) => void;

  constructor(
    dataDir: string,
    log?: (level: 'info' | 'warn' | 'error', msg: string) => void,
  ) {
    this.statePath = join(dataDir, 'alert-state.json');
    this.log = log ?? (() => {});
  }

  // --------------------------------------------------------------------------
  // State Persistence
  // --------------------------------------------------------------------------

  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      const data = await readFile(this.statePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.state = {
        dismissed: parsed.dismissed ?? false,
        snoozedUntil: parsed.snoozedUntil ?? null,
        lastAlertedBalance: parsed.lastAlertedBalance ?? null,
        dismissedAtThreshold: parsed.dismissedAtThreshold ?? null,
        lastNotifiedAt: parsed.lastNotifiedAt ?? null,
      };
      this.loaded = true;
      this.log('info', 'doge-wallet: loaded alert state');
    } catch (err: unknown) {
      // File doesn't exist or is invalid — use default
      this.state = { ...DEFAULT_STATE };
      this.loaded = true;
    }
  }

  private async save(): Promise<void> {
    try {
      await secureWriteFile(this.statePath, JSON.stringify(this.state, null, 2));
    } catch (err: unknown) {
      this.log('warn', `doge-wallet: failed to save alert state: ${(err as Error).message}`);
    }
  }

  // --------------------------------------------------------------------------
  // State Queries
  // --------------------------------------------------------------------------

  /**
   * Check if we should send a low balance alert.
   * Returns false if dismissed or currently snoozed.
   * Note: Does NOT check the interval — use shouldAlertWithInterval for that.
   */
  shouldAlert(): boolean {
    // If dismissed, don't alert
    if (this.state.dismissed) {
      return false;
    }

    // If snoozed and snooze hasn't expired, don't alert
    if (this.state.snoozedUntil !== null) {
      if (Date.now() < this.state.snoozedUntil) {
        return false;
      }
      // Snooze expired — clear it
      this.state.snoozedUntil = null;
      this.save().catch(() => {});
    }

    return true;
  }

  /**
   * Check if we should send a low balance alert, including interval check.
   * @param intervalHours Hours between notifications (0 = no rate limiting)
   */
  shouldAlertWithInterval(intervalHours: number): boolean {
    // First check dismiss/snooze state
    if (!this.shouldAlert()) {
      return false;
    }

    // If interval is 0, no rate limiting
    if (intervalHours <= 0) {
      return true;
    }

    // Check if enough time has passed since last notification
    const intervalMs = intervalHours * 60 * 60 * 1000;
    const now = Date.now();
    if (this.state.lastNotifiedAt !== null && (now - this.state.lastNotifiedAt) < intervalMs) {
      return false;
    }

    return true;
  }

  /**
   * Get time until next allowed notification.
   * @param intervalHours Hours between notifications
   * @returns Milliseconds until next alert, or 0 if allowed now
   */
  getTimeUntilNextAlert(intervalHours: number): number {
    if (intervalHours <= 0 || this.state.lastNotifiedAt === null) {
      return 0;
    }
    const intervalMs = intervalHours * 60 * 60 * 1000;
    const elapsed = Date.now() - this.state.lastNotifiedAt;
    return Math.max(0, intervalMs - elapsed);
  }

  /**
   * Get current state (for debugging/status).
   */
  getState(): Readonly<LowBalanceAlertState> {
    return { ...this.state };
  }

  // --------------------------------------------------------------------------
  // State Mutations
  // --------------------------------------------------------------------------

  /**
   * Mark the alert as dismissed.
   * Won't alert again until balance recovers above threshold.
   */
  async dismiss(currentBalance: number, threshold: number): Promise<void> {
    this.state.dismissed = true;
    this.state.snoozedUntil = null;
    this.state.lastAlertedBalance = currentBalance;
    this.state.dismissedAtThreshold = threshold;
    await this.save();
    this.log('info', 'doge-wallet: low balance alert dismissed');
  }

  /**
   * Snooze the alert for a duration.
   */
  async snooze(durationMs: number, currentBalance: number): Promise<void> {
    this.state.snoozedUntil = Date.now() + durationMs;
    this.state.lastAlertedBalance = currentBalance;
    await this.save();
    const hours = durationMs / (60 * 60 * 1000);
    this.log('info', `doge-wallet: low balance alert snoozed for ${hours}h`);
  }

  /**
   * Record that we sent an alert (for tracking purposes).
   */
  async recordAlert(balance: number): Promise<void> {
    this.state.lastAlertedBalance = balance;
    this.state.lastNotifiedAt = Date.now();
    await this.save();
  }

  /**
   * Check if balance recovered above threshold and reset dismissed state.
   * Call this when balance is checked/updated.
   * Returns true if state was reset (balance recovered).
   */
  async checkRecovery(currentBalance: number, threshold: number): Promise<boolean> {
    // Only reset if previously dismissed AND balance is now above threshold
    if (this.state.dismissed && currentBalance >= threshold) {
      this.state.dismissed = false;
      this.state.snoozedUntil = null;
      this.state.lastAlertedBalance = null;
      this.state.dismissedAtThreshold = null;
      await this.save();
      this.log('info', 'doge-wallet: balance recovered — alert state reset');
      return true;
    }
    return false;
  }

  /**
   * Force reset all state (for testing/manual reset).
   */
  async reset(): Promise<void> {
    this.state = { ...DEFAULT_STATE };
    await this.save();
    this.log('info', 'doge-wallet: alert state reset');
  }
}

// ============================================================================
// Snooze Durations
// ============================================================================

export const SNOOZE_DURATIONS = {
  '1h': 60 * 60 * 1000,        // 1 hour in ms
  '24h': 24 * 60 * 60 * 1000,  // 24 hours in ms
} as const;

export type SnoozeDuration = keyof typeof SNOOZE_DURATIONS;
