// 接口自动断言:页面操作时自动捕获请求/响应,提供链式断言
// 这是 tester 相对"裸 Playwright"的差异化能力——测试人员不用手写 waitForResponse,
// 只要开着捕获器,任何操作触发的接口都能直接用 URL 关键字断言。

import { type Page, type Locator, expect as pwExpect } from '@playwright/test';
import type { CapturedApi } from './types';

const SKIP_URL = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map)(\?|$)/i;
const SKIP_PROTO = /^(data:|blob:)/i;

export interface ApiRecorderOptions {
  /** 只记录包含这些关键字的 URL(长流程省内存、只抓要断言的接口) */
  include?: string[];
  /** 最多缓存条数,防内存暴涨,缺省 300 */
  maxEntries?: number;
}

// 开启自动抓包:在 page 上挂监听,返回本次捕获的接口列表
// 建议:页面动作很多时传 { include: ['/api/login'] },只抓要断言的接口,避免内存暴涨
export function apiRecorder(page: Page, opts: ApiRecorderOptions = {}): CapturedApi[] {
  const logs: CapturedApi[] = [];
  const startedAt = new Map<CapturedApi, number>();
  const maxEntries = opts.maxEntries ?? 300;
  const matches = (url: string): boolean => {
    if (SKIP_URL.test(url) || SKIP_PROTO.test(url)) return false;
    if (!opts.include?.length) return true;
    return opts.include.some((k) => url.includes(k));
  };
  page.on('request', (req) => {
    if (!matches(req.url())) return;
    // 超出上限:不再记录新请求(防内存暴涨)
    if (logs.length >= maxEntries) return;
    const log: CapturedApi = { method: req.method(), url: req.url(), reqBody: req.postData() ?? '' };
    startedAt.set(log, Date.now());
    logs.push(log);
  });
  page.on('response', async (res) => {
    if (!matches(res.url())) return;
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
  /** 字段是数组时,断言数组包含某元素(元素按字符串比较) */
  containsValue(value: string | number): FieldAssertion;
  notEmpty(): FieldAssertion;
  isEmpty(): FieldAssertion;
  /** 断言字段(转成字符串)匹配正则,如 matches(/^user_\d+$/) */
  matches(regex: RegExp): FieldAssertion;
  /** 断言字段(转成字符串)不匹配正则 */
  notMatches(regex: RegExp): FieldAssertion;
  /** 断言数值在闭区间 [min, max] 内(字段是数字或可转数字的字符串) */
  between(min: number, max: number): FieldAssertion;
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
        containsValue: (value) => {
          const v = read();
          const arr = Array.isArray(v) ? v : [v];
          if (!arr.some((x) => String(x) === String(value))) {
            throw new Error(`接口 ${urlKeyword} ${dotPath} 应包含元素 ${String(value)},实际 ${JSON.stringify(v)}`);
          }
          return f;
        },
        matches: (regex) => {
          regex.lastIndex = 0;
          const s = String(read() ?? '');
          if (!regex.test(s)) {
            throw new Error(`接口 ${urlKeyword} ${dotPath} = "${s}" 不匹配 ${regex}`);
          }
          return f;
        },
        notMatches: (regex) => {
          regex.lastIndex = 0;
          const s = String(read() ?? '');
          if (regex.test(s)) {
            throw new Error(`接口 ${urlKeyword} ${dotPath} = "${s}" 不应匹配 ${regex}`);
          }
          return f;
        },
        between: (min, max) => {
          const v = read();
          const n = typeof v === 'number' ? v : Number(String(v ?? ''));
          if (!Number.isFinite(n)) {
            throw new Error(`接口 ${urlKeyword} ${dotPath} = ${String(v)} 不是数字,无法区间断言`);
          }
          if (n < min || n > max) {
            throw new Error(`接口 ${urlKeyword} ${dotPath} = ${n} 不在区间 [${min}, ${max}]`);
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

// ── 智能等待(替代硬编码 waitForTimeout)──────────────
// 全部基于 Playwright 原生自动等待(内置轮询 + 超时),禁止 AI 生成 page.waitForTimeout(硬编码延时,
// 机器慢/网络抖就崩,快就白等)。等的是"状态",不是"时间"。

/** 等待元素可见(缺省 10s,内部自动重试);不可见时给出定位信息,便于排查 */
export async function waitForVisible(locator: Locator, opts: { timeout?: number } = {}): Promise<void> {
  const { timeout = 10000 } = opts;
  await pwExpect(locator).toBeVisible({ timeout });
}

/** 等待元素可点击(可见 + 可用,缺省 10s);常用于"按钮灰着、loading 结束才可点"的场景 */
export async function waitForClickable(locator: Locator, opts: { timeout?: number } = {}): Promise<void> {
  const { timeout = 10000 } = opts;
  await pwExpect(locator).toBeEnabled({ timeout });
}

/** 等待文本出现在页面(缺省 10s);替代"sleep 几秒再看有没有" */
export async function waitForText(page: Page, text: string, opts: { timeout?: number } = {}): Promise<void> {
  const { timeout = 10000 } = opts;
  await pwExpect(page.locator('body')).toContainText(text, { timeout });
}

/** 等待 URL 命中(正则/字符串,缺省 15s);替代"等跳转固定时长" */
export async function waitForURL(page: Page, url: string | RegExp, opts: { timeout?: number } = {}): Promise<void> {
  const { timeout = 15000 } = opts;
  await pwExpect(page).toHaveURL(url, { timeout });
}

// ── 用例自愈(定位失败兜底) ──
// 当首选选择器定位失败时,用备选策略(text / testid / role / css)自动重试,减少文案/结构微调导致的大面积失效。
// 用法: const loc = await selfHeal(page, ['save-btn', '保存', 'button:has-text("保存")']); await loc.click();
//   —— 按顺序探测每个候选,返回第一个在页面上真实存在的 locator。

export interface SelfHealOptions {
  /** 每个候选的探测超时,缺省 2000ms(命中即可,不用太长) */
  timeout?: number;
}

/**
 * 探测候选定位器,返回第一个在页面上存在的。全部不存在时抛错并列出诊断。
 * candidates 每项:string 会自动尝试 testid → 文本 → CSS;也可直接传 Locator 或 { role, name }。
 * 命中后返回的 locator 后续 click/fill 由 Playwright 自动等待接管,不额外加硬延时。
 */
export async function selfHeal(page: Page, candidates: string[], opts: SelfHealOptions = {}): Promise<Locator> {
  const { timeout = 2000 } = opts;
  const failures: string[] = [];
  for (const c of candidates) {
    const looksCss = /[#.\[\]]/.test(c) && !/[^\w\u4e00-\u9fa5-#.\[\]()>+~ :*="']/.test(c);
    const pool: Locator[] = looksCss
      ? [page.locator(c)]
      : [page.getByTestId(c), page.getByText(c, { exact: true }).first(), page.locator(`text=${c}`).first()];
    for (const loc of pool) {
      try {
        const n = await loc.count();
        if (n > 0) return loc.first();
        failures.push(`"${c}"(无匹配)`);
      } catch {
        failures.push(`"${c}"(无效)`);
      }
    }
  }
  throw new Error(
    `自愈定位失败:候选 ${candidates.join(' | ')} 都未命中页面元素。\n` +
    `已尝试:${failures.join(', ')}\n` +
    `建议:用 browser_snapshot 看当前页面实际结构,修正选择器。`
  );
}

// ── 接口拦截 / Mock / 响应篡改 ──
// 基于 Playwright page.route()。测试需要"造数据/规避第三方依赖/模拟异常"时用,
// 真回归(要验证真实后端)不用 mock,保持定位诚实。

export interface MockResponse {
  /** 状态码,缺省 200 */
  status?: number;
  /** 响应体(字符串或 JSON),缺省空 */
  body?: string | Record<string, unknown>;
  /** Content-Type,缺省 application/json */
  contentType?: string;
  /** 额外响应头 */
  headers?: Record<string, string>;
}

export interface MockOptions {
  /** 缺省 false;true 时保留原始请求仍发给服务器(mock 响应作为"兜底"不生效,一般不用) */
  passthrough?: boolean;
}

/**
 * 拦截匹配 urlPattern 的请求,返回固定响应(mock 数据)。
 * urlPattern 用 Playwright 的 glob 语法(可含星号匹配任意路径段)。
 * 例: await mockRoute(page, '/api/login', { body: { code: '0', data: { token: 'mock' } } });
 */
export function mockRoute(page: Page, urlPattern: string, resp: MockResponse, opts: MockOptions = {}): void {
  const { status = 200, contentType = 'application/json' } = resp;
  const body = typeof resp.body === 'object' && resp.body !== null ? JSON.stringify(resp.body) : String(resp.body ?? '');
  void page.route(urlPattern, (route) => {
    if (opts.passthrough) {
      void route.fallback();
      return;
    }
    void route.fulfill({ status, body, contentType, headers: resp.headers }).catch(() => {});
  });
}

/**
 * 响应篡改:拦截请求,handler 里可改写响应(改状态码/body)或转交原始请求。
 * 用于模拟异常响应/造边界数据。
 * 例: await tamperResponse(page, '/api/order', async (route) => {
 *       await route.fulfill({ status: 500, body: 'server error' });   // 篡改响应
 *       // 或 await route.continue();  // 放行原请求
 *     });
 */
export function tamperResponse(
  page: Page,
  urlPattern: string,
  handler: (route: import('@playwright/test').Route) => Promise<void>
): void {
  void page.route(urlPattern, handler);
}
