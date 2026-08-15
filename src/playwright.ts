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
  opts: { headed?: boolean } = {}
): { pid: number } {
  const cli = playwrightTestCli(cwd);
  if (!cli) throw new Error('未找到 @playwright/test,请先 npm install');
  // 不传 --workers:让 playwright.config.ts 的 workers/fullyParallel 生效(自动并行,比 --workers=1 串行快得多)
  const args: string[] = [cli, 'test', '--output=result/output'];
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
  opts: { timeoutMs?: number; headed?: boolean } = {}
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
  results?: Array<{ status?: string; error?: { message?: string } }>;
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
              error: result?.error?.message || t.error?.message || '(无错误信息)'
            });
          }
        }
      }
    }
  };
  if (data.suites?.length) walk(data.suites);
  return failures;
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
