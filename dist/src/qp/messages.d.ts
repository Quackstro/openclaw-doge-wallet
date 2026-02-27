/**
 * Quackstro Protocol Message Encoder/Decoder
 * Binary serialization for all QP message types (§5)
 */
import { QPMessageType, type QPMessage, type QPPayload } from './types.js';
/**
 * Encode a QP message to an 80-byte buffer (for OP_RETURN)
 */
export declare function encodeMessage<T extends QPPayload>(message: QPMessage<T>): Buffer;
/**
 * Decode an 80-byte buffer to a QP message
 */
export declare function decodeMessage(buffer: Buffer): QPMessage;
/**
 * Check if a buffer contains a valid QP message (by checking magic bytes)
 */
export declare function isQPMessage(buffer: Buffer): boolean;
/**
 * Get message type name for debugging
 */
export declare function getMessageTypeName(type: QPMessageType): string;
//# sourceMappingURL=messages.d.ts.map