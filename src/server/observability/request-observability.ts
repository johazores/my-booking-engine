import { randomUUID } from 'node:crypto';

import { REQUEST_ID_HEADER, isSafeRequestId } from '../../lib/request-correlation.ts';
import {
  emitStructuredObservationSafely,
  safeObservationClockMs,
  safeObservationDurationMs,
  safeObservationTimestamp,
} from './structured-log-safety.ts';

export type RequestLogDocumentType = 'tax-invoice' | 'adjustment-note';
export type RequestLogOutcome = 'succeeded' | 'rejected' | 'failed';
export type RequestLogFailureOutcome = Exclude<RequestLogOutcome, 'succeeded'>;
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

export type StructuredRequestLogSink = (record: StructuredRequestLogRecord) => void;

interface RequestObservationOptions {
  operation: string;
  documentType?: RequestLogDocumentType;
}

interface RequestCompletionOptions {
  failureOutcome?: RequestLogFailureOutcome;
}

interface RequestObservationDependencies {
  sink?: StructuredRequestLogSink;
  now?: () => Date;
  nowMs?: () => number;
  randomUuid?: () => string;
}

const SAFE_LOG_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;
const REQUEST_ID_UNAVAILABLE = 'request-id-unavailable';

function safeLogIdentifier(value: string | undefined) {
  return value && SAFE_LOG_IDENTIFIER_PATTERN.test(value) ? value : undefined;
}

export function resolveRequestId(request: Request, randomUuidFactory: () => string = randomUUID) {
  const requestId = request.headers.get(REQUEST_ID_HEADER);
  if (isSafeRequestId(requestId)) return requestId;

  try {
    const generated = randomUuidFactory();
    return isSafeRequestId(generated) ? generated : REQUEST_ID_UNAVAILABLE;
  } catch {
    return REQUEST_ID_UNAVAILABLE;
  }
}

function classifyStatus(
  statusCode: number,
  failureOutcome?: RequestLogFailureOutcome,
): { level: RequestLogLevel; outcome: RequestLogOutcome } {
  if (statusCode >= 500) return { level: 'error', outcome: 'failed' };
  if (failureOutcome === 'failed') return { level: 'error', outcome: 'failed' };
  if (statusCode >= 400 || failureOutcome === 'rejected') return { level: 'warn', outcome: 'rejected' };
  return { level: 'info', outcome: 'succeeded' };
}

export function buildStructuredRequestLogRecord(input: {
  requestId: string;
  operation: string;
  statusCode: number;
  durationMs: number;
  documentType?: RequestLogDocumentType;
  scope?: RequestObservationScope;
  failureOutcome?: RequestLogFailureOutcome;
  now?: () => Date;
}): StructuredRequestLogRecord {
  const classification = classifyStatus(input.statusCode, input.failureOutcome);
  const record: StructuredRequestLogRecord = {
    timestamp: safeObservationTimestamp(input.now ?? (() => new Date())),
    level: classification.level,
    event: 'http.request.completed',
    requestId: isSafeRequestId(input.requestId) ? input.requestId : 'invalid-request-id',
    operation: safeLogIdentifier(input.operation) ?? 'unknown-operation',
    outcome: classification.outcome,
    statusCode: input.statusCode,
    durationMs: Number.isFinite(input.durationMs) ? Math.max(0, Math.round(input.durationMs)) : 0,
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

export function createRequestObservation(
  request: Request,
  options: RequestObservationOptions,
  dependencies: RequestObservationDependencies = {},
) {
  const nowMs = dependencies.nowMs ?? Date.now;
  const requestId = resolveRequestId(request, dependencies.randomUuid ?? randomUUID);
  const startedAt = safeObservationClockMs(nowMs);
  const sink = dependencies.sink ?? writeStructuredRequestLog;

  return {
    requestId,
    finish(
      response: Response,
      scope?: RequestObservationScope,
      completion?: RequestCompletionOptions,
    ) {
      try {
        response.headers.set(REQUEST_ID_HEADER, requestId);
      } catch {
        // Correlation metadata must never replace an otherwise valid application response.
      }

      const record = buildStructuredRequestLogRecord({
        requestId,
        operation: options.operation,
        statusCode: response.status,
        durationMs: safeObservationDurationMs(startedAt, nowMs),
        documentType: options.documentType,
        scope,
        failureOutcome: completion?.failureOutcome,
        now: dependencies.now,
      });
      emitStructuredObservationSafely(sink, record);
      return response;
    },
  };
}
