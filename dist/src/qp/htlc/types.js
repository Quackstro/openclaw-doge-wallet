/**
 * HTLC Types for Quackstro Protocol
 * Hash Time-Locked Contracts on Dogecoin
 */
export var HTLCState;
(function (HTLCState) {
    /** HTLC created but not funded */
    HTLCState["CREATED"] = "created";
    /** Funding tx broadcast, awaiting confirmation */
    HTLCState["FUNDING_PENDING"] = "funding_pending";
    /** Funding tx confirmed, HTLC is active */
    HTLCState["ACTIVE"] = "active";
    /** Provider claimed with secret */
    HTLCState["CLAIMED"] = "claimed";
    /** Consumer refunded after timeout */
    HTLCState["REFUNDED"] = "refunded";
    /** HTLC expired (timeout passed, not yet refunded) */
    HTLCState["EXPIRED"] = "expired";
})(HTLCState || (HTLCState = {}));
/** Default HTLC parameters */
export const HTLC_DEFAULTS = {
    /** Default timeout in blocks (~30 minutes) */
    TIMEOUT_BLOCKS: 30,
    /** Default fee buffer in koinu (0.01 DOGE) */
    FEE_BUFFER_KOINU: 1_000_000,
    /** Minimum tool price in koinu (0.001 DOGE) */
    MIN_PRICE_KOINU: 100_000,
    /** Maximum tool price in koinu (~42.9 DOGE, uint32 max) */
    MAX_PRICE_KOINU: 4_294_967_295,
    /** Secret size in bytes */
    SECRET_SIZE: 32,
    /** Hash size in bytes (HASH160 output) */
    HASH_SIZE: 20,
};
//# sourceMappingURL=types.js.map