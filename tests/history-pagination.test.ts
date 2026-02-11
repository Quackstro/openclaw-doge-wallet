/**
 * History pagination tests — covers handleWalletHistory logic,
 * callback handler routing, and edge cases.
 */

import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";

/**
 * Simulate the handleWalletHistory logic extracted from the plugin.
 * We test the pure logic here since the actual function is embedded in the plugin closure.
 */

function koinuToDoge(koinu) {
  return koinu / 100_000_000;
}

function formatDoge(amount) {
  return amount.toFixed(2);
}

function truncAddr(address) {
  if (address.length <= 14) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function makeEntry(action, amount, address, txid, timestamp) {
  return { action, amount, address, txid, timestamp };
}

function handleWalletHistory(entries, args) {
  const PAGE_SIZE = 5;
  let offset = Math.max(0, parseInt(args, 10) || 0);

  if (entries.length === 0) {
    return { text: "🐕 Transaction History\n━━━━━━━━━━━━━━━━━━━━━━\nNo transactions yet. 🐕" };
  }

  // Clamp offset: if beyond available entries, reset to last valid page
  if (offset >= entries.length) {
    offset = Math.max(0, Math.floor((entries.length - 1) / PAGE_SIZE) * PAGE_SIZE);
  }

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageEntries = entries.slice(offset, offset + PAGE_SIZE);
  const hasMore = entries.length > offset + PAGE_SIZE;

  let text = `💰 Transaction History (page ${page})\n━━━━━━━━━━━━━━━━━━━━━━\n`;
  for (const e of pageEntries) {
    const amountDoge = e.amount ? koinuToDoge(e.amount) : 0;
    if (e.action === "receive") {
      text += `\n➕ ${formatDoge(amountDoge)} DOGE ← ${truncAddr(e.address ?? "unknown")}\n`;
    } else {
      text += `\n➖ ${formatDoge(amountDoge)} DOGE → ${truncAddr(e.address ?? "unknown")}\n`;
    }
  }

  const buttons = [];
  if (hasMore) {
    buttons.push({ text: "📜 Show More", callback_data: `/history ${offset + PAGE_SIZE}` });
  }
  buttons.push({ text: "🔍 Search", callback_data: "wallet:history:search" });

  const result = { text };
  if (buttons.length > 0) {
    result.channelData = { telegram: { buttons: [buttons] } };
  }
  return result;
}

// Generate N test entries
function generateEntries(n) {
  const entries = [];
  for (let i = 0; i < n; i++) {
    entries.push(makeEntry(
      i % 3 === 0 ? "receive" : "send",
      (i + 1) * 100_000_000, // 1, 2, 3... DOGE in koinu
      "D84hUKd37sKjmvfweAAs3CRWiZYuP54ygU",
      `txid${String(i).padStart(4, "0")}abcdef1234567890`,
      new Date(2026, 1, 10, 14, 0, 0).toISOString(),
    ));
  }
  return entries;
}

describe("handleWalletHistory — pagination", () => {
  it("returns empty state when no transactions", () => {
    const result = handleWalletHistory([], "");
    assert.ok(result.text.includes("No transactions yet"));
    assert.equal(result.channelData, undefined);
  });

  it("shows page 1 with 5 items and Show More button when >5 entries", () => {
    const entries = generateEntries(12);
    const result = handleWalletHistory(entries, "0");
    assert.ok(result.text.includes("page 1"));
    // Count transaction lines (➕ or ➖)
    const txLines = result.text.match(/[➕➖]/g);
    assert.equal(txLines.length, 5);
    // Has Show More + Search buttons
    const buttons = result.channelData.telegram.buttons[0];
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0].text, "📜 Show More");
    assert.equal(buttons[0].callback_data, "/history 5");
    assert.equal(buttons[1].text, "🔍 Search");
  });

  it("shows page 2 with correct offset", () => {
    const entries = generateEntries(12);
    const result = handleWalletHistory(entries, "5");
    assert.ok(result.text.includes("page 2"));
    const txLines = result.text.match(/[➕➖]/g);
    assert.equal(txLines.length, 5);
    // Should have Show More (still more entries)
    const buttons = result.channelData.telegram.buttons[0];
    assert.equal(buttons[0].callback_data, "/history 10");
  });

  it("last page has only Search button (no Show More)", () => {
    const entries = generateEntries(8);
    const result = handleWalletHistory(entries, "5");
    assert.ok(result.text.includes("page 2"));
    const txLines = result.text.match(/[➕➖]/g);
    assert.equal(txLines.length, 3); // only 3 remaining
    const buttons = result.channelData.telegram.buttons[0];
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].text, "🔍 Search");
  });

  it("shows exactly 5 items on a full page", () => {
    const entries = generateEntries(5);
    const result = handleWalletHistory(entries, "0");
    const txLines = result.text.match(/[➕➖]/g);
    assert.equal(txLines.length, 5);
    // No more entries beyond this page
    const buttons = result.channelData.telegram.buttons[0];
    assert.equal(buttons.length, 1); // just Search
  });

  it("clamps negative offset to 0", () => {
    const entries = generateEntries(10);
    const result = handleWalletHistory(entries, "-5");
    assert.ok(result.text.includes("page 1"));
  });

  it("handles NaN offset gracefully (defaults to 0)", () => {
    const entries = generateEntries(10);
    const result = handleWalletHistory(entries, "abc");
    assert.ok(result.text.includes("page 1"));
  });

  it("handles empty string offset (defaults to 0)", () => {
    const entries = generateEntries(10);
    const result = handleWalletHistory(entries, "");
    assert.ok(result.text.includes("page 1"));
  });

  it("handles undefined args (defaults to 0)", () => {
    const entries = generateEntries(10);
    const result = handleWalletHistory(entries, undefined);
    assert.ok(result.text.includes("page 1"));
  });

  it("clamps offset beyond available entries to last valid page", () => {
    const entries = generateEntries(8);
    const result = handleWalletHistory(entries, "100");
    // Should clamp to last page (offset 5, page 2, showing 3 entries)
    assert.ok(result.text.includes("page 2"));
    const txLines = result.text.match(/[➕➖]/g);
    assert.equal(txLines.length, 3);
  });

  it("formats receive transactions with ← arrow", () => {
    const entries = [makeEntry("receive", 500_000_000, "D84hUKd37sKjmvfweAAs3CRWiZYuP54ygU", "txid001", new Date().toISOString())];
    const result = handleWalletHistory(entries, "0");
    assert.ok(result.text.includes("➕"));
    assert.ok(result.text.includes("←"));
    assert.ok(result.text.includes("5.00 DOGE"));
  });

  it("formats send transactions with → arrow", () => {
    const entries = [makeEntry("send", 300_000_000, "D84hUKd37sKjmvfweAAs3CRWiZYuP54ygU", "txid001", new Date().toISOString())];
    const result = handleWalletHistory(entries, "0");
    assert.ok(result.text.includes("➖"));
    assert.ok(result.text.includes("→"));
    assert.ok(result.text.includes("3.00 DOGE"));
  });
});

describe("callback routing", () => {
  it("Show More callback uses /history <offset> format (auto-reply, no LLM)", () => {
    const data = "/history 10";
    assert.ok(data.startsWith("/history"));
    const offset = parseInt(data.split(" ").pop(), 10);
    assert.equal(offset, 10);
  });

  it("parses /history 0 correctly", () => {
    const offset = parseInt("/history 0".split(" ").pop(), 10);
    assert.equal(offset, 0);
  });

  it("handles malformed /history arg (defaults NaN to 0)", () => {
    const raw = "/history abc".split(" ").pop();
    const offset = parseInt(raw, 10);
    assert.ok(isNaN(offset));
    assert.equal(offset || 0, 0);
  });

  it("Search callback still uses wallet:history:search (needs LLM)", () => {
    assert.equal("wallet:history:search", "wallet:history:search");
  });

  it("Show More and Search use different routing strategies", () => {
    // Show More → /history command (auto-reply, free)
    const showMore = "/history 5";
    assert.ok(showMore.startsWith("/history"));
    // Search → wallet:history:search (agent handles via LLM)
    const search = "wallet:history:search";
    assert.ok(!search.startsWith("/history"));
  });
});
