export interface DeviceTokenPayload {
  deviceId: string;
  iat: number;
}

export interface UsageSnapshot {
  used: number;
  limit: number;
  resetIn: string;
  resetAt: number;
  warningThreshold: boolean;
}

export interface RegisterRequest {
  deviceId: string;
}

export interface RegisterResponse {
  token: string;
  usage: UsageSnapshot;
}

export interface ExplainRequest {
  token: string;
  code: string;
  language: string;
  context?: string;
  detailLevel?: 'brief' | 'detailed';
  fileStructure?: string;
}

export interface ExplainResponse {
  explanation: string;
  usage: UsageSnapshot;
}

export interface ErrorResponse {
  error: string;
  message: string;
  usage?: UsageSnapshot;
  retryAfterSeconds?: number;
}

export interface QuotaRecord {
  count: number;
  windowStart: number;
  resetAt: number;
}
