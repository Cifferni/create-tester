// MCP 服务器:tester 作为工具服务器暴露给 AI harness(Codex / opencode / Claude 等)
// 定位:不内置 AI,只暴露测试工程原语,AI 决策交给 harness。
//   convert_case   cases/ 用例文件(xlsx/xmind/md/csv/txt)→ 结构化文本
//   list_cases     列出 cases/ 下的用例文件
//   snapshot       打开被测页面,返回可交互结构快照(供 harness 定位元素)
//   list_specs     列出 tests/ 下已生成的 spec
//   run_tests      跑 Playwright 测试,返回 JSON 结果
//   failures       读报告,返回失败用例详情(供 harness 判断根因)
// 启动: tester mcp (stdio transport,由 harness 以子进程方式拉起)

import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readCaseFile } from './cases';
import { launchBrowser } from './browser';
import { playwrightConfig } from './config';
import { getPageSnapshot } from './pagesnapshot';
import { startPlaywrightTest, runPlaywrightTest, parseJsonReport } from './playwright';
import type { BrowserName } from './types';

// 项目根目录:优先用 tester mcp <dir> 传的,缺省 process.cwd()
function projectRoot(): string {
  return process.env.TESTER_PROJECT_ROOT || process.cwd();
}

function cwdResolve(p: string): string {
  return path.resolve(projectRoot(), p);
}

function listFiles(dir: string, exts: RegExp): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { recursive: true })) {
    const name = String(entry);
    if (exts.test(name)) out.push(path.join(dir, name));
  }
  return out.sort();
}

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function runMCP(): void {
  const server = new McpServer({ name: 'tester', version: '0.4.0' });

  server.tool(
    'list_cases',
    '列出 cases/ 目录下的测试用例文件',
    {},
    () => {
      const files = listFiles(path.join(projectRoot(), 'cases'), /\.(xlsx|xls|xmind|csv|md|markdown|txt)$/i);
      return textResult(files.length ? files.join('\n') : '(cases/ 下没有用例文件)');
    }
  );

  server.tool(
    'convert_case',
    '把 cases/ 下的用例文件(xlsx/xmind/csv/md/txt)转成结构化文本,供理解测试目标',
    { file: z.string().describe('cases/ 下的文件路径,如 cases/登录.xlsx') },
    ({ file }) => {
      const abs = cwdResolve(file);
      if (!fs.existsSync(abs)) return textResult(`文件不存在:${file}`);
      return textResult(readCaseFile(abs));
    }
  );

  server.tool(
    'snapshot',
    '打开被测页面,返回当前页面的可交互结构快照(按钮/输入框/链接等),用于定位元素',
    { url: z.string().optional().describe('要打开的页面地址,缺省用 BASE_URL / playwright.config.ts 的 baseURL') },
    async ({ url }) => {
      const { baseURL, browser } = playwrightConfig(url);
      const pw = await launchBrowser(browser as BrowserName, { headless: true });
      try {
        const page = await pw.newPage();
        await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
        const snapshot = await getPageSnapshot(page);
        return textResult(`页面地址:${baseURL}\n\n${snapshot}`);
      } finally {
        await pw.close();
      }
    }
  );

  server.tool(
    'list_specs',
    '列出 tests/ 目录下已生成的可执行用例(Playwright spec)',
    {},
    () => {
      const files = listFiles(path.join(projectRoot(), 'tests'), /\.spec\.(ts|js|mjs|tsx|jsx)$/i);
      return textResult(files.length ? files.join('\n') : '(tests/ 下没有 spec,可先用 codegen 录制或让 AI 生成)');
    }
  );

  server.tool(
    'run_tests',
    '运行 Playwright 测试(默认 tests/ 全部)。缺省后台运行、立即返回"运行中",跑完用 failures 工具轮询结果;wait=true 则同步等跑完直接返回失败列表(需客户端设大超时,如 timeout:600000)。文件参数传相对路径,如 tests/login/登录.spec.ts',
    {
      files: z.array(z.string()).optional().describe('要跑的 spec 文件列表,缺省跑全部'),
      headed: z.boolean().optional().describe('是否带界面执行,默认无头'),
      wait: z.boolean().optional().describe('true=同步等跑完返回结果;缺省后台运行+用 failures 轮询')
    },
    async ({ files, headed, wait }) => {
      const list = files && files.length ? files : defaultSpecFiles();
      if (!list.length) return textResult(JSON.stringify({ error: '没有可运行的测试文件' }, null, 2));
      const root = projectRoot();
      if (wait) {
        const { failures } = await runPlaywrightTest(list, root, { headed });
        return textResult(JSON.stringify({ status: 'done', failures }, null, 2));
      }
      // 清掉旧报告:让 failures 的"未找到报告"能区分"还在跑"
      try {
        fs.rmSync(path.join(root, 'result', 'test-results.json'), { force: true });
      } catch {
        // 忽略
      }
      const { pid } = startPlaywrightTest(list, root, { headed });
      return textResult(
        JSON.stringify(
          { status: 'running', pid, note: '测试在后台运行,用 failures 工具轮询结果(未找到报告=仍在跑)' },
          null,
          2
        )
      );
    }
  );

  server.tool(
    'failures',
    '读取 result/test-results.json 报告,返回失败用例及其错误信息(供 AI 判断根因)。run_tests 是后台跑的,报告还没生成就说明仍在运行,应稍后轮询',
    { file: z.string().optional().describe('JSON 报告路径,默认 result/test-results.json') },
    ({ file }) => {
      const report = cwdResolve(file || 'result/test-results.json');
      if (!fs.existsSync(report)) return textResult(`未找到报告:${report}(测试可能仍在运行,稍后再查)`);
      const failures = parseJsonReport(fs.readFileSync(report, 'utf8'));
      if (!failures.length) return textResult('报告中没有失败用例');
      return textResult(failures.map((f) => `【${f.title}】\n${f.error || '(无错误信息)'}`).join('\n\n'));
    }
  );

  const transport = new StdioServerTransport();
  void server.connect(transport);
}

function defaultSpecFiles(): string[] {
  const dir = path.join(projectRoot(), 'tests');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true })
    .filter((f) => /\.spec\.(ts|js|mjs|tsx|jsx)$/.test(String(f)))
    .map((f) => path.join(dir, String(f)));
}

runMCP();
