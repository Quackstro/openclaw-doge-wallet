/**
 * Chain Integration Module Exports
 * OP_RETURN scanning, registry watching, and transaction building
 */

// Types
export * from './types.js';

// OP_RETURN scanner
export {
  extractOpReturn,
  extractAllOpReturns,
  decodeQPFromTx,
  scanAddress,
  scanTransaction,
} from './scanner.js';

// Registry watcher + service directory
export {
  ServiceDirectory,
  RegistryWatcher,
} from './registry-watcher.js';

// Transaction builder
export {
  buildAdvertiseOpReturn,
  buildAdvertiseTx,
  buildRatingOpReturn,
  buildRatingTx,
  signTx,
  serializeTx,
  broadcastTx,
} from './tx-builder.js';

export type {
  AdvertiseParams,
  RatingParams,
} from './tx-builder.js';
