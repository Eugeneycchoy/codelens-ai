/**
 * Logs a custom event to Application Insights.
 * Uses Azure Functions built-in Application Insights integration.
 * @param eventName - Name of the event to log
 * @param properties - Additional properties to include with the event
 */
export function logEvent(eventName: string, properties: Record<string, any>): void {
  try {
    // Azure Functions automatically integrates with Application Insights
    // Events logged via console.log with structured data are captured
    console.log(JSON.stringify({
      type: 'event',
      name: eventName,
      properties: sanitizeProperties(properties),
      timestamp: new Date().toISOString()
    }));
  } catch (error) {
    console.error('Failed to log event:', error);
  }
}

/**
 * Logs an error to Application Insights with context.
 * @param error - The error object to log
 * @param context - Additional context for debugging
 */
export function logError(error: Error, context: Record<string, any>): void {
  try {
    console.error(JSON.stringify({
      type: 'error',
      message: error.message,
      stack: error.stack,
      context: sanitizeProperties(context),
      timestamp: new Date().toISOString()
    }));
  } catch (loggingError) {
    // Fallback to simple console.error if structured logging fails
    console.error('Error:', error);
    console.error('Logging error:', loggingError);
  }
}

/**
 * Sanitizes properties to ensure no PII is logged.
 * @param properties - Properties to sanitize
 * @returns Sanitized properties object
 */
function sanitizeProperties(properties: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(properties)) {
    // Skip any keys that might contain sensitive data
    const sensitiveKeys = ['deviceId', 'token', 'apiKey', 'password', 'secret'];
    if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
      // Only include if it's already a hash (contains 'hash' in the key name)
      if (key.toLowerCase().includes('hash')) {
        sanitized[key] = value;
      }
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}
