/**
 * DOGE Wallet — Type Definitions
 *
 * All TypeScript interfaces for the Dogecoin wallet plugin.
 * Much types. Very strict. Wow. 🐕
 */
export const DOGE_MAINNET = {
    messagePrefix: "\x19Dogecoin Signed Message:\n",
    bech32: "",
    bip32: {
        public: 0x02facafd, // dgub
        private: 0x02fac398, // dgpv
    },
    pubKeyHash: 0x1e, // D... addresses
    scriptHash: 0x16, // 9... or A... addresses
    wif: 0x9e,
};
export const DOGE_TESTNET = {
    messagePrefix: "\x19Dogecoin Signed Message:\n",
    bech32: "",
    bip32: {
        public: 0x0432a9a8, // tgub
        private: 0x0432a243, // tgpv
    },
    pubKeyHash: 0x71, // n... addresses
    scriptHash: 0xc4,
    wif: 0xf1,
};
// ============================================================================
// Constants
// ============================================================================
/** 1 DOGE = 100,000,000 koinu */
export const KOINU_PER_DOGE = 100_000_000;
/** Convert DOGE to koinu */
export function dogeToKoinu(doge) {
    return Math.round(doge * KOINU_PER_DOGE);
}
/** Convert koinu to DOGE */
export function koinuToDoge(koinu) {
    return koinu / KOINU_PER_DOGE;
}
//# sourceMappingURL=types.js.map