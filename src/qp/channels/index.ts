/**
 * Payment Channels Module
 * 2-of-2 Multisig Channels with Time-Decaying Commitments
 */

// Types
export * from './types.js';

// Multisig
export {
  build2of2RedeemScript,
  sortPubkeys,
  createMultisig,
  buildMultisigScriptSig,
  parseMultisigScript,
  getSignatureOrder,
} from './multisig.js';

// Commitment transactions
export {
  calculateTimelock,
  maxChannelCalls,
  buildCommitmentTx,
  signCommitment,
  verifyCommitmentSig,
  completeCommitment,
  createInitialCommitment,
  createNextCommitment,
  createSignedCommitment,
  txFromSignedCommitment,
  buildCooperativeCloseTx,
} from './commitment.js';

// Channel management
export {
  ChannelStorage,
  InMemoryChannelStorage,
  ChannelConsumerManager,
  ChannelProviderManager,
} from './manager.js';
