import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { ExplainRequest, ExplainResponse, ErrorResponse, UsageSnapshot } from '@dumbify/shared';
import { validateApiKey, createUnauthorizedResponse } from '../middleware/apiKeyAuth';
import { validateToken } from '../services/tokenService';
import { checkAndConsumeQuota } from '../services/quotaManager';
import { generateExplanation } from '../services/azureOpenAIClient';
import { hashDeviceId } from '../utils/crypto';
import { logEvent, logError } from '../utils/logger';

/**
 * Helper function to create invalid token response.
 */
function createInvalidTokenResponse(): HttpResponseInit {
  const response: ErrorResponse = {
    error: 'INVALID_TOKEN',
    message: 'Device token is invalid or expired. Please re-register.'
  };

  return {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(response)
  };
}

/**
 * Helper function to create rate limit response.
 */
function createRateLimitResponse(usage: UsageSnapshot): HttpResponseInit {
  const response: ErrorResponse = {
    error: 'RATE_LIMIT_EXCEEDED',
    message: `Daily quota exceeded (${usage.used}/${usage.limit}). Resets ${usage.resetIn}.`,
    usage
  };

  return {
    status: 429,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(response)
  };
}

/**
 * Helper function to create upstream throttled response.
 */
function createUpstreamThrottledResponse(retryAfter?: number): HttpResponseInit {
  const response: ErrorResponse = {
    error: 'UPSTREAM_THROTTLED',
    message: 'Service is throttled by the provider. Try again soon.',
    retryAfterSeconds: retryAfter
  };

  return {
    status: 429,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(response)
  };
}

/**
 * Helper function to create service error response.
 */
function createServiceErrorResponse(): HttpResponseInit {
  const response: ErrorResponse = {
    error: 'SERVICE_ERROR',
    message: 'Dumbify service error. Try again in a few minutes.'
  };

  return {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(response)
  };
}

/**
 * Azure Function handler for code explanation.
 * POST /api/explain
 */
async function explainCode(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const startTime = Date.now();

  try {
    // 1. API Key Validation
    if (!validateApiKey(request)) {
      return createUnauthorizedResponse();
    }

    // 2. Request Body Parsing
    let body: ExplainRequest;
    try {
      const text = await request.text();
      body = JSON.parse(text) as ExplainRequest;
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

    const { token, code, language } = body;

    if (!token || typeof token !== 'string' || token.trim() === '') {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'INVALID_REQUEST',
          message: 'Missing or invalid token'
        })
      };
    }

    if (!code || typeof code !== 'string' || code.trim() === '') {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'INVALID_REQUEST',
          message: 'Missing or invalid code'
        })
      };
    }

    if (!language || typeof language !== 'string' || language.trim() === '') {
      return {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'INVALID_REQUEST',
          message: 'Missing or invalid language'
        })
      };
    }

    // 3. JWT Token Validation
    const tokenPayload = validateToken(token);
    if (!tokenPayload) {
      return createInvalidTokenResponse();
    }
    const deviceId = tokenPayload.deviceId;

    // 4. Quota Check and Consumption
    let usage: UsageSnapshot;
    try {
      usage = await checkAndConsumeQuota(deviceId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Check if quota exceeded
      if (errorMessage.includes('QUOTA_EXCEEDED')) {
        // Extract usage snapshot from error object
        const usageSnapshot = (error as any).usage as UsageSnapshot;
        if (usageSnapshot) {
          return createRateLimitResponse(usageSnapshot);
        }

        // Fallback if usage snapshot not available
        return {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: 'RATE_LIMIT_EXCEEDED',
            message: 'Daily quota exceeded'
          })
        };
      }

      // Quota service unavailable
      logError(error instanceof Error ? error : new Error('Unknown quota error'), {
        deviceIdHash: hashDeviceId(deviceId),
        operation: 'checkAndConsumeQuota'
      });

      return createServiceErrorResponse();
    }

    // 5. Azure OpenAI Call
    let explanation: string;
    try {
      explanation = await generateExplanation(body);
      const latency = Date.now() - startTime;

      // Log success event
      logEvent('explanation_requested', {
        deviceIdHash: hashDeviceId(deviceId),
        language: body.language,
        detailLevel: body.detailLevel || 'brief',
        quotaUsed: usage.used,
        quotaLimit: usage.limit,
        latencyMs: latency,
        statusCode: 200
      });

      // Return success response
      const response: ExplainResponse = {
        explanation,
        usage
      };

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(response)
      };

    } catch (error) {
      const latency = Date.now() - startTime;

      // Check if Azure throttling (429)
      if (error && typeof error === 'object' && 'status' in error && error.status === 429) {
        // Extract retry-after header if available
        const retryAfter = (error as any).headers?.['retry-after'];
        const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : undefined;

        logError(error instanceof Error ? error : new Error('Azure OpenAI throttled'), {
          deviceIdHash: hashDeviceId(deviceId),
          language: body.language,
          detailLevel: body.detailLevel || 'brief',
          latencyMs: latency,
          errorType: 'UPSTREAM_THROTTLED'
        });

        return createUpstreamThrottledResponse(retryAfterSeconds);
      }

      // Other Azure errors
      logError(error instanceof Error ? error : new Error('Azure OpenAI error'), {
        deviceIdHash: hashDeviceId(deviceId),
        language: body.language,
        detailLevel: body.detailLevel || 'brief',
        latencyMs: latency,
        errorType: 'AZURE_ERROR'
      });

      return createServiceErrorResponse();
    }

  } catch (error) {
    // Catch-all error handler
    logError(error instanceof Error ? error : new Error('Unknown error'), {
      operation: 'explainCode'
    });

    return createServiceErrorResponse();
  }
}

// Register the Azure Function
app.http('explainCode', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'explain',
  handler: explainCode
});
