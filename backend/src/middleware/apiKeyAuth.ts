import { HttpRequest, HttpResponseInit } from '@azure/functions';
import crypto from 'crypto';

/**
 * Validates the API key from the request header.
 * Uses constant-time comparison to prevent timing attacks.
 * @param request - The HTTP request object
 * @returns true if API key is valid, false otherwise
 */
export function validateApiKey(request: HttpRequest): boolean {
  const apiKey = request.headers.get('X-API-Key') || request.headers.get('x-api-key');
  const expectedApiKey = process.env.SHARED_API_KEY;

  if (!expectedApiKey) {
    throw new Error('SHARED_API_KEY environment variable is not configured');
  }

  if (!apiKey) {
    return false;
  }

  // Use constant-time comparison to prevent timing attacks
  try {
    const apiKeyBuffer = Buffer.from(apiKey);
    const expectedBuffer = Buffer.from(expectedApiKey);

    // Ensure buffers are same length for timingSafeEqual
    if (apiKeyBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(apiKeyBuffer, expectedBuffer);
  } catch (error) {
    console.error('API key validation error:', error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}

/**
 * Creates a standardized 401 Unauthorized response.
 * @returns HTTP response object with 401 status
 */
export function createUnauthorizedResponse(): HttpResponseInit {
  return {
    status: 401,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      error: 'UNAUTHORIZED',
      message: 'Invalid or missing API key'
    })
  };
}
