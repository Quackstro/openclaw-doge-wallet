/**
 * DOGE Wallet — Load Testing Script
 *
 * Stress tests various wallet components to ensure they perform well
 * under heavy load. Tests include:
 * - UTXO management with 1000+ UTXOs
 * - Coin selection with large UTXO sets
 * - Invoice creation/lookup performance
 * - Rate limiter behavior
 *
 * Run: npx tsx src/tests/load-test.ts
 *
 * Much stress. Very performance. Wow. 🐕
 */
interface TestResult {
    name: string;
    passed: boolean;
    durationMs: number;
    opsPerSecond?: number;
    details?: string;
    error?: string;
}
declare function testUtxoManagerPerformance(): Promise<TestResult>;
declare function testCoinSelectionPerformance(): Promise<TestResult>;
declare function runAllTests(): Promise<void>;
export { runAllTests, testUtxoManagerPerformance, testCoinSelectionPerformance };
//# sourceMappingURL=load-test.d.ts.map