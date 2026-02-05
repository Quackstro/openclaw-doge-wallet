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
/** Owner-only directory permissions (rwx------) */
export declare const DIR_PERMS = 448;
/** Owner-only file permissions (rw-------) */
export declare const FILE_PERMS = 384;
/**
 * Create a directory with secure permissions (700).
 * Always sets permissions explicitly after creation to bypass umask.
 */
export declare function secureMkdir(dirPath: string): Promise<void>;
/**
 * Synchronous version of secureMkdir for use in constructors.
 */
export declare function secureMkdirSync(dirPath: string): void;
/**
 * Write a file with secure permissions (600).
 * Ensures parent directory exists with secure permissions.
 */
export declare function secureWriteFile(filePath: string, data: string, options?: {
    encoding?: BufferEncoding;
    flag?: string;
}): Promise<void>;
/**
 * Synchronous version of secureWriteFile.
 */
export declare function secureWriteFileSync(filePath: string, data: string): void;
/**
 * Append to a file with secure permissions (600).
 * Ensures parent directory exists with secure permissions.
 * Creates file if it doesn't exist.
 */
export declare function secureAppendFile(filePath: string, data: string): Promise<void>;
/**
 * Ensure data directory and all required subdirectories exist with secure permissions.
 * Call this once during plugin init.
 */
export declare function ensureSecureDataDir(dataDir: string): Promise<void>;
//# sourceMappingURL=secure-fs.d.ts.map