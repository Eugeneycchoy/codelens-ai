import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { RegisterRequest, RegisterResponse } from '@dumbify/shared';
import { validateApiKey, createUnauthorizedResponse } from '../middleware/apiKeyAuth';
import * as tokenService from '../services/tokenService';
import * as quotaManager from '../services/quotaManager';
import { hashDeviceId } from '../utils/crypto';
import { logEvent, logError } from '../utils/logger';

/**
 * Azure Function handler for device registration.
 * POST /api/register
 */
async function registerDevice(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  try {
    // 1. API Key Validation
    if (!validateApiKey(request)) {
      return createUnauthorizedResponse();
    }

    // 2. Request Body Validation
    let body: RegisterRequest;
    try {
      const text = await request.text();
      body = JSON.parse(text) as RegisterRequest;
    } catch (error) {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'INVALID_REQUEST',
          message: 'Invalid JSON in request body'
        })
      };
    }

    const { deviceId } = body;

    if (!deviceId || typeof deviceId !== 'string' || deviceId.trim() === '') {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'INVALID_REQUEST',
          message: 'Missing or invalid deviceId'
        })
      };
    }

    // 3. Token Generation
    const token = tokenService.generateToken(deviceId);

    // 4. Quota Initialization
    let usage;
    try {
      usage = await quotaManager.initializeQuota(deviceId);
    } catch (error) {
      logError(error instanceof Error ? error : new Error('Unknown quota initialization error'), {
        deviceIdHash: hashDeviceId(deviceId),
        operation: 'initializeQuota'
      });

      return {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Quota service unavailable'
        })
      };
    }

    // 5. Logging
    logEvent('device_registered', {
      deviceIdHash: hashDeviceId(deviceId),
      timestamp: Date.now()
    });

    // 6. Response
    const response: RegisterResponse = {
      token,
      usage
    };

    return {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response)
    };

  } catch (error) {
    // Catch-all error handler
    logError(error instanceof Error ? error : new Error('Unknown error'), {
      operation: 'registerDevice'
    });

    return {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred'
      })
    };
  }
}

// Register the Azure Function
app.http('registerDevice', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'register',
  handler: registerDevice
});
