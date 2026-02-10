import crypto from 'crypto';

/**
 * Hashes a device ID using SHA-256 for privacy-safe logging.
 * Never expose raw device IDs in logs or telemetry.
 */
export function hashDeviceId(deviceId: string): string {
  return crypto.createHash('sha256').update(deviceId).digest('hex');
}
