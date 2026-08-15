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
    const child = spawn(process.execPath, args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// 后台启动 Playwright,立即返回(测试可能超过 MCP 客户端 60s 请求超时,不能同步等)。
// 结果由 config 的 reporter 写盘:result/test-results.json(失败解析)+ result/index.html(结果页)。
export function startPlaywrightTest(
  files: string[],
  cwd: string,
  opts: { headed?: boolean; workers?: number } = {}
): { pid: number } {
  const cli = playwrightTestCli(cwd);
  if (!cli) throw new Error('未找到 @playwright/test,请先 npm install');
  // 不传 --workers:让 playwright.config.ts 的 workers/fullyParallel 生效;传了则覆盖(提速用,需用例隔离)
  const args: string[] = [cli, 'test', '--output=result/output'];
  if (opts.workers) args.push(`--workers=${opts.workers}`);
  if (opts.headed) args.push('--headed');
  args.push(...files);
  // detached + stdio ignore:不受 server 生命周期影响,也不会因管道满而阻塞
  const child = spawn(process.execPath, args, { cwd, detached: true, stdio: 'ignore' });
  child.unref();
  return { pid: child.pid ?? 0 };
}

// 跑指定 spec 文件,返回失败用例
export async function runPlaywrightTest(
  files: string[],
  cwd: string,
  opts: { timeoutMs?: number; headed?: boolean; workers?: number } = {}
): Promise<{ failures: TestFailure[]; raw: string }> {
  const cli = playwrightTestCli(cwd);
  if (!cli) throw new Error('未找到 @playwright/test,请先 npm install');
  // 不传 --reporter,让 playwright.config.ts 的 reporter 生效:
  // HTML 结果页(result/index.html)和 JSON 报告(result/test-results.json)都会生成。
  // 之前用 --reporter=json 会覆盖 config,导致没有结果页、failures 工具也读不到报告。
  const args: string[] = [
    cli,
    'test',
    '--output=result/output'
  ];
  if (opts.workers) args.push(`--workers=${opts.workers}`);
  if (opts.headed) args.push('--headed');
  args.push(...files);
  const timeoutMs = opts.timeoutMs ?? 180000;
  const timer = setTimeout(() => {
    // 超时:由调用方兜底(测试可能仍在跑)
  }, timeoutMs);
  const { stdout } = await spawnCapture(args, cwd);
  clearTimeout(timer);
  // 结果来源:优先读 config 生成的 result/test-results.json(config 没配 json reporter 时退回 stdout)
  const reportFile = path.join(cwd, 'result', 'test-results.json');
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
            failures.push({
              // 报告里用例标题在 spec.title(tests[] 没有 title 字段)
              title: sp.title || t.title || '',
              error: result?.error?.message || t.error?.message || '(无错误信息)',
              // 透出每条用例的 console 输出,诊断不用再手扒报告
              stdout: joinLines(result?.stdout, 4000),
              stderr: joinLines(result?.stderr, 2000)
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
    const child = spawn(process.execPath, args, { cwd, stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
  });
}
