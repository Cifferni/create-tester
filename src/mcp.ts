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
import { spawn } from 'child_process';
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
  const server = new McpServer({ name: 'tester', version: '0.5.6' });

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
    '打开被测页面,返回当前页面的可交互结构快照(按钮/输入框/链接等),用于定位元素。默认 4000 字符省 token;大页面可传 scope 只快照某个区域,或 maxChars 调大',
    {
      url: z.string().optional().describe('要打开的页面地址,缺省用 BASE_URL / playwright.config.ts 的 baseURL'),
      scope: z.string().optional().describe('CSS 选择器:只快照这个容器(如 .card-list),更精准更省 token'),
      maxChars: z.number().optional().describe('返回字符上限,缺省 4000;想多看整个页面传大些(如 12000)')
    },
    async ({ url, scope, maxChars }) => {
      const { baseURL, browser } = playwrightConfig(url);
      // 复用 server 内的共享浏览器,只开关页面
      const pw = await launchBrowser(browser as BrowserName, { headless: true });
      const page = await pw.newPage();
      // 捕获页面错误/崩溃,便于区分"app 崩了"还是"浏览器崩了"
      const events: string[] = [];
      page.on('pageerror', (err) => events.push(`pageerror: ${err.message}`));
      page.on('crash', () => events.push('page crashed (渲染进程崩溃)'));
      page.on('console', (msg) => {
        if (msg.type() === 'error') events.push(`console.error: ${msg.text().slice(0, 300)}`);
      });
      try {
        await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
        const snapshot = await getPageSnapshot(page, { scope, maxChars });
        const extra = events.length ? `\n\n--- 页面事件 ---\n${events.join('\n')}` : '';
        return textResult(`页面地址:${baseURL}\n\n${snapshot}${extra}`);
      } finally {
        await page.close();
      }
    }
  );

  server.tool(
    'inspect',
    '只读探查页面 DOM:按 CSS 选择器返回匹配元素的 outerHTML/属性/文本,用于搞清楚某个按钮/图标到底是什么。不改动任何数据',
    {
      url: z.string().optional().describe('要打开的页面地址,缺省 BASE_URL'),
      selector: z.string().describe('CSS 选择器,如 .provider-card .compact-actions button')
    },
    async ({ url, selector }) => {
      const { baseURL, browser } = playwrightConfig(url);
      const pw = await launchBrowser(browser as BrowserName, { headless: true });
      const page = await pw.newPage();
      try {
        await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector(selector, { timeout: 10000 }).catch(() => undefined);
        const info = await page.evaluate(
          (sel: string) => {
            const els = (Array.from(document.querySelectorAll(sel)) as unknown[]).slice(0, 20);
            return els.map((el) => {
              const e = el as { tagName?: string; textContent?: string | null; outerHTML?: string; attributes?: { name: string; value: string }[] };
              const attrs: Record<string, string> = {};
              for (const a of Array.from(e.attributes || [])) attrs[a.name] = a.value;
              return {
                tag: (e.tagName || '').toLowerCase(),
                attrs,
                text: (e.textContent || '').trim().slice(0, 200),
                outerHTML: (e.outerHTML || '').slice(0, 1500)
              };
            });
          },
          selector
        );
        if (!info.length) return textResult(`没有匹配 ${selector} 的元素(页面:${baseURL})`);
        return textResult(
          info
            .map((i, idx) => `#${idx} <${i.tag}>\nattrs: ${JSON.stringify(i.attrs)}\ntext: ${i.text}\nhtml: ${i.outerHTML}`)
            .join('\n\n')
            .slice(0, 8000)
        );
      } finally {
        await page.close();
      }
    }
  );

  server.tool(
    'set_base_url',
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
      return textResult(`已把被测地址设为 ${url}(playwright.config.ts 的 baseURL)\n若设置了环境变量 BASE_URL 则优先于它;下次 snapshot/run_tests 生效`);
    }
  );

  server.tool(
    'env_reset',
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
    'login',
    '后台打开带界面浏览器做人工登录(验证码/短信场景):返回后请在浏览器里完成登录并关掉,再用 login_status 确认。无验证码时 auth.setup 会自动登录,一般不需要这个',
    {},
    () => {
      const root = projectRoot();
      const authFile = path.join(root, 'test-result', 'auth.json');
      if (fs.existsSync(authFile)) return textResult(`已有登录态:${authFile},无需重新登录`);
      const { baseURL } = playwrightConfig();
      fs.mkdirSync(path.join(root, 'test-result'), { recursive: true });
      // detached + windowsHide:不阻塞 MCP 请求、不弹终端窗口;浏览器窗口会正常打开
      const child = spawn(
        'npx',
        ['playwright', 'codegen', baseURL, '--save-storage=test-result/auth.json'],
        { cwd: root, detached: true, stdio: 'ignore', windowsHide: true, shell: true }
      );
      child.unref();
      return textResult(`已在后台打开浏览器:${baseURL}\n请测试人员在浏览器里完成登录(输验证码/短信),然后关掉浏览器。\n之后用 login_status 确认登录态已保存。`);
    }
  );

  server.tool(
    'login_status',
    '检查人工登录是否完成(test-result/auth.json 是否已生成)',
    {},
    () => {
      const f = path.join(projectRoot(), 'test-result', 'auth.json');
      if (!fs.existsSync(f)) {
        return textResult('未完成:test-result/auth.json 还没生成(等测试人员在浏览器里完成登录并关掉浏览器)');
      }
      const mtime = fs.statSync(f).mtime.toISOString();
      return textResult(`已完成:test-result/auth.json(保存于 ${mtime}),登录态可复用,直接重跑测试`);
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
    '后台运行 Playwright 测试(默认 tests/ 全部),立即返回"运行中",跑完用 status/failures 轮询结果。注意:不提供同步等待——客户端 MCP 有请求超时,同步等待大测试必断。文件参数传相对路径,如 tests/login/登录.spec.ts',
    {
      files: z.array(z.string()).optional().describe('要跑的 spec 文件列表,缺省跑全部'),
      headed: z.boolean().optional().describe('是否带界面执行,默认无头'),
      workers: z.number().optional().describe('并行 worker 数,缺省用 config;提速用(需用例彼此隔离,否则会互踩)')
    },
    ({ files, headed, workers }) => {
      const list = files && files.length ? files : defaultSpecFiles();
      if (!list.length) return textResult(JSON.stringify({ error: '没有可运行的测试文件' }, null, 2));
      const root = projectRoot();
      // 清掉旧报告:让 status/failures 的"未找到报告"能区分"还在跑"
      try {
        fs.rmSync(path.join(root, 'test-result', 'test-results.json'), { force: true });
      } catch {
        // 忽略
      }
      const { pid } = startPlaywrightTest(list, root, { headed, workers });
      return textResult(
        JSON.stringify(
          { status: 'running', pid, note: '测试在后台运行,用 status/failures 轮询结果(未找到报告=仍在跑)' },
          null,
          2
        )
      );
    }
  );

  server.tool(
    'failures',
    '读取 test-result/test-results.json 报告,返回整轮全貌 {total,passed,skipped,failed} + 失败用例详情(含错误信息与 stdout/stderr 日志)。报告未生成说明仍在跑,应稍后轮询',
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
        for (const f of s.failures) {
          out.push(`\n【${f.title}】`);
          if (f.error && f.error !== '(无错误信息)') out.push(f.error);
          if (f.stdout) out.push(`stdout:\n${f.stdout}`);
          if (f.stderr) out.push(`stderr:\n${f.stderr}`);
        }
      }
      return textResult(out.join('\n'));
    }
  );

  server.tool(
    'status',
    '读取 test-result/test-results.json 报告,返回通过/失败/跳过/耗时总览(供 AI 一眼看清整轮结果)',
    { file: z.string().optional().describe('JSON 报告路径,默认 test-result/test-results.json') },
    ({ file }) => {
      const report = cwdResolve(file || 'test-result/test-results.json');
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
    '后台重跑上一次报告中的失败用例(只重跑失败的 spec,不做全量),立即返回"运行中",用 status/failures 轮询。不做同步等待(客户端 MCP 有请求超时)',
    {
      headed: z.boolean().optional().describe('是否带界面执行,默认无头'),
      workers: z.number().optional().describe('并行 worker 数,缺省用 config;提速用(需用例隔离)')
    },
    ({ headed, workers }) => {
      const report = path.join(projectRoot(), 'test-result', 'test-results.json');
      if (!fs.existsSync(report)) return textResult('未找到上次报告:test-result/test-results.json(先跑一次 run_tests)');
      const files = failedSpecFiles(fs.readFileSync(report, 'utf8'));
      if (!files.length) return textResult('上次报告中没有失败用例,无需重跑');
      try {
        fs.rmSync(path.join(projectRoot(), 'test-result', 'test-results.json'), { force: true });
      } catch {}
      const { pid } = startPlaywrightTest(files, projectRoot(), { headed, workers });
      return textResult(
        JSON.stringify(
          { status: 'running', pid, reran: files.length, note: '只重跑上次失败的 spec,用 status/failures 轮询' },
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
// 填写规则:每个用例必须有"业务结果断言"(验结果,不是走过场),禁止只点不验。
// 需要登录时:import { ensureLoggedIn } from '../../_login'; 用例开头 await ensureLoggedIn(page);

test('${firstMeaningfulLine(text) || base}', async ({ page }) => {
  const api = apiRecorder(page);
${goto}

  // ── 操作:用 snapshot 看结构后补定位器(优先 data-testid → getByRole → class) ──
  // 例: await page.getByTestId('username').fill('test01');
  //     await page.getByTestId('login-submit').click();
  //     await page.getByRole('button', { name: '保存' }).click();

  // ── 业务断言(至少满足一条,严禁只点不验) ──
  // 接口层(推荐,最硬):操作触发的接口断言业务码/字段/状态码
  // 例: await expectApi(api, '/api/login').code('0');
  //     await expectApi(api, '/api/login').field('data.token').notEmpty();
  //     await expectApi(api, '/api/login').status(200);
  // 页面层:结果必须可观察(跳转/文案/元素状态/值)
  // 例: await expect(page).toHaveURL(/\/home/);
  //     await expect(page.getByText('保存成功')).toBeVisible();
  //     await expect(page.getByTestId('switch')).toHaveClass(/on/);

  // ── 环境数据(改数据类用例) ──
  // 造数据 + 用后清理;判断新增/删除用计数对比(namesBefore/namesAfter),不要靠名字唯一。
});
`;
      fs.writeFileSync(targetFile, skeleton, 'utf8');
      return textResult(`已生成:${targetFile}\n用 snapshot 看页面结构补选择器、补业务断言,然后 run_tests 或 retry_failed`);
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
