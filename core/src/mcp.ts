// MCP 服务器(方案 A):页面操作交给官方 @playwright/mcp(browser_* 工具,含快照/点击/输入/断言),
// 本 server 只暴露"测试工程专属工具"(用例读取/生成/跑测/报告/登录/env),AI 编排靠两套 server 配合。
//   list_cases      列出 test-cases/ 下的用例文件
//   convert_case    test-cases/ 用例文件(xlsx/xmind/md/csv/txt)→ 结构化文本
//   tester_generate_spec   用例 → spec 骨架
//   tester_run_tests       跑 Playwright 测试(后台),tester_status/tester_failures 轮询
//   tester_failures/tester_status 读报告,返回失败详情/总览(供 harness 判断根因)
// 启动: tester mcp (stdio transport,由 harness 以子进程方式拉起)
// 注意:snapshot/inspect 等页面操作不再自研——用官方 @playwright/mcp 的 browser_snapshot/browser_find。

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readCaseFile } from './cases';
import { formatSyntaxErrors } from './checkSyntax';
import { closeBrowser } from './browser';
import { loadPlugins } from './plugins';
import { playwrightConfig } from './config';
import { startPlaywrightTest, summarizeJsonReport, failedSpecFiles } from './playwright';

// 项目根目录:优先用 tester mcp <dir> 传的,缺省 process.cwd()
function projectRoot(): string {
  return process.env.TESTER_PROJECT_ROOT || process.cwd();
}

// 当前账号的登录态文件名(多账号隔离,与 template/_login.ts 保持一致)
function authFileName(): string {
  const account = process.env.TESTER_ACCOUNT || 'default';
  return `auth-${account}.json`;
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
  console.error('[tester] MCP 连接配置(粘贴到 AI harness,如 .mcp.json;两套 server 都要配):');
  console.error(JSON.stringify(
    {
      mcpServers: {
        playwright: { command: 'npx', args: ['@playwright/mcp@latest', '--headless', '--config', `${rootUrl}/mcp/playwright-mcp.json`] },
        tester: { command: 'node', args: [`${rootUrl}/mcp/server.cjs`], cwd: rootUrl }
      }
    },
    null,
    2
  ));
  const server = new McpServer({ name: 'tester', version: '0.5.6' });
  // 插件体系:加载工程 plugin/ 目录的自定义插件(报告器/用例解析器/录制器)
  const plugins = loadPlugins(root);

  server.tool(
    'tester_list_cases',
    '列出 test-cases/ 目录下的测试用例文件',
    {},
    () => {
      const files = listFiles(path.join(projectRoot(), 'test-cases'), /\.(xlsx|xls|xmind|csv|md|markdown|txt)$/i);
      return textResult(files.length ? files.join('\n') : '(test-cases/ 下没有用例文件)');
    }
  );

  server.tool(
    'tester_convert_case',
    '把 test-cases/ 下的用例文件(xlsx/xmind/csv/md/txt)转成结构化文本;能识别"步骤/预期"列的表格会输出【前置/操作/预期/数据】。写 spec 时操作从"操作"来、断言从"预期"来,页面现状不等于预期。自定义格式可由 plugin/ 的用例解析器插件扩展',
    { file: z.string().describe('test-cases/ 下的文件路径,如 test-cases/登录.xlsx') },
    ({ file }) => {
      const abs = cwdResolve(file);
      if (!fs.existsSync(abs)) return textResult(`文件不存在:${file}`);
      // 插件用例解析器优先(自定义格式),没有命中才用内置解析
      for (const p of plugins.caseParsers) {
        try {
          const out = p.parseCase?.(abs);
          if (out) return textResult(out);
        } catch {
          // 单个插件失败不影响
        }
      }
      return textResult(readCaseFile(abs));
    }
  );

  server.tool(
    'tester_set_base_url',
    '设置被测页面地址:改写 playwright.config.ts 的 baseURL。测试人员在对话里说被测地址时调用,不需要测试人员改文件。环境变量 BASE_URL 优先,会覆盖这里',
    { url: z.string().describe('被测页面地址,如 http://localhost:5173') },
    ({ url }) => {
      const cfgFile = path.join(projectRoot(), 'playwright.config.ts');
      if (!fs.existsSync(cfgFile)) return textResult(`未找到 ${cfgFile}`);
      const text = fs.readFileSync(cfgFile, 'utf8');
      const re = /baseURL:\s*process\.env\.BASE_URL\s*\|\|\s*'[^']*'/;
      if (!re.test(text)) return textResult('未找到 baseURL 配置(playwright.config.ts 格式不匹配),请手动检查');
      const updated = text.replace(re, `baseURL: process.env.BASE_URL || '${url}'`);
      fs.writeFileSync(cfgFile, updated, 'utf8');
      return textResult(`已把被测地址设为 ${url}(playwright.config.ts 的 baseURL)\n若设置了环境变量 BASE_URL 则优先于它;下次 tester_run_tests 生效`);
    }
  );

  server.tool(
    'tester_env_reset',
    '执行工程内的环境清理脚本(mcp/env-reset.cjs),还原被测环境(删测试数据/还原状态),保证回归可复跑。脚本由 AI 按被测应用实现;跑会改数据的回归前建议先调它',
    {},
    () => {
      const script = path.join(projectRoot(), 'mcp', 'env-reset.cjs');
      if (!fs.existsSync(script)) return textResult(`未找到 ${script}(可让 AI 按被测应用写环境清理)`);
      const child = spawn(process.execPath, [script], { cwd: projectRoot(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      return new Promise((resolve) => {
        child.on('close', (code) => {
          const body = [out, err].filter(Boolean).join('\n').trim();
          resolve(textResult(`env_reset 退出码 ${code ?? 1}\n${body || '(无输出)'}`));
        });
      });
    }
  );

  server.tool(
    'tester_login',
    '后台打开带界面浏览器做人工登录(验证码/短信场景):返回后请在浏览器里完成登录并关掉,再用 tester_login_status 确认。无验证码时 auth.setup 会自动登录,一般不需要这个。多账号用 TESTER_ACCOUNT 环境变量区分(缺省 default)',
    {},
    () => {
      const root = projectRoot();
      const authFile = path.join(root, 'test-result', authFileName());
      if (fs.existsSync(authFile)) return textResult(`已有登录态:${authFile},无需重新登录`);
      const { baseURL } = playwrightConfig();
      fs.mkdirSync(path.join(root, 'test-result'), { recursive: true });
      // detached + windowsHide:不阻塞 MCP 请求、不弹终端窗口;浏览器窗口会正常打开
      const child = spawn(
        'npx',
        ['playwright', 'codegen', baseURL, `--save-storage=test-result/${authFileName()}`],
        { cwd: root, detached: true, stdio: 'ignore', windowsHide: true, shell: true }
      );
      child.unref();
      return textResult(`已在后台打开浏览器:${baseURL}\n请测试人员在浏览器里完成登录(输验证码/短信),然后关掉浏览器。\n之后用 tester_login_status 确认登录态已保存。`);
    }
  );

  server.tool(
    'tester_login_status',
    `检查人工登录是否完成(test-result/${authFileName()} 是否已生成)`,
    {},
    () => {
      const f = path.join(projectRoot(), 'test-result', authFileName());
      if (!fs.existsSync(f)) {
        return textResult(`未完成:test-result/${authFileName()} 还没生成(等测试人员在浏览器里完成登录并关掉浏览器)`);
      }
      const mtime = fs.statSync(f).mtime.toISOString();
      return textResult(`已完成:test-result/${authFileName()}(保存于 ${mtime}),登录态可复用,直接重跑测试`);
    }
  );

  server.tool(
    'tester_list_specs',
    '列出 tests/ 目录下已生成的可执行用例(Playwright spec)',
    {},
    () => {
      const files = listFiles(path.join(projectRoot(), 'tests'), /\.spec\.(ts|js|mjs|tsx|jsx)$/i);
      return textResult(files.length ? files.join('\n') : '(tests/ 下没有 spec,可先用 codegen 录制或让 AI 生成)');
    }
  );

  server.tool(
    'tester_run_tests',
    '后台运行 Playwright 测试(默认 tests/ 全部),立即返回"运行中",跑完用 tester_status/tester_failures 轮询结果。注意:不提供同步等待——客户端 MCP 有请求超时,同步等待大测试必断。文件参数传相对路径,如 tests/login/登录.spec.ts。跑前自动用 esbuild 做语法预检,有语法错误的 spec 直接列出、不会启动测试。可用 grep 按标签/标题筛选(如 @smoke、登录)',
    {
      files: z.array(z.string()).optional().describe('要跑的 spec 文件列表,缺省跑全部'),
      headed: z.boolean().optional().describe('是否带界面执行,默认无头'),
      workers: z.number().optional().describe('并行 worker 数,缺省用 config;提速用(需用例彼此隔离,否则会互踩)'),
      grep: z.string().optional().describe('只跑匹配的用例:传标签(如 @smoke)或标题关键字(如 登录),对应 Playwright --grep')
    },
    async ({ files, headed, workers, grep }) => {
      const list = files && files.length ? files : defaultSpecFiles();
      if (!list.length) return textResult(JSON.stringify({ error: '没有可运行的测试文件' }, null, 2));
      const root = projectRoot();
      // 语法预检:先验 spec 能解析,避免把跑不起来的脚本交给 Playwright 空跑
      const syntaxIssues: string[] = [];
      for (const f of list) {
        const errs = await formatSyntaxErrors(f);
        if (errs) syntaxIssues.push(`${f}\n${errs}`);
      }
      if (syntaxIssues.length) {
        return textResult(
          `以下 spec 存在语法错误,已停止运行(请先修复再跑):\n\n${syntaxIssues.join('\n\n')}`
        );
      }
      // 清掉旧报告:让 tester_status/tester_failures 的"未找到报告"能区分"还在跑"
      try {
        fs.rmSync(path.join(root, 'test-result', 'test-results.json'), { force: true });
      } catch {
        // 忽略
      }
      const { pid } = startPlaywrightTest(list, root, { headed, workers, grep });
      return textResult(
        JSON.stringify(
          { status: 'running', pid, grep: grep || undefined, note: '测试在后台运行,用 tester_status/tester_failures 轮询结果(未找到报告=仍在跑)' },
          null,
          2
        )
      );
    }
  );

  server.tool(
    'tester_failures',
    '读取 test-result/test-results.json 报告,返回整轮全貌 {total,passed,skipped,failed} + 失败用例详情(含错误分类[定位/断言/网络/超时/脚本/其他]、错误信息与 stdout/stderr 日志)。报告未生成说明仍在跑,应稍后轮询',
    { file: z.string().optional().describe('JSON 报告路径,默认 test-result/test-results.json') },
    ({ file }) => {
      const report = cwdResolve(file || 'test-result/test-results.json');
      if (!fs.existsSync(report)) return textResult(`未找到报告:${report}(测试可能仍在运行,稍后再查)`);
      const s = summarizeJsonReport(fs.readFileSync(report, 'utf8'));
      if (!s) return textResult('报告解析失败');
      const out: string[] = [
        `共 ${s.total} | 通过 ${s.passed} | 失败 ${s.failed} | 跳过 ${s.skipped} | 耗时 ${s.durationMs}ms`
      ];
      if (!s.failures.length) {
        out.push('(没有失败用例)');
      } else {
        // 错误分类汇总:定位/断言/网络/超时/脚本/其他 各多少
        const byCat = new Map<string, number>();
        for (const f of s.failures) {
          const c = f.category || '其他';
          byCat.set(c, (byCat.get(c) || 0) + 1);
        }
        out.push(`\n错误分类:${[...byCat.entries()].map(([c, n]) => `${c} ${n}`).join(' | ') || '无'}`);
        for (const f of s.failures) {
          out.push(`\n【${f.title}】[${f.category || '其他'}]`);
          if (f.error && f.error !== '(无错误信息)') out.push(f.error);
          if (f.stdout) out.push(`stdout:\n${f.stdout}`);
          if (f.stderr) out.push(`stderr:\n${f.stderr}`);
        }
      }
      return textResult(out.join('\n'));
    }
  );

  server.tool(
    'tester_status',
    '读取 test-result/test-results.json 报告,返回通过/失败/跳过/耗时总览(供 AI 一眼看清整轮结果)',
    { file: z.string().optional().describe('JSON 报告路径,默认 test-result/test-results.json') },
    ({ file }) => {
      const report = cwdResolve(file || 'test-result/test-results.json');
      if (!fs.existsSync(report)) return textResult(`未找到报告:${report}(测试可能仍在运行,稍后再查)`);
      const s = summarizeJsonReport(fs.readFileSync(report, 'utf8'));
      if (!s) return textResult('报告解析失败');
      // 报告器插件:每轮结束触发(通知/归档等),失败也不阻塞结果返回
      for (const p of plugins.reporters) {
        try {
          void p.onSummary?.(s);
        } catch {
          // 忽略
        }
      }
      const lines = [
        `通过 ${s.passed} / 失败 ${s.failed} / 跳过 ${s.skipped} / 共 ${s.total} / 耗时 ${s.durationMs}ms`,
        s.failed ? `失败用例:\n${s.failures.map((f) => `- ${f.title}`).join('\n')}` : '(全部通过)'
      ];
      return textResult(lines.join('\n'));
    }
  );

  server.tool(
    'tester_retry_failed',
    '后台重跑上一次报告中的失败用例(只重跑失败的 spec,不做全量),立即返回"运行中",用 tester_status/tester_failures 轮询。不做同步等待(客户端 MCP 有请求超时)。跑前同样做 esbuild 语法预检。可用 grep 只重跑匹配标签/标题的失败用例',
    {
      headed: z.boolean().optional().describe('是否带界面执行,默认无头'),
      workers: z.number().optional().describe('并行 worker 数,缺省用 config;提速用(需用例隔离)'),
      grep: z.string().optional().describe('只重跑匹配的用例(标签或标题关键字)')
    },
    async ({ headed, workers, grep }) => {
      const report = path.join(projectRoot(), 'test-result', 'test-results.json');
      if (!fs.existsSync(report)) return textResult('未找到上次报告:test-result/test-results.json(先跑一次 tester_run_tests)');
      const files = failedSpecFiles(fs.readFileSync(report, 'utf8'));
      if (!files.length) return textResult('上次报告中没有失败用例,无需重跑');
      const syntaxIssues: string[] = [];
      for (const f of files) {
        const errs = await formatSyntaxErrors(f);
        if (errs) syntaxIssues.push(`${f}\n${errs}`);
      }
      if (syntaxIssues.length) {
        return textResult(`以下失败 spec 存在语法错误,已停止重跑(请先修复再跑):\n\n${syntaxIssues.join('\n\n')}`);
      }
      try {
        fs.rmSync(path.join(projectRoot(), 'test-result', 'test-results.json'), { force: true });
      } catch {}
      const { pid } = startPlaywrightTest(files, projectRoot(), { headed, workers, grep });
      return textResult(
        JSON.stringify(
          { status: 'running', pid, reran: files.length, grep: grep || undefined, note: '只重跑上次失败的 spec,用 tester_status/tester_failures 轮询' },
          null,
          2
        )
      );
    }
  );

  server.tool(
    'tester_generate_spec',
    '根据 test-cases/ 下的用例文件生成一个 Playwright spec 骨架(含 apiRecorder/断言模板),写到 tests/<feature>/。AI 再用官方 browser_snapshot 看页面结构补选择器,然后 run_tests',
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
        : `  // await page.goto('/');  // 用 browser_snapshot 看结构后填路径`;
      const skeleton = `import { test, expect } from '@playwright/test';
import { apiRecorder, expectApi, waitForVisible, waitForClickable, waitForText, waitForURL, selfHeal, mockRoute, tamperResponse } from '@create-tester/core';

// 用例来源: ${caseRef}
${guide}
// 填写规则:
// 1. 每个用例必须有"业务结果断言",禁止只点不验。
// 2. 断言依据 = 用例文档的"预期"列,不是页面现状;页面与预期不符时报告,不要改断言迁就页面。
// 3. 需要登录时:import { ensureLoggedIn } from '../../_login'; 用例开头 await ensureLoggedIn(page);
// 4. 禁止 page.waitForTimeout(硬编码延时):要等就用 waitForVisible/waitForClickable/waitForText/waitForURL,等状态不等时间。
// 5. 标签分组:按需加 tag 供选择性执行,如 test('标题', { tag: ['@smoke'] }, ...);跑时 tester_run_tests {grep: '@smoke'} 只跑冒烟。

test('${firstMeaningfulLine(text) || base}', async ({ page }) => {
  const api = apiRecorder(page);
${goto}

  // ── 操作:用 browser_snapshot 看结构后补定位器(优先级:data-testid → getByRole → css/class → getByText 唯一兜底) ──
  // 例: await page.getByTestId('username').fill('test01');
  //     await page.getByTestId('login-submit').click();
  //     await page.getByRole('button', { name: '保存' }).click();

  // ── 等待(禁止 waitForTimeout,等状态不等时间) ──
  // 元素就绪前 Playwright 会自动等,一般不用写等待。确实要等时用智能等待:
  // 例: await waitForVisible(page.getByTestId('save-btn'));
  //     await waitForClickable(page.getByTestId('submit'));
  //     await waitForText(page, '操作成功');
  //     await waitForURL(page, /\/home/);

  // ── 业务断言(至少满足一条,严禁只点不验) ──
  // 接口层(推荐,最硬):操作触发的接口断言业务码/字段/状态码
  // 例: await expectApi(api, '/api/login').code('0');
  //     await expectApi(api, '/api/login').field('data.token').notEmpty();
  //     await expectApi(api, '/api/login').status(200);
  // 字段断言扩展:正则/数组包含/区间
  //     await expectApi(api, '/api/order').field('data.orderNo').matches(/^SO\d+$/);
  //     await expectApi(api, '/api/order').field('data.items').containsValue('SKU-001');
  //     await expectApi(api, '/api/order').field('data.total').between(100, 999);
  // 页面层:结果必须可观察(跳转/文案/元素状态/值)
  // 例: await expect(page).toHaveURL(/\/home/);
  //     await expect(page.getByText('保存成功')).toBeVisible();
  //     await expect(page.getByTestId('switch')).toHaveClass(/on/);

  // ── 环境数据(改数据类用例) ──
  // 造数据 + 用后清理;判断新增/删除用计数对比(namesBefore/namesAfter),不要靠名字唯一。

  // ── 自愈(首选选择器不稳时用) ──
  // const saveBtn = await selfHeal(page, ['save-btn', '保存', 'button:has-text("保存")']);
  // await saveBtn.click();   // 按候选顺序自动探测,第一个命中即用

  // ── 接口 mock/篡改(造数据、模拟异常响应;真回归不用,保持诚实) ──
  // await mockRoute(page, '**/api/login', { body: { code: '0', data: { token: 'mock' } } });
  // await tamperResponse(page, '**/api/order', async (route) => route.fulfill({ status: 500 }));

  // ── 数据驱动(多组参数循环,写在文件顶层,不在单个 test 内) ──
  // 把测试数据放同目录 data.csv(第一行表头,如 用户名,密码,期望),然后在 spec 顶层循环:
  // import { readDataRows } from '@create-tester/core';
  // const data = readDataRows(__dirname + '/data.csv');
  // for (const row of data.rows) {
  //   test(\`登录 \${row['用户名']}\`, async ({ page }) => { ... 用 row['密码'] ... });
  // }
});
`;
      fs.writeFileSync(targetFile, skeleton, 'utf8');
      return textResult(`已生成:${targetFile}\n用 browser_snapshot 看页面结构补选择器、补业务断言,然后 run_tests 或 retry_failed`);
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
