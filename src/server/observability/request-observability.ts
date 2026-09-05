import { randomUUID } from 'node:crypto';

import { REQUEST_ID_HEADER, isSafeRequestId } from '../../lib/request-correlation.ts';

export type RequestLogDocumentType = 'tax-invoice' | 'adjustment-note';
export type RequestLogOutcome = 'succeeded' | 'rejected' | 'failed';
export type RequestLogLevel = 'info' | 'warn' | 'error';

export interface RequestObservationScope {
  organizationId?: string;
  bookingReference?: string;
  provider?: string;
}

export interface StructuredRequestLogRecord {
  timestamp: string;
  level: RequestLogLevel;
  event: 'http.request.completed';
  requestId: string;
  operation: string;
  outcome: RequestLogOutcome;
  statusCode: number;
  durationMs: number;
  organizationId?: string;
  bookingReference?: string;
  provider?: string;
  documentType?: RequestLogDocumentType;
}

interface RequestObservationOptions {
  operation: string;
  documentType?: RequestLogDocumentType;
}

const SAFE_LOG_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

function safeLogIdentifier(value: string | undefined) {
  return value && SAFE_LOG_IDENTIFIER_PATTERN.test(value) ? value : undefined;
}

export function resolveRequestId(request: Request) {
  const requestId = request.headers.get(REQUEST_ID_HEADER);
  return isSafeRequestId(requestId) ? requestId : randomUUID();
}

function classifyStatus(statusCode: number): { level: RequestLogLevel; outcome: RequestLogOutcome } {
  if (statusCode >= 500) return { level: 'error', outcome: 'failed' };
  if (statusCode >= 400) return { level: 'warn', outcome: 'rejected' };
  return { level: 'info', outcome: 'succeeded' };
}

export function buildStructuredRequestLogRecord(input: {
  requestId: string;
  operation: string;
  statusCode: number;
  durationMs: number;
  documentType?: RequestLogDocumentType;
  scope?: RequestObservationScope;
}): StructuredRequestLogRecord {
  const classification = classifyStatus(input.statusCode);
  const record: StructuredRequestLogRecord = {
    timestamp: new Date().toISOString(),
    level: classification.level,
    event: 'http.request.completed',
    requestId: isSafeRequestId(input.requestId) ? input.requestId : 'invalid-request-id',
    operation: safeLogIdentifier(input.operation) ?? 'unknown-operation',
    outcome: classification.outcome,
    statusCode: input.statusCode,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    documentType: input.documentType,
  };

  const organizationId = safeLogIdentifier(input.scope?.organizationId);
  const bookingReference = safeLogIdentifier(input.scope?.bookingReference);
  const provider = safeLogIdentifier(input.scope?.provider);
  if (organizationId) record.organizationId = organizationId;
  if (bookingReference) record.bookingReference = bookingReference;
  if (provider) record.provider = provider;
  return record;
}

function writeStructuredRequestLog(record: StructuredRequestLogRecord) {
  const line = JSON.stringify(record);
  if (record.level === 'error') {
    console.error(line);
    return;
  }
  if (record.level === 'warn') {
    console.warn(line);
    return;
  }
  console.info(line);
}

export function createRequestObservation(request: Request, options: RequestObservationOptions) {
  const requestId = resolveRequestId(request);
  const startedAt = Date.now();

  return {
    requestId,
    finish(response: Response, scope?: RequestObservationScope) {
      response.headers.set(REQUEST_ID_HEADER, requestId);
      writeStructuredRequestLog(buildStructuredRequestLogRecord({
        requestId,
        operation: options.operation,
        statusCode: response.status,
        durationMs: Date.now() - startedAt,
        documentType: options.documentType,
        scope,
      }));
      return response;
    },
  };
}
