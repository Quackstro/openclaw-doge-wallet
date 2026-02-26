/**
 * Payment Channel Types
 * 2-of-2 Multisig Channels with Time-Decaying Commitments
 */
export var ChannelState;
(function (ChannelState) {
    /** Channel parameters agreed, not yet funded */
    ChannelState["CREATED"] = "created";
    /** Funding tx broadcast, awaiting confirmation */
    ChannelState["FUNDING_PENDING"] = "funding_pending";
    /** Channel is open and active */
    ChannelState["OPEN"] = "open";
    /** Close initiated, awaiting confirmation */
    ChannelState["CLOSING"] = "closing";
    /** Channel closed cooperatively */
    ChannelState["CLOSED_COOPERATIVE"] = "closed_cooperative";
    /** Channel closed unilaterally by consumer */
    ChannelState["CLOSED_UNILATERAL_CONSUMER"] = "closed_unilateral_consumer";
    /** Channel closed unilaterally by provider */
    ChannelState["CLOSED_UNILATERAL_PROVIDER"] = "closed_unilateral_provider";
    /** Channel closed due to timeout */
    ChannelState["CLOSED_TIMEOUT"] = "closed_timeout";
    /** Channel in dispute */
    ChannelState["DISPUTED"] = "disputed";
})(ChannelState || (ChannelState = {}));
/** Dust threshold — outputs below this are unspendable (0.01 DOGE) */
export const DUST_THRESHOLD_KOINU = 1_000_000;
/** Default cooperative close fee (0.01 DOGE) */
export const DEFAULT_CLOSE_FEE_KOINU = 1_000_000;
/** Default channel configuration */
export const CHANNEL_DEFAULTS = {
    /** Minimum 5 DOGE deposit */
    minDepositKoinu: 500_000_000,
    /** Maximum 10,000 DOGE deposit */
    maxDepositKoinu: 1_000_000_000_000,
    /** 72 hours at 1 block/min */
    defaultTtlBlocks: 4320,
    /** 10 blocks (~10 minutes) between commitment timelocks */
    defaultTimelockGap: 10,
    /** Maximum 10 concurrent channels */
    maxConcurrentChannels: 10,
};
//# sourceMappingURL=types.js.map