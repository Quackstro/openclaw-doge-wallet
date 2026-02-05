/**
 * Secure file I/O helpers for the DOGE wallet plugin.
 *
 * All wallet data files contain financially sensitive information (UTXOs,
 * transaction history, spending limits, audit trails). These helpers enforce
 * owner-only permissions (700 for dirs, 600 for files) regardless of the
 * system umask.
 *
 * Usage:
 *   import { secureWriteFile, secureMkdir, secureAppendFile } from "./secure-fs.js";
 */

import { writeFile, mkdir, appendFile, chmod } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Owner-only directory permissions (rwx------) */
export const DIR_PERMS = 0o700;

/** Owner-only file permissions (rw-------) */
export const FILE_PERMS = 0o600;

/**
 * Create a directory with secure permissions (700).
 * Always sets permissions explicitly after creation to bypass umask.
 */
export async function secureMkdir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true, mode: DIR_PERMS });
  // Explicitly chmod — mkdir's mode is subject to umask
  await chmod(dirPath, DIR_PERMS);
}

/**
 * Synchronous version of secureMkdir for use in constructors.
 */
export function secureMkdirSync(dirPath: string): void {
  const { chmodSync } = require("node:fs");
  mkdirSync(dirPath, { recursive: true, mode: DIR_PERMS });
  chmodSync(dirPath, DIR_PERMS);
}

/**
 * Write a file with secure permissions (600).
 * Ensures parent directory exists with secure permissions.
 */
export async function secureWriteFile(
  filePath: string,
  data: string,
  options?: { encoding?: BufferEncoding; flag?: string },
): Promise<void> {
  await secureMkdir(dirname(filePath));
  await writeFile(filePath, data, {
    encoding: options?.encoding ?? "utf-8",
    mode: FILE_PERMS,
    flag: options?.flag,
  });
  // Explicitly chmod — writeFile's mode is subject to umask
  await chmod(filePath, FILE_PERMS);
}

/**
 * Synchronous version of secureWriteFile.
 */
export function secureWriteFileSync(filePath: string, data: string): void {
  const { chmodSync } = require("node:fs");
  const { dirname: dn } = require("node:path");
  secureMkdirSync(dn(filePath));
  writeFileSync(filePath, data, { encoding: "utf-8", mode: FILE_PERMS });
  chmodSync(filePath, FILE_PERMS);
}

/**
 * Append to a file with secure permissions (600).
 * Ensures parent directory exists with secure permissions.
 * Creates file if it doesn't exist.
 */
export async function secureAppendFile(
  filePath: string,
  data: string,
): Promise<void> {
  await secureMkdir(dirname(filePath));
  await appendFile(filePath, data, { encoding: "utf-8", mode: FILE_PERMS });
  // Explicitly chmod on every append to catch files created before hardening
  await chmod(filePath, FILE_PERMS);
}

/**
 * Ensure data directory and all required subdirectories exist with secure permissions.
 * Call this once during plugin init.
 */
export async function ensureSecureDataDir(dataDir: string): Promise<void> {
  await secureMkdir(dataDir);
  // Create known subdirectories
  const subdirs = ["keys", "audit", "utxo"];
  for (const sub of subdirs) {
    await secureMkdir(`${dataDir}/${sub}`);
  }
}
