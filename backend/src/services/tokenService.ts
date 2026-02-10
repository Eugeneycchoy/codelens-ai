import jwt from 'jsonwebtoken';

/**
 * Generates a JWT token for a device.
 * @param deviceId - The unique device identifier
 * @returns Signed JWT token string
 * @throws Error if JWT_SECRET is not configured
 */
export function generateToken(deviceId: string): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not configured');
  }

  const payload = { deviceId };

  // Generate long-lived token with no expiration
  return jwt.sign(payload, secret, {
    algorithm: 'HS256'
  });
}

/**
 * Validates a JWT token and extracts the device ID.
 * @param token - The JWT token to validate
 * @returns Decoded payload with deviceId, or null if validation fails
 */
export function validateToken(token: string): { deviceId: string } | null {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not configured');
  }

  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256']
    }) as { deviceId: string; iat: number };

    return { deviceId: decoded.deviceId };
  } catch (error) {
    // Log validation failure without exposing the token
    console.error('Token validation failed:', error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
}
