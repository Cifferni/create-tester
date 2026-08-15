// api.cjs 的类型声明(供 TS spec import:import { apiRecorder, expectApi } from '../mcp/api.cjs')
import type { Page } from '@playwright/test';

export interface CapturedApi {
  method: string;
  url: string;
  reqBody?: string;
  status?: number;
  durationMs?: number;
  resBody?: string;
}

export interface FieldAssertion {
  equals(value: string | number | boolean | null): FieldAssertion;
  notEquals(value: unknown): FieldAssertion;
  contains(value: string): FieldAssertion;
  notEmpty(): FieldAssertion;
  isEmpty(): FieldAssertion;
  value(): unknown;
}

export interface ApiAssertion {
  api: CapturedApi;
  json(): Record<string, unknown>;
  status(expected?: number): ApiAssertion;
  code(expected: string | number): ApiAssertion;
  field(dotPath: string): FieldAssertion;
}

export function apiRecorder(page: Page): CapturedApi[];

export function expectApi(
  logs: CapturedApi[],
  urlKeyword: string,
  opts?: { timeout?: number; expectSuccess?: boolean }
): Promise<ApiAssertion>;

export type BrowserName = 'chromium' | 'chrome' | 'firefox' | 'webkit';

export interface TestFailure {
  title: string;
  error?: string;
  location?: string;
}
