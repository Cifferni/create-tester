// MCP 服务器:tester 作为工具服务器暴露给 AI harness(Codex / opencode / Claude 等)
// 定位:不内置 AI,只暴露测试工程原语,AI 决策交给 harness。
//   convert_case   test-cases/ 用例文件(xlsx/xmind/md/csv/txt)→ 结构化文本
//   list_cases     列出 test-cases/ 下的用例文件
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
import { closeBrowser } from './browser';
import { launchBrowser } from './browser';
import { playwrightConfig } from './config';
import { getPageSnapshot } from './pagesnapshot';
import { startPlaywrightTest, runPlaywrightTest, parseJsonReport, summarizeJsonReport, failedSpecFiles } from './playwright';
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

// 目录/文件名安全化:去掉 Windows 不允许的字符,防路径穿越
function sanitizePath(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '').trim();
}

// 取用例文本里第一个有意义的行(去掉 markdown 标记/表格/URL),做 spec 标题
function firstMeaningfulLine(text: string): string {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^#+\s*/, '').replace(/^\|.*\|$/, '').trim();
    if (line.length >= 2 && !/^https?:\/\//.test(line)) return line;
  }
  return '';
}

function runMCP(): void {
  const root = projectRoot();
  const rootUrl = root.replace(/\\/g, '/');
  // 打印到 stderr:stdout 是 MCP 协议通道,不能污染
  console.error(`[tester] 工程根目录:${root}`);
  console.error('[tester] MCP 连接配置(粘贴到 AI harness,如 .mcp.json):');
  console.error(JSON.stringify(
    { mcpServers: { tester: { command: 'node', args: [`${rootUrl}/mcp/server.cjs`], cwd: rootUrl } } },
    null,
    2
  ));
  const server = new McpServer({ name: 'tester', version: '0.5.1' });

  server.tool(
    'list_cases',
    '列出 test-cases/ 目录下的测试用例文件',
    {},
    () => {
      const files = listFiles(path.join(projectRoot(), 'test-cases'), /\.(xlsx|xls|xmind|csv|md|markdown|txt)$/i);
      return textResult(files.length ? files.join('\n') : '(test-cases/ 下没有用例文件)');
    }
  );

  server.tool(
    'convert_case',
    '把 test-cases/ 下的用例文件(xlsx/xmind/csv/md/txt)转成结构化文本,供理解测试目标',
    { file: z.string().describe('test-cases/ 下的文件路径,如 test-cases/登录.xlsx') },
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
      // 复用 server 内的共享浏览器,只开关页面
      const pw = await launchBrowser(browser as BrowserName, { headless: true });
      const page = await pw.newPage();
      try {
        await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
        const snapshot = await getPageSnapshot(page);
        return textResult(`页面地址:${baseURL}\n\n${snapshot}`);
      } finally {
        await page.close();
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

  server.tool(
    'status',
    '读取 result/test-results.json 报告,返回通过/失败/跳过/耗时总览(供 AI 一眼看清整轮结果)',
    { file: z.string().optional().describe('JSON 报告路径,默认 result/test-results.json') },
    ({ file }) => {
      const report = cwdResolve(file || 'result/test-results.json');
      if (!fs.existsSync(report)) return textResult(`未找到报告:${report}(测试可能仍在运行,稍后再查)`);
      const s = summarizeJsonReport(fs.readFileSync(report, 'utf8'));
      if (!s) return textResult('报告解析失败');
      const lines = [
        `通过 ${s.passed} / 失败 ${s.failed} / 跳过 ${s.skipped} / 共 ${s.total} / 耗时 ${s.durationMs}ms`,
        s.failed ? `失败用例:\n${s.failures.map((f) => `- ${f.title}`).join('\n')}` : '(全部通过)'
      ];
      return textResult(lines.join('\n'));
    }
  );

  server.tool(
    'retry_failed',
    '重跑上一次报告中的失败用例(只重跑失败的 spec,不做全量),缺省后台运行,用 failures/status 轮询',
    {
      headed: z.boolean().optional().describe('是否带界面执行,默认无头'),
      wait: z.boolean().optional().describe('true=同步等跑完返回结果;缺省后台运行+轮询')
    },
    async ({ headed, wait }) => {
      const report = path.join(projectRoot(), 'result', 'test-results.json');
      if (!fs.existsSync(report)) return textResult('未找到上次报告:result/test-results.json(先跑一次 run_tests)');
      const files = failedSpecFiles(fs.readFileSync(report, 'utf8'));
      if (!files.length) return textResult('上次报告中没有失败用例,无需重跑');
      if (wait) {
        const { failures } = await runPlaywrightTest(files, projectRoot(), { headed });
        return textResult(JSON.stringify({ status: 'done', reran: files.length, failures }, null, 2));
      }
      try {
        fs.rmSync(path.join(projectRoot(), 'result', 'test-results.json'), { force: true });
      } catch {}
      const { pid } = startPlaywrightTest(files, projectRoot(), { headed });
      return textResult(
        JSON.stringify(
          { status: 'running', pid, reran: files.length, note: '只重跑上次失败的 spec,用 failures/status 轮询' },
          null,
          2
        )
      );
    }
  );

  server.tool(
    'generate_spec',
    '根据 test-cases/ 下的用例文件生成一个 Playwright spec 骨架(含 apiRecorder/断言模板),写到 tests/<feature>/。AI 再用 snapshot 看页面结构补选择器,然后 run_tests',
    {
      case: z.string().describe('test-cases/ 下的用例文件,如 test-cases/登录.xlsx'),
      feature: z.string().optional().describe('功能模块名,决定 tests/ 下子目录;缺省用用例文件名'),
      url: z.string().optional().describe('被测页面地址(可选,写进骨架的 goto)')
    },
    ({ case: caseFile, feature, url }) => {
      const abs = cwdResolve(caseFile);
      if (!fs.existsSync(abs)) return textResult(`文件不存在:${caseFile}`);
      const text = readCaseFile(abs);
      const base = path.basename(abs, path.extname(abs));
      const featureName = sanitizePath((feature || base).trim() || base);
      const targetDir = path.join(projectRoot(), 'tests', featureName);
      const targetFile = path.join(targetDir, `${sanitizePath(base) || 'case'}.spec.ts`);
      fs.mkdirSync(targetDir, { recursive: true });
      const rel = path.relative(path.dirname(targetFile), path.join(projectRoot(), 'mcp', 'api.cjs')).replace(/\\/g, '/');
      const caseRef = path.relative(projectRoot(), abs).replace(/\\/g, '/');
      const guide = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 12)
        .map((l) => `// ${l}`)
        .join('\n');
      const goto = url
        ? `  await page.goto('${url}');`
        : `  // await page.goto('/');  // 用 snapshot 看结构后填路径`;
      const skeleton = `import { test, expect } from '@playwright/test';
import { apiRecorder, expectApi } from '${rel}';

// 用例来源: ${caseRef}
${guide}

test('${firstMeaningfulLine(text) || base}', async ({ page }) => {
  const api = apiRecorder(page);
${goto}
  // TODO: 用 snapshot 工具看页面结构,补元素定位与操作
  // 例: await page.getByTestId('username').fill('test01');
  //     await page.getByTestId('login-submit').click();
  //     await expectApi(api, '/api/login').code('0');
});
`;
      fs.writeFileSync(targetFile, skeleton, 'utf8');
      return textResult(`已生成:${targetFile}\n用 snapshot 看页面结构补选择器,然后 run_tests 或 retry_failed`);
    }
  );

  const transport = new StdioServerTransport();
  void server.connect(transport);
  // server 退出时关掉共享浏览器,避免残留进程
  process.on('exit', () => {
    void closeBrowser();
  });
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
