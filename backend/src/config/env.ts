/**
 * Environment configuration module.
 * Validates required environment variables on module load.
 * Loads .env from the current working directory so credentials in .env are used when present.
 */
import { config as loadEnv } from 'dotenv';

loadEnv(); // Load .env from current working directory so credentials in .env are used

interface EnvironmentConfig {
  JWT_SECRET: string;
  SHARED_API_KEY: string;
  REDIS_CONNECTION_STRING: string;
  APPINSIGHTS_CONNECTION_STRING?: string;
  AZURE_OPENAI_API_KEY: string;
  AZURE_OPENAI_ENDPOINT: string;
  AZURE_OPENAI_DEPLOYMENT: string;
  AZURE_OPENAI_API_VERSION: string;
}

/**
 * Builds Redis connection string from REDIS_HOST, REDIS_PORT, REDIS_PASSWORD.
 * Uses rediss:// (TLS) for Azure Cache for Redis (port 6380).
 */
function buildRedisConnectionString(): string {
  const host = process.env.REDIS_HOST;
  const port = process.env.REDIS_PORT;
  const password = process.env.REDIS_PASSWORD;
  if (!host || !port || !password) {
    throw new Error(
      'Redis requires either REDIS_CONNECTION_STRING or all of REDIS_HOST, REDIS_PORT, REDIS_PASSWORD'
    );
  }
  const encodedPassword = encodeURIComponent(password);
  return `rediss://:${encodedPassword}@${host}:${port}`;
}

/**
 * Validates that a required environment variable is set and meets minimum length requirements.
 * @param name - Name of the environment variable
 * @param minLength - Minimum required length (optional)
 * @returns The validated environment variable value
 * @throws Error if validation fails
 */
function validateEnvVar(name: string, minLength?: number): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }

  if (minLength && value.length < minLength) {
    throw new Error(`Environment variable ${name} must be at least ${minLength} characters long`);
  }

  return value;
}

/**
 * Validates all required environment variables.
 * @throws Error if any validation fails
 */
function validateEnvironment(): EnvironmentConfig {
  const redisConnectionString =
    process.env.REDIS_CONNECTION_STRING || buildRedisConnectionString();

  return {
    JWT_SECRET: validateEnvVar('JWT_SECRET', 32),
    SHARED_API_KEY: validateEnvVar('SHARED_API_KEY', 32),
    REDIS_CONNECTION_STRING: redisConnectionString,
    APPINSIGHTS_CONNECTION_STRING: process.env.APPINSIGHTS_CONNECTION_STRING,
    AZURE_OPENAI_API_KEY: validateEnvVar('AZURE_OPENAI_API_KEY', 32),
    AZURE_OPENAI_ENDPOINT: validateEnvVar('AZURE_OPENAI_ENDPOINT'),
    AZURE_OPENAI_DEPLOYMENT: validateEnvVar('AZURE_OPENAI_DEPLOYMENT'),
    AZURE_OPENAI_API_VERSION: validateEnvVar('AZURE_OPENAI_API_VERSION')
  };
}

// Validate environment on module load
export const config = validateEnvironment();

// Log successful validation (without exposing secrets)
console.log('Environment configuration validated successfully');
