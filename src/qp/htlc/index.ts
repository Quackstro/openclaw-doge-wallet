/**
 * HTLC Module Exports
 * Hash Time-Locked Contracts for Quackstro Protocol
 */

// Types
export * from './types.js';

// Script building
export {
  buildRedeemScript,
  createHTLC,
  buildClaimScriptSig,
  buildRefundScriptSig,
  parseRedeemScript,
  verifySecret,
  generateSecret,
  hashSecret,
} from './script.js';

// Transaction building
export {
  createHtlcOfferOpReturn,
  createHtlcClaimOpReturn,
  buildFundingTransaction,
  buildClaimTransaction,
  buildRefundTransaction,
  serializeTransaction,
  getTransactionId,
  estimateFee,
  TX_SIZE_ESTIMATES,
} from './transactions.js';

// Lifecycle management
export {
  HTLCStorage,
  InMemoryHTLCStorage,
  HTLCProviderManager,
  HTLCConsumerManager,
} from './manager.js';
