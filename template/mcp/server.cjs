#!/usr/bin/env node
// 工程内自带的 MCP server:在项目根目录跑 `node mcp/server.cjs` 启动,供 AI harness 连接。
// 工具实现复用 create-tester 导出的引擎能力(readCaseFile / playwrightConfig / startPlaywrightTest 等),
// 由 create-tester 包提供依赖(@modelcontextprotocol/sdk / playwright 等)。
// 需要改工具行为?直接改这个文件即可,不依赖 create-tester 内部。

const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  readCaseFile,
  launchBrowser,
  playwrightConfig,
  getPageSnapshot,
  startPlaywrightTest,
  runPlaywrightTest,
  parseJsonReport
} = require('create-tester');

const PROJECT_ROOT = path.resolve(process.argv[2] || process.cwd());

function listFiles(dir, exts) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { recursive: true })) {
    const name = String(entry);
    if (exts.test(name)) out.push(path.join(dir, name));
  }
  return out.sort();
}

function textResult(text) {
  return { content: [{ type: 'text', text }] };
}

function defaultSpecFiles() {
  const dir = path.join(PROJECT_ROOT, 'tests');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true })
    .filter((f) => /\.spec\.(ts|js|mjs|tsx|jsx)$/.test(String(f)))
    .map((f) => path.join(dir, String(f)));
}

const server = new McpServer({ name: 'tester', version: '0.4.0' });

server.tool('list_cases', '列出 cases/ 目录下的测试用例文件', {}, () => {
  const files = listFiles(path.join(PROJECT_ROOT, 'cases'), /\.(xlsx|xls|xmind|csv|md|markdown|txt)$/i);
  return textResult(files.length ? files.join('\n') : '(cases/ 下没有用例文件)');
});

server.tool(
  'convert_case',
  '把 cases/ 下的用例文件(xlsx/xmind/csv/md/txt)转成结构化文本,供理解测试目标',
  { file: z.string().describe('cases/ 下的文件路径,如 cases/登录.xlsx') },
  ({ file }) => {
    const abs = path.resolve(PROJECT_ROOT, file);
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
    const pw = await launchBrowser(browser, { headless: true });
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

server.tool('list_specs', '列出 tests/ 目录下已生成的可执行用例(Playwright spec)', {}, () => {
  const files = listFiles(path.join(PROJECT_ROOT, 'tests'), /\.spec\.(ts|js|mjs|tsx|jsx)$/i);
  return textResult(files.length ? files.join('\n') : '(tests/ 下没有 spec,可先用 codegen 录制或让 AI 生成)');
});

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
    if (wait) {
      const { failures } = await runPlaywrightTest(list, PROJECT_ROOT, { headed });
      return textResult(JSON.stringify({ status: 'done', failures }, null, 2));
    }
    try {
      fs.rmSync(path.join(PROJECT_ROOT, 'result', 'test-results.json'), { force: true });
    } catch {}
    const { pid } = startPlaywrightTest(list, PROJECT_ROOT, { headed });
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
    const report = path.resolve(PROJECT_ROOT, file || 'result/test-results.json');
    if (!fs.existsSync(report)) return textResult(`未找到报告:${report}(测试可能仍在运行,稍后再查)`);
    const failures = parseJsonReport(fs.readFileSync(report, 'utf8'));
    if (!failures.length) return textResult('测试已跑完,报告中没有失败用例');
    return textResult(failures.map((f) => `【${f.title}】\n${f.error || '(无错误信息)'}`).join('\n\n'));
  }
);

const transport = new StdioServerTransport();
server.connect(transport);
