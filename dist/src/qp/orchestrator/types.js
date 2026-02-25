/**
 * QP Orchestrator Types
 * Lifecycle coordination for the Quackstro Protocol
 */
// ---------------------------------------------------------------------------
// Call lifecycle
// ---------------------------------------------------------------------------
/** Lifecycle state for a single service call */
export var CallState;
(function (CallState) {
    CallState["DISCOVERING"] = "discovering";
    CallState["HANDSHAKING"] = "handshaking";
    CallState["CONNECTING"] = "connecting";
    CallState["REQUESTING"] = "requesting";
    CallState["AWAITING_DELIVERY"] = "awaiting_delivery";
    CallState["PAYING"] = "paying";
    CallState["RATING"] = "rating";
    CallState["COMPLETE"] = "complete";
    CallState["FAILED"] = "failed";
})(CallState || (CallState = {}));
//# sourceMappingURL=types.js.map