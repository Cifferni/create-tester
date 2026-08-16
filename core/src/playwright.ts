// Playwright 执行层封装:定位 @playwright/test CLI、跑测试、解析 JSON 报告。
// 执行全部交给 Playwright 原生 runner,这里只做薄薄一层调用。

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import type { TestFailure } from './types';

// 优先从工程目录(cwd)解析 @playwright/test CLI:
// 让 server 用工程自己的那份 @playwright/test(spec 也导入它,保证同一份,避免"两个版本"冲突)。
// 工程里没有时退回 create-tester 自带的。
function playwrightTestCli(cwd?: string): string | null {
  try {
    if (cwd) return require.resolve('@playwright/test/cli', { paths: [cwd] });
    return require.resolve('@playwright/test/cli');
  } catch {
    return null;
  }
}

function spawnCapture(args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // windowsHide:避免 Windows 每次跑测试弹控制台窗口
    const child = spawn(process.execPath, args, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// 后台启动 Playwright,立即返回(测试可能超过 MCP 客户端 60s 请求超时,不能同步等)。
// 结果由 config 的 reporter 写盘:test-result/test-results.json(失败解析)+ test-result/report/index.html(结果页)。
export function startPlaywrightTest(
  files: string[],
  cwd: string,
  opts: { headed?: boolean; workers?: number; grep?: string } = {}
): { pid: number } {
  const cli = playwrightTestCli(cwd);
  if (!cli) throw new Error('未找到 @playwright/test,请先 npm install');
  // 不传 --workers:让 playwright.config.ts 的 workers/fullyParallel 生效;传了则覆盖(提速用,需用例隔离)
  const args: string[] = [cli, 'test', '--output=test-result/output'];
  if (opts.workers) args.push(`--workers=${opts.workers}`);
  if (opts.headed) args.push('--headed');
  if (opts.grep) args.push(`--grep=${opts.grep}`);
  args.push(...files);
  // detached + stdio ignore:不受 server 生命周期影响,也不会因管道满而阻塞
  // windowsHide:Windows 上 detached 默认会新建一个控制台窗口,藏掉它(否则每次 run_tests 都弹一个终端)
  const child = spawn(process.execPath, args, { cwd, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return { pid: child.pid ?? 0 };
}

// 跑指定 spec 文件,返回失败用例
export async function runPlaywrightTest(
  files: string[],
  cwd: string,
  opts: { timeoutMs?: number; headed?: boolean; workers?: number; grep?: string } = {}
): Promise<{ failures: TestFailure[]; raw: string }> {
  const cli = playwrightTestCli(cwd);
  if (!cli) throw new Error('未找到 @playwright/test,请先 npm install');
  // 不传 --reporter,让 playwright.config.ts 的 reporter 生效:
  // HTML 结果页(test-result/report/index.html)和 JSON 报告(test-result/test-results.json)都会生成。
  // 之前用 --reporter=json 会覆盖 config,导致没有结果页、failures 工具也读不到报告。
  const args: string[] = [
    cli,
    'test',
    '--output=test-result/output'
  ];
  if (opts.workers) args.push(`--workers=${opts.workers}`);
  if (opts.headed) args.push('--headed');
  if (opts.grep) args.push(`--grep=${opts.grep}`);
  args.push(...files);
  const timeoutMs = opts.timeoutMs ?? 180000;
  const timer = setTimeout(() => {
    // 超时:由调用方兜底(测试可能仍在跑)
  }, timeoutMs);
  const { stdout } = await spawnCapture(args, cwd);
  clearTimeout(timer);
  // 结果来源:优先读 config 生成的 test-result/test-results.json(config 没配 json reporter 时退回 stdout)
  const reportFile = path.join(cwd, 'test-result', 'test-results.json');
  const raw = fs.existsSync(reportFile) ? fs.readFileSync(reportFile, 'utf8') : stdout;
  const failures = parseJsonReport(raw);
  return { failures, raw };
}

export interface JsonTest {
  title: string;
  status: string;
  error?: { message?: string };
  results?: Array<{
    status?: string;
    error?: { message?: string };
    stdout?: Array<{ text?: string }>;
    stderr?: Array<{ text?: string }>;
  }>;
}

function joinLines(arr: Array<{ text?: string }> | undefined, limit: number): string {
  if (!arr || !arr.length) return '';
  return arr.map((x) => x.text || '').join('').slice(0, limit);
}

import type { FailureCategory } from './types';

// 失败原因分类:按错误信息关键词判断,方便测试人员/ AI 一眼知道"挂在哪一层"。
// 优先级:超时 > 网络 > 定位 > 断言 > 脚本。
export function classifyFailure(error: string): FailureCategory {
  const e = error || '';
  const has = (patterns: RegExp): boolean => patterns.test(e);
  if (has(/timed out|timeout|exceeded|Timed Out|超时/i)) return '超时';
  if (has(/net::|ERR_|Failed to fetch|ECONN|network error|无法访问|网络/i)) return '网络';
  if (has(/strict mode violation|waiting for selector|waiting for locator|element is not attached|Element not found|no element|not visible|не найден|未找到元素|定位/i)) return '定位';
  if (has(/expect\(|expect\s|assert|Expected|Received|toEqual|toBe|contain/i)) return '断言';
  if (has(/TypeError|ReferenceError|SyntaxError|is not a function|Cannot read|Undefined/i)) return '脚本';
  return '其他';
}

export function parseJsonReport(raw: string): TestFailure[] {
  const failures: TestFailure[] = [];
  let data: { suites?: unknown[] } | null = null;
  try {
    data = JSON.parse(raw) as { suites?: unknown[] };
  } catch {
    return failures;
  }
  const walk = (suites: unknown[]): void => {
    for (const s of suites as Array<{ suites?: unknown[]; specs?: unknown[] }>) {
      if (s.suites?.length) walk(s.suites);
      for (const spec of s.specs || []) {
        const sp = spec as { title?: string; tests?: JsonTest[] };
        for (const t of sp.tests || []) {
          const result = t.results?.[t.results.length - 1];
          if (result?.status === 'failed' || t.status === 'failed' || result?.status === 'timedOut') {
            const errMsg = result?.error?.message || t.error?.message || '(无错误信息)';
            failures.push({
              // 报告里用例标题在 spec.title(tests[] 没有 title 字段)
              title: sp.title || t.title || '',
              error: errMsg,
              category: classifyFailure(errMsg),
              // 透出每条用例的 console 输出(只给开头一段,诊断看头部足够,省 token)
              stdout: joinLines(result?.stdout, 600),
              stderr: joinLines(result?.stderr, 400)
            });
          }
        }
      }
    }
  };
  if (data.suites?.length) walk(data.suites);
  return failures;
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  failures: TestFailure[];
}

// 报告总览:通过/失败/跳过/耗时 + 失败详情
export function summarizeJsonReport(raw: string): TestSummary | null {
  let data: { stats?: Record<string, unknown>; suites?: unknown[] } | null = null;
  try {
    data = JSON.parse(raw) as { stats?: Record<string, unknown>; suites?: unknown[] };
  } catch {
    return null;
  }
  const stats = data.stats || {};
  const expected = Number(stats.expected) || 0;
  const unexpected = Number(stats.unexpected) || 0;
  const skipped = Number(stats.skipped) || 0;
  return {
    total: expected + unexpected + skipped,
    passed: expected,
    failed: unexpected,
    skipped,
    durationMs: Math.round(Number(stats.duration) || 0),
    failures: parseJsonReport(raw)
  };
}

// 报告里失败的 spec 文件(供 retry_failed 只重跑失败项)
export function failedSpecFiles(raw: string): string[] {
  const files = new Set<string>();
  let data: { suites?: unknown[] } | null = null;
  try {
    data = JSON.parse(raw) as { suites?: unknown[] };
  } catch {
    return [];
  }
  const walk = (suites: unknown[]): void => {
    for (const s of suites as Array<{ suites?: unknown[]; specs?: unknown[] }>) {
      if (s.suites?.length) walk(s.suites);
      for (const sp of s.specs || []) {
        const spec = sp as { file?: string; tests?: JsonTest[] };
        const failed = (spec.tests || []).some((t) => {
          const r = t.results?.[t.results.length - 1];
          return r?.status === 'failed' || t.status === 'failed' || r?.status === 'timedOut';
        });
        if (failed && spec.file) files.add(spec.file);
      }
    }
  };
  if (data.suites?.length) walk(data.suites);
  return [...files];
}

// 透传跑测试(不解析,直接继承 IO),返回退出码
export async function runPlaywrightTestPassthrough(files: string[], cwd: string): Promise<number> {
  const cli = playwrightTestCli(cwd);
  if (!cli) throw new Error('未找到 @playwright/test,请先 npm install');
  const args = [cli, 'test', ...files];
  return await new Promise((resolve) => {
    // windowsHide:避免 Windows 跑测试弹控制台窗口
    const child = spawn(process.execPath, args, { cwd, stdio: 'inherit', windowsHide: true });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

// ── 失败重试(代码化,不让 AI 反复对话) ──
// 定位/网络/超时 属于"可重试"的偶发失败,自动重跑最多 N 轮;断言失败是业务结果,不自动重试(可能是真 bug)。
// 返回最终失败(带分类)。这个函数同步等结果,供"跑完一次性拿结果"的场景(如 tester_run_tests 的 wait 模式)。
export interface RetryOptions {
  maxRounds?: number; // 最多重试几轮,默认 2
  timeoutMs?: number; // 单轮超时,默认 180s
}

export async function runWithRetry(
  files: string[],
  cwd: string,
  opts: RetryOptions = {}
): Promise<{ failures: TestFailure[]; attempts: number }> {
  const { maxRounds = 2, timeoutMs = 180000 } = opts;
  let attempts = 0;
  const RETRYABLE: FailureCategory[] = ['定位', '网络', '超时'];
  for (let round = 0; round <= maxRounds; round++) {
    attempts++;
    const { failures } = await runPlaywrightTest(files, cwd, { timeoutMs });
    const retryable = failures.filter((f) => RETRYABLE.includes(f.category ?? '其他'));
    if (!retryable.length) return { failures, attempts }; // 没有可重试的失败,结束
    // 还有可重试失败且未到上限:整批重跑(定位/网络/超时多为偶发,整批重跑成本可接受)
  }
  const last = await runPlaywrightTest(files, cwd, { timeoutMs });
  return { failures: last.failures, attempts: attempts + 1 };
}
