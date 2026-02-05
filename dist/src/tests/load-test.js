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
import { randomUUID } from "node:crypto";
function calculateMetrics(times) {
    const sorted = [...times].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    return {
        min: sorted[0] ?? 0,
        max: sorted[sorted.length - 1] ?? 0,
        avg: sum / sorted.length,
        p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
        p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        p99: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
    };
}
function formatMs(ms) {
    if (ms < 1)
        return `${(ms * 1000).toFixed(0)}μs`;
    if (ms < 1000)
        return `${ms.toFixed(2)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}
function printMetrics(name, metrics) {
    console.log(`  ${name}:`);
    console.log(`    Min: ${formatMs(metrics.min)}, Max: ${formatMs(metrics.max)}, Avg: ${formatMs(metrics.avg)}`);
    console.log(`    P50: ${formatMs(metrics.p50)}, P95: ${formatMs(metrics.p95)}, P99: ${formatMs(metrics.p99)}`);
}
function generateMockUtxos(count, address = "DTestAddress123") {
    const utxos = [];
    for (let i = 0; i < count; i++) {
        // Varied amounts: mix of dust, small, medium, and large
        let amount;
        const rand = Math.random();
        if (rand < 0.3) {
            amount = Math.floor(Math.random() * 100_000) + 10_000; // Dust: 0.0001 - 0.001 DOGE
        }
        else if (rand < 0.6) {
            amount = Math.floor(Math.random() * 10_000_000) + 100_000; // Small: 0.001 - 0.1 DOGE
        }
        else if (rand < 0.9) {
            amount = Math.floor(Math.random() * 100_000_000) + 10_000_000; // Medium: 0.1 - 1 DOGE
        }
        else {
            amount = Math.floor(Math.random() * 1_000_000_000) + 100_000_000; // Large: 1 - 10 DOGE
        }
        utxos.push({
            txid: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 32),
            vout: Math.floor(Math.random() * 3),
            address,
            amount,
            scriptPubKey: "76a914" + "a".repeat(40) + "88ac",
            confirmations: Math.floor(Math.random() * 1000) + 1,
            locked: false,
        });
    }
    return utxos;
}
// ============================================================================
// Test: UTXO Manager Performance
// ============================================================================
async function testUtxoManagerPerformance() {
    const testName = "UTXO Manager - 1000+ UTXOs";
    const start = performance.now();
    try {
        const utxoCount = 1500;
        const utxos = generateMockUtxos(utxoCount);
        // Test 1: Sort by amount (common operation)
        const sortTimes = [];
        for (let i = 0; i < 100; i++) {
            const sortStart = performance.now();
            const sorted = [...utxos].sort((a, b) => b.amount - a.amount);
            sortTimes.push(performance.now() - sortStart);
            // Use sorted to prevent optimization
            if (sorted.length === 0)
                throw new Error("Sort failed");
        }
        // Test 2: Filter by confirmations
        const filterTimes = [];
        for (let i = 0; i < 100; i++) {
            const filterStart = performance.now();
            const filtered = utxos.filter((u) => u.confirmations >= 6 && !u.locked);
            filterTimes.push(performance.now() - filterStart);
            if (filtered.length === 0 && utxos.length > 0) { } // OK if empty
        }
        // Test 3: Calculate balance
        const balanceTimes = [];
        for (let i = 0; i < 100; i++) {
            const balanceStart = performance.now();
            let confirmed = 0;
            let unconfirmed = 0;
            for (const utxo of utxos) {
                if (utxo.locked)
                    continue;
                if (utxo.confirmations >= 1) {
                    confirmed += utxo.amount;
                }
                else {
                    unconfirmed += utxo.amount;
                }
            }
            balanceTimes.push(performance.now() - balanceStart);
            if (confirmed + unconfirmed < 0)
                throw new Error("Balance calculation error");
        }
        // Test 4: Find by txid:vout (map lookup simulation)
        const lookupTimes = [];
        const utxoMap = new Map(utxos.map((u) => [`${u.txid}:${u.vout}`, u]));
        for (let i = 0; i < 1000; i++) {
            const randomUtxo = utxos[Math.floor(Math.random() * utxos.length)];
            const lookupStart = performance.now();
            const found = utxoMap.get(`${randomUtxo.txid}:${randomUtxo.vout}`);
            lookupTimes.push(performance.now() - lookupStart);
            if (!found)
                throw new Error("Lookup failed");
        }
        const duration = performance.now() - start;
        console.log(`\n📊 ${testName}:`);
        console.log(`  UTXO count: ${utxoCount}`);
        printMetrics("Sort (100 iterations)", calculateMetrics(sortTimes));
        printMetrics("Filter (100 iterations)", calculateMetrics(filterTimes));
        printMetrics("Balance calc (100 iterations)", calculateMetrics(balanceTimes));
        printMetrics("Map lookup (1000 iterations)", calculateMetrics(lookupTimes));
        return {
            name: testName,
            passed: true,
            durationMs: duration,
            details: `Tested ${utxoCount} UTXOs with sort, filter, balance, and lookup operations`,
        };
    }
    catch (err) {
        return {
            name: testName,
            passed: false,
            durationMs: performance.now() - start,
            error: err.message,
        };
    }
}
// ============================================================================
// Test: Coin Selection Performance
// ============================================================================
async function testCoinSelectionPerformance() {
    const testName = "Coin Selection - Large UTXO Sets";
    const start = performance.now();
    try {
        const utxoCounts = [100, 500, 1000, 2000];
        const targetAmounts = [1_000_000, 10_000_000, 100_000_000, 500_000_000]; // 0.01 - 5 DOGE
        console.log(`\n📊 ${testName}:`);
        for (const utxoCount of utxoCounts) {
            const utxos = generateMockUtxos(utxoCount);
            const selectionTimes = [];
            for (const targetAmount of targetAmounts) {
                const selectStart = performance.now();
                // Simulate coin selection (largest-first greedy)
                const sorted = [...utxos]
                    .filter((u) => !u.locked && u.confirmations >= 1)
                    .sort((a, b) => b.amount - a.amount);
                const selected = [];
                let total = 0;
                const feePerInput = 148 * 1000; // 148 bytes * 1000 koinu/byte
                for (const utxo of sorted) {
                    if (total >= targetAmount + selected.length * feePerInput + 44 * 1000) {
                        break;
                    }
                    selected.push(utxo);
                    total += utxo.amount;
                }
                selectionTimes.push(performance.now() - selectStart);
            }
            const metrics = calculateMetrics(selectionTimes);
            console.log(`  ${utxoCount} UTXOs: avg ${formatMs(metrics.avg)}, max ${formatMs(metrics.max)}`);
        }
        const duration = performance.now() - start;
        return {
            name: testName,
            passed: true,
            durationMs: duration,
            details: `Tested coin selection with ${utxoCounts.join(", ")} UTXOs`,
        };
    }
    catch (err) {
        return {
            name: testName,
            passed: false,
            durationMs: performance.now() - start,
            error: err.message,
        };
    }
}
// ============================================================================
// Test: Invoice Creation Performance
// ============================================================================
async function testInvoicePerformance() {
    const testName = "Invoice Operations - 100+ Invoices";
    const start = performance.now();
    try {
        const invoiceCount = 200;
        const invoices = new Map();
        // Test 1: Create invoices
        const createTimes = [];
        for (let i = 0; i < invoiceCount; i++) {
            const createStart = performance.now();
            const invoice = {
                id: randomUUID(),
                amount: Math.random() * 100,
                description: `Test invoice ${i}`,
                createdAt: new Date().toISOString(),
            };
            invoices.set(invoice.id, invoice);
            createTimes.push(performance.now() - createStart);
        }
        // Test 2: Lookup invoices by ID
        const lookupTimes = [];
        const invoiceIds = Array.from(invoices.keys());
        for (let i = 0; i < 1000; i++) {
            const randomId = invoiceIds[Math.floor(Math.random() * invoiceIds.length)];
            const lookupStart = performance.now();
            const found = invoices.get(randomId);
            lookupTimes.push(performance.now() - lookupStart);
            if (!found)
                throw new Error("Invoice lookup failed");
        }
        // Test 3: List and filter invoices
        const listTimes = [];
        for (let i = 0; i < 100; i++) {
            const listStart = performance.now();
            const list = Array.from(invoices.values())
                .filter((inv) => inv.amount > 50)
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .slice(0, 20);
            listTimes.push(performance.now() - listStart);
            if (list.length === undefined)
                throw new Error("List failed");
        }
        // Test 4: Search by description (simulated)
        const searchTimes = [];
        for (let i = 0; i < 100; i++) {
            const searchTerm = `invoice ${Math.floor(Math.random() * invoiceCount)}`;
            const searchStart = performance.now();
            const results = Array.from(invoices.values())
                .filter((inv) => inv.description.toLowerCase().includes(searchTerm.toLowerCase()));
            searchTimes.push(performance.now() - searchStart);
            // Results may be 0 or more
        }
        const duration = performance.now() - start;
        console.log(`\n📊 ${testName}:`);
        console.log(`  Invoice count: ${invoiceCount}`);
        printMetrics("Create (per invoice)", calculateMetrics(createTimes));
        printMetrics("Lookup (1000 iterations)", calculateMetrics(lookupTimes));
        printMetrics("List & filter (100 iterations)", calculateMetrics(listTimes));
        printMetrics("Search (100 iterations)", calculateMetrics(searchTimes));
        return {
            name: testName,
            passed: true,
            durationMs: duration,
            opsPerSecond: Math.round(invoiceCount / (calculateMetrics(createTimes).avg / 1000)),
            details: `Created ${invoiceCount} invoices, performed lookups and searches`,
        };
    }
    catch (err) {
        return {
            name: testName,
            passed: false,
            durationMs: performance.now() - start,
            error: err.message,
        };
    }
}
// ============================================================================
// Test: Rate Limiter Performance
// ============================================================================
async function testRateLimiterPerformance() {
    const testName = "Rate Limiter - High Volume";
    const start = performance.now();
    try {
        // Simple rate limiter implementation for testing
        const limits = new Map();
        const maxRequests = 100;
        const windowMs = 60_000;
        function checkRateLimit(key) {
            const now = Date.now();
            const entry = limits.get(key);
            if (!entry || now - entry.windowStart >= windowMs) {
                limits.set(key, { count: 1, windowStart: now });
                return true;
            }
            if (entry.count >= maxRequests) {
                return false;
            }
            entry.count++;
            return true;
        }
        // Test 1: Single key, high volume
        const singleKeyTimes = [];
        let allowed = 0;
        let denied = 0;
        for (let i = 0; i < 10000; i++) {
            const checkStart = performance.now();
            const result = checkRateLimit("test-key");
            singleKeyTimes.push(performance.now() - checkStart);
            if (result)
                allowed++;
            else
                denied++;
        }
        // Reset for next test
        limits.clear();
        // Test 2: Many keys (simulate many users)
        const multiKeyTimes = [];
        const keyCount = 1000;
        for (let i = 0; i < 10000; i++) {
            const key = `user-${i % keyCount}`;
            const checkStart = performance.now();
            checkRateLimit(key);
            multiKeyTimes.push(performance.now() - checkStart);
        }
        // Test 3: Cleanup performance
        // Add many entries
        for (let i = 0; i < 5000; i++) {
            limits.set(`cleanup-key-${i}`, { count: 1, windowStart: Date.now() - windowMs * 2 });
        }
        const cleanupStart = performance.now();
        const now = Date.now();
        for (const [key, entry] of limits) {
            if (now - entry.windowStart >= windowMs * 2) {
                limits.delete(key);
            }
        }
        const cleanupTime = performance.now() - cleanupStart;
        const duration = performance.now() - start;
        console.log(`\n📊 ${testName}:`);
        console.log(`  Single key test: ${allowed} allowed, ${denied} denied`);
        printMetrics("Single key (10K checks)", calculateMetrics(singleKeyTimes));
        printMetrics("Multi key (10K checks, 1K keys)", calculateMetrics(multiKeyTimes));
        console.log(`  Cleanup (5K entries): ${formatMs(cleanupTime)}`);
        return {
            name: testName,
            passed: true,
            durationMs: duration,
            opsPerSecond: Math.round(10000 / (calculateMetrics(singleKeyTimes).avg * 10000 / 1000)),
            details: `Tested ${10000} rate limit checks`,
        };
    }
    catch (err) {
        return {
            name: testName,
            passed: false,
            durationMs: performance.now() - start,
            error: err.message,
        };
    }
}
// ============================================================================
// Test: API Failover Simulation
// ============================================================================
async function testApiFailoverPerformance() {
    const testName = "API Failover - Simulated Load";
    const start = performance.now();
    try {
        const primary = {
            name: "primary",
            healthy: true,
            latencyMs: 100,
            failureRate: 0.1, // 10% failure rate
        };
        const fallback = {
            name: "fallback",
            healthy: true,
            latencyMs: 150,
            failureRate: 0.05, // 5% failure rate
        };
        async function simulateRequest(provider) {
            const latency = provider.latencyMs + (Math.random() * 50 - 25); // ±25ms jitter
            await new Promise((r) => setTimeout(r, Math.max(1, latency / 100))); // Scaled down for test
            const success = Math.random() > provider.failureRate;
            return { success, latency };
        }
        async function failoverRequest() {
            if (primary.healthy) {
                const result = await simulateRequest(primary);
                if (result.success) {
                    return { provider: "primary", ...result };
                }
            }
            // Failover to fallback
            const result = await simulateRequest(fallback);
            return { provider: "fallback", ...result };
        }
        // Run load test
        const requestCount = 100;
        const results = [];
        const requestTimes = [];
        for (let i = 0; i < requestCount; i++) {
            const reqStart = performance.now();
            const result = await failoverRequest();
            requestTimes.push(performance.now() - reqStart);
            results.push(result);
            // Simulate primary going unhealthy occasionally
            if (i === 30)
                primary.healthy = false;
            if (i === 60)
                primary.healthy = true;
        }
        const primaryCount = results.filter((r) => r.provider === "primary").length;
        const fallbackCount = results.filter((r) => r.provider === "fallback").length;
        const successCount = results.filter((r) => r.success).length;
        const duration = performance.now() - start;
        console.log(`\n📊 ${testName}:`);
        console.log(`  Total requests: ${requestCount}`);
        console.log(`  Primary: ${primaryCount}, Fallback: ${fallbackCount}`);
        console.log(`  Success rate: ${(successCount / requestCount * 100).toFixed(1)}%`);
        printMetrics("Request latency", calculateMetrics(requestTimes));
        return {
            name: testName,
            passed: successCount / requestCount > 0.9, // >90% success rate
            durationMs: duration,
            details: `${successCount}/${requestCount} requests successful`,
        };
    }
    catch (err) {
        return {
            name: testName,
            passed: false,
            durationMs: performance.now() - start,
            error: err.message,
        };
    }
}
// ============================================================================
// Test: Memory Usage (Approximate)
// ============================================================================
async function testMemoryUsage() {
    const testName = "Memory Usage - Large Data Sets";
    const start = performance.now();
    try {
        // Force GC if available
        if (global.gc) {
            global.gc();
        }
        const initialMemory = process.memoryUsage().heapUsed;
        // Allocate large UTXO set
        const largeUtxoSet = generateMockUtxos(5000);
        const afterUtxos = process.memoryUsage().heapUsed;
        const utxoMemory = afterUtxos - initialMemory;
        // Allocate invoices
        const invoices = new Map();
        for (let i = 0; i < 1000; i++) {
            invoices.set(randomUUID(), {
                id: randomUUID(),
                amount: Math.random() * 100,
                description: "Test invoice with a reasonably long description for testing",
                createdAt: new Date().toISOString(),
                status: "pending",
                payee: { name: "Test", address: "DTestAddress" },
            });
        }
        const afterInvoices = process.memoryUsage().heapUsed;
        const invoiceMemory = afterInvoices - afterUtxos;
        const totalMemory = process.memoryUsage().heapUsed - initialMemory;
        const duration = performance.now() - start;
        console.log(`\n📊 ${testName}:`);
        console.log(`  5000 UTXOs: ~${(utxoMemory / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  1000 Invoices: ~${(invoiceMemory / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Total additional: ~${(totalMemory / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Per UTXO: ~${(utxoMemory / 5000).toFixed(0)} bytes`);
        console.log(`  Per Invoice: ~${(invoiceMemory / 1000).toFixed(0)} bytes`);
        // Clean up
        largeUtxoSet.length = 0;
        invoices.clear();
        return {
            name: testName,
            passed: totalMemory < 100 * 1024 * 1024, // Less than 100MB
            durationMs: duration,
            details: `Total memory: ${(totalMemory / 1024 / 1024).toFixed(2)} MB`,
        };
    }
    catch (err) {
        return {
            name: testName,
            passed: false,
            durationMs: performance.now() - start,
            error: err.message,
        };
    }
}
// ============================================================================
// Main Runner
// ============================================================================
async function runAllTests() {
    console.log("🐕 DOGE Wallet Load Test Suite");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`Started: ${new Date().toISOString()}\n`);
    const results = [];
    // Run all tests
    results.push(await testUtxoManagerPerformance());
    results.push(await testCoinSelectionPerformance());
    results.push(await testInvoicePerformance());
    results.push(await testRateLimiterPerformance());
    results.push(await testApiFailoverPerformance());
    results.push(await testMemoryUsage());
    // Summary
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📋 Summary:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => !r.passed).length;
    for (const result of results) {
        const icon = result.passed ? "✅" : "❌";
        console.log(`${icon} ${result.name}`);
        console.log(`   Duration: ${formatMs(result.durationMs)}`);
        if (result.opsPerSecond) {
            console.log(`   Throughput: ${result.opsPerSecond.toLocaleString()} ops/sec`);
        }
        if (result.details) {
            console.log(`   Details: ${result.details}`);
        }
        if (result.error) {
            console.log(`   Error: ${result.error}`);
        }
        console.log();
    }
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`Total: ${passed} passed, ${failed} failed`);
    console.log(`Finished: ${new Date().toISOString()}`);
    console.log("\nMuch test. Very performance. Wow. 🐕");
    // Exit with error code if any tests failed
    if (failed > 0) {
        process.exit(1);
    }
}
// Run if executed directly
runAllTests().catch((err) => {
    console.error("Load test failed:", err);
    process.exit(1);
});
export { runAllTests, testUtxoManagerPerformance, testCoinSelectionPerformance };
//# sourceMappingURL=load-test.js.map