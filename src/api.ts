// 接口自动断言:页面操作时自动捕获请求/响应,提供链式断言
// 这是 tester 相对"裸 Playwright"的差异化能力——测试人员不用手写 waitForResponse,
// 只要开着捕获器,任何操作触发的接口都能直接用 URL 关键字断言。

import { type Page } from '@playwright/test';
import type { CapturedApi } from './types';

const SKIP_URL = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map)(\?|$)/i;

// 开启自动抓包:在 page 上挂监听,返回本次捕获的接口列表
export function apiRecorder(page: Page): CapturedApi[] {
  const logs: CapturedApi[] = [];
  const startedAt = new Map<CapturedApi, number>();
  page.on('request', (req) => {
    if (SKIP_URL.test(req.url())) return;
    const log: CapturedApi = { method: req.method(), url: req.url(), reqBody: req.postData() ?? '' };
    startedAt.set(log, Date.now());
    logs.push(log);
  });
  page.on('response', async (res) => {
    if (SKIP_URL.test(res.url())) return;
    if (/image|font|audio|video/.test(res.headers()['content-type'] || '')) return;
    for (let i = logs.length - 1; i >= 0; i--) {
      const log = logs[i];
      if (log.url === res.url() && log.status === undefined) {
        log.status = res.status();
        const t0 = startedAt.get(log);
        if (t0 !== undefined) log.durationMs = Date.now() - t0;
        try {
          log.resBody = (await res.text()).slice(0, 30000);
        } catch {
          log.resBody = '(无法读取响应体)';
        }
        break;
      }
    }
  });
  return logs;
}

function findLast(logs: CapturedApi[], urlKeyword: string): CapturedApi | undefined {
  for (let i = logs.length - 1; i >= 0; i--) {
    const log = logs[i];
    if (log.url.includes(urlKeyword) && log.status !== undefined && log.resBody !== undefined) return log;
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonPath(body: string | undefined, dotPath: string): unknown {
  if (!body) return undefined;
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    return dotPath.split('.').reduce<unknown>((o, k) => {
      if (o == null) return o;
      return (o as Record<string, unknown>)[k];
    }, json);
  } catch {
    return undefined;
  }
}

export interface ApiAssertion {
  api: CapturedApi;
  json(): Record<string, unknown>;
  /** 断言 HTTP 状态码(缺省时只要求成功 2xx) */
  status(expected?: number): ApiAssertion;
  /** 断言业务码(自动兼容字符串/数字),如 code: '0' */
  code(expected: string | number): ApiAssertion;
  /** 断言响应体字段,返回细粒度断言 */
  field(dotPath: string): FieldAssertion;
}

export interface FieldAssertion {
  equals(value: string | number | boolean | null): FieldAssertion;
  notEquals(value: unknown): FieldAssertion;
  contains(value: string): FieldAssertion;
  notEmpty(): FieldAssertion;
  isEmpty(): FieldAssertion;
  value(): unknown;
}

// 按 URL 关键字找到最新一条响应并断言(找不到会等到 timeout)
export async function expectApi(
  logs: CapturedApi[],
  urlKeyword: string,
  opts: { timeout?: number; expectSuccess?: boolean } = {}
): Promise<ApiAssertion> {
  const { timeout = 15000, expectSuccess = true } = opts;
  const deadline = Date.now() + timeout;
  let log: CapturedApi | undefined;
  while (Date.now() < deadline) {
    log = findLast(logs, urlKeyword);
    if (log) break;
    await sleep(100);
  }
  if (!log) throw new Error(`未捕获到接口 ${urlKeyword} 的响应(请确认操作是否触发该请求)`);
  if (expectSuccess && log.status !== undefined && log.status >= 400) {
    throw new Error(`接口 ${urlKeyword} 状态码异常:${log.status}\n响应体:${log.resBody || '(无)'}`);
  }

  const assertion: ApiAssertion = {
    api: log,
    json: () => {
      try {
        return JSON.parse(log.resBody || '{}') as Record<string, unknown>;
      } catch {
        throw new Error(`接口 ${urlKeyword} 响应不是合法 JSON:${log.resBody}`);
      }
    },
    status: (expected) => {
      if (expected !== undefined && log.status !== expected) {
        throw new Error(`接口 ${urlKeyword} 状态码 ${log.status} ≠ 期望 ${expected}`);
      }
      if (expected === undefined && log.status !== undefined && log.status >= 400) {
        throw new Error(`接口 ${urlKeyword} 状态码异常:${log.status}`);
      }
      return assertion;
    },
    code: (expected) => {
      const actual = jsonPath(log.resBody, 'code');
      if (String(actual) !== String(expected)) {
        throw new Error(`接口 ${urlKeyword} 业务码 ${String(actual)} ≠ 期望 ${expected}\n响应体:${log.resBody || '(无)'}`);
      }
      return assertion;
    },
    field: (dotPath) => {
      const read = () => jsonPath(log.resBody, dotPath);
      const f: FieldAssertion = {
        equals: (value) => {
          if (String(read()) !== String(value)) {
            throw new Error(`接口 ${urlKeyword} ${dotPath} = ${String(read())} ≠ 期望 ${String(value)}`);
          }
          return f;
        },
        notEquals: (value) => {
          if (String(read()) === String(value)) {
            throw new Error(`接口 ${urlKeyword} ${dotPath} 不应等于 ${String(value)}`);
          }
          return f;
        },
        contains: (value) => {
          if (!String(read() ?? '').includes(String(value))) {
            throw new Error(`接口 ${urlKeyword} ${dotPath} 应包含 "${value}",实际 ${String(read())}`);
          }
          return f;
        },
        notEmpty: () => {
          const v = read();
          if (v === null || v === undefined || v === '') {
            throw new Error(`接口 ${urlKeyword} 字段 ${dotPath} 不应为空`);
          }
          return f;
        },
        isEmpty: () => {
          const v = read();
          if (v !== null && v !== undefined && v !== '') {
            throw new Error(`接口 ${urlKeyword} 字段 ${dotPath} 应为空,实际 ${String(v)}`);
          }
          return f;
        },
        value: read
      };
      return f;
    }
  };
  return assertion;
}
