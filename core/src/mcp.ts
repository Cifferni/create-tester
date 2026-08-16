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
import { checkSpecQuality } from './checkSyntax';
import { closeBrowser } from './browser';
import { loadPlugins } from './plugins';
import { playwrightConfig } from './config';
import { effectiveTesterConfig, testerConfig as readTesterConfig } from './config';
import { parseCaseToDsl, dslToCode, dslToAssertions } from './dsl';
import { startPlaywrightTest, runPlaywrightTest, runWithRetry, summarizeJsonReport, failedSpecFiles } from './playwright';
import { locatorCacheStats } from './selectorCache';
import { listVars, resetVars, setVar } from './variables';

// 包版本:通过包名解析到安装位置的 package.json(避开 esbuild 内联相对路径的坑)
function coreVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const resolved = require.resolve('@create-tester/core/package.json');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require(resolved) as { version?: string };
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

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
  const server = new McpServer({ name: 'tester', version: coreVersion() });
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
      // 语法 + 纪律预检:先验 spec 能解析、无违规,避免把跑不起来的脚本交给 Playwright 空跑
      const fatalIssues: string[] = [];
      const warnings: string[] = [];
      for (const f of list) {
        const q = await checkSpecQuality(f);
        fatalIssues.push(...q.fatal);
        warnings.push(...q.warnings);
      }
      if (fatalIssues.length) {
        return textResult(
          `以下 spec 存在问题,已停止运行(请先修复再跑):\n\n${fatalIssues.join('\n\n')}` +
            (warnings.length ? `\n\n(警告,不阻塞运行):\n${warnings.join('\n')}` : '')
        );
      }
      // 跑测前清空上一轮残留变量,避免污染本次(跨用例传参从干净状态开始)
      resetVars();
      // 清掉旧报告:让 tester_status/tester_failures 的"未找到报告"能区分"还在跑"
      try {
        fs.rmSync(path.join(root, 'test-result', 'test-results.json'), { force: true });
      } catch {
        // 忽略
      }
      const { pid } = startPlaywrightTest(list, root, { headed, workers, grep });
      return textResult(
        JSON.stringify(
          { status: 'running', pid, grep: grep || undefined, warning: warnings.length ? warnings : undefined, note: '测试在后台运行,用 tester_status/tester_failures 轮询结果(未找到报告=仍在跑)' },
          null,
          2
        )
      );
    }
  );

  server.tool(
    'tester_run_and_wait',
    '同步跑测试并等结果,一次调用完成"跑+等",定位/网络/超时失败自动重试最多 max_retries 轮(断言失败不自动重试,可能是真 bug)。适合中小测试集;大测试集会超过客户端请求超时,应改用 tester_run_tests(后台)+tester_wait_result',
    {
      files: z.array(z.string()).optional().describe('要跑的 spec 文件列表,缺省跑全部'),
      grep: z.string().optional().describe('只跑匹配的用例(标签或标题关键字)'),
      max_retries: z.number().optional().describe('定位/网络/超时失败最多自动重试几轮,默认 2,上限 4'),
      timeout: z.number().optional().describe('每轮超时秒数,默认 180')
    },
    async ({ files, grep, max_retries, timeout }) => {
      const list = files && files.length ? files : defaultSpecFiles();
      if (!list.length) return textResult(JSON.stringify({ error: '没有可运行的测试文件' }, null, 2));
      const root = projectRoot();
      // 语法 + 纪律预检
      const fatalIssues: string[] = [];
      for (const f of list) {
        const q = await checkSpecQuality(f);
        fatalIssues.push(...q.fatal);
      }
      if (fatalIssues.length) {
        return textResult(`以下 spec 存在问题,已停止运行:\n\n${fatalIssues.join('\n\n')}`);
      }
      resetVars();
      try {
        fs.rmSync(path.join(root, 'test-result', 'test-results.json'), { force: true });
      } catch {}
      const { failures, attempts } = await runWithRetry(list, root, {
        maxRounds: Math.min(Math.max(max_retries ?? 2, 0), 4),
        timeoutMs: (timeout ?? 180) * 1000
      });
      const byCat = new Map<string, number>();
      for (const f of failures) {
        const c = f.category || '其他';
        byCat.set(c, (byCat.get(c) || 0) + 1);
      }
      const out: string[] = [
        `共 ${list.length} 组文件 | 失败 ${failures.length} | 自动重试 ${attempts - 1} 轮`,
        failures.length ? `错误分类:${[...byCat.entries()].map(([c, n]) => `${c} ${n}`).join(' | ')}` : '(全部通过)'
      ];
      for (const f of failures) {
        out.push(`\n【${f.title}】[${f.category || '其他'}]`);
        if (f.error && f.error !== '(无错误信息)') out.push(f.error);
        if (f.stdout) out.push(`stdout:\n${f.stdout}`);
        if (f.stderr) out.push(`stderr:\n${f.stderr}`);
      }
      return textResult(out.join('\n'));
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
    'tester_wait_result',
    '等待上一轮测试出结果:在 server 端轮询 test-result/test-results.json,直到报告生成或超时(默认 30s,最多 55s,受 MCP 客户端请求超时限制)。返回通过/失败/跳过/耗时总览 + 失败详情。**禁止用终端 sleep 等待测试**——等结果就用这个,一次调用即可',
    {
      timeout: z.number().optional().describe('最多等多少秒,默认 30,上限 55(客户端请求超时限制)'),
      file: z.string().optional().describe('JSON 报告路径,默认 test-result/test-results.json')
    },
    async ({ timeout, file }) => {
      const report = cwdResolve(file || 'test-result/test-results.json');
      const maxMs = Math.min(Math.max(timeout ?? 30, 1), 55) * 1000;
      const deadline = Date.now() + maxMs;
      // 内部轮询,不依赖客户端 sleep
      while (Date.now() < deadline) {
        if (fs.existsSync(report)) {
          try {
            const s = summarizeJsonReport(fs.readFileSync(report, 'utf8'));
            if (s) {
              // 报告器插件
              for (const p of plugins.reporters) {
                try {
                  void p.onSummary?.(s);
                } catch {}
              }
              const out: string[] = [
                `通过 ${s.passed} / 失败 ${s.failed} / 跳过 ${s.skipped} / 共 ${s.total} / 耗时 ${s.durationMs}ms`
              ];
              if (s.failures.length) {
                out.push(`失败详情:`);
                for (const f of s.failures) {
                  out.push(`\n【${f.title}】[${f.category || '其他'}]`);
                  if (f.error && f.error !== '(无错误信息)') out.push(f.error);
                  if (f.stdout) out.push(`stdout:\n${f.stdout}`);
                  if (f.stderr) out.push(`stderr:\n${f.stderr}`);
                }
              } else {
                out.push('(全部通过)');
              }
              return textResult(out.join('\n'));
            }
          } catch {
            // 报告刚写入可能不完整,继续等
          }
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      return textResult(`等待超时(${maxMs / 1000}s):报告仍未生成,测试可能仍在跑。可再调一次 tester_wait_result 或 tester_status。`);
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
      const fatalIssues: string[] = [];
      for (const f of files) {
        const q = await checkSpecQuality(f);
        fatalIssues.push(...q.fatal);
      }
      if (fatalIssues.length) {
        return textResult(`以下失败 spec 存在语法/纪律问题,已停止重跑(请先修复再跑):\n\n${fatalIssues.join('\n\n')}`);
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
    'tester_vars',
    '查看当前测试变量(跨用例传参,test-result/.vars.json + 局部内存):setVar/getVar 支撑"用例A创建订单提取 orderId → 用例B用 orderId 查询/编辑"的长链路。跑测前会清空上一轮残留变量',
    {},
    () => {
      const vars = listVars();
      const entries = Object.entries(vars);
      return textResult(
        entries.length ? `当前变量(${entries.length}):\n${entries.map(([k, v]) => `  ${k} = ${v}`).join('\n')}` : '(无变量)'
      );
    }
  );

  server.tool(
    'tester_config',
    '查看当前生效的 tester 配置(playwright.config.ts 导出的 testerConfig + 环境变量覆盖后的最终值):开关(选择器缓存/变量落盘)/多环境地址表/重试策略/VLM 视觉降级。排查"为什么缓存没生效"等配置类问题时先看这里',
    {},
    () => {
      const t = readTesterConfig();
      const eff = effectiveTesterConfig();
      const { baseURL } = playwrightConfig();
      const envs = Object.entries(t.envs || {});
      const retry = t.retry || {};
      return textResult(
        [
          '当前 tester 配置(环境变量 > playwright.config.ts testerConfig > 默认):',
          `  被测地址:${baseURL}(BASE_URL / ENVS / use.baseURL)`,
          `  开关-选择器缓存:${eff.switchesResolved.locatorCache ? '开' : '关'}(TESTER_LOCATOR_CACHE 可覆盖)`,
          `  开关-变量落盘:${eff.switchesResolved.vars ? '开' : '关'}(TESTER_VARS 可覆盖)`,
          `  重试:${retry.maxRounds ?? 2} 轮,分类:${(retry.retryable || ['定位', '网络', '超时']).join('/')}`,
          `  VLM 视觉降级:${eff.vlmResolved ? '开' : '关'}(配 plugin/ 的 locatorVlm 插件后可开)`,
          envs.length ? `  多环境:${envs.map(([k, v]) => `${k}=${v}`).join(', ')}` : '  多环境:(未配置)'
        ].join('\n')
      );
    }
  );

  server.tool(
    'tester_api_request',
    '纯接口请求(不经过页面,造数据/取数用):直接发 HTTP 请求,返回状态码与响应体;可用 extract 把响应字段写入变量(setVar),供后续 UI 用例断言页面展示。实现"接口造数据 + UI 断言"混合测试',
    {
      method: z.string().describe('HTTP 方法:GET/POST/PUT/DELETE 等'),
      url: z.string().describe('完整请求地址,如 http://localhost:3000/api/order/create'),
      headers: z.record(z.string(), z.string()).optional().describe('请求头(可选,如 { Authorization: "xxx" })'),
      body: z.string().optional().describe('请求体(JSON 字符串或原始文本)'),
      extract: z.array(z.object({
        name: z.string().describe('写入变量名,如 orderId'),
        path: z.string().describe('响应字段 dotPath,如 data.orderId')
      })).optional().describe('把响应字段提取成变量(供 UI 用例用 setVar/getVar)')
    },
    async ({ method, url, headers, body, extract }) => {
      try {
        const res = await fetch(url, {
          method,
          headers: headers ? { 'content-type': 'application/json', ...headers } : { 'content-type': 'application/json' },
          body: method !== 'GET' && method !== 'HEAD' && body !== undefined ? body : undefined
        });
        const raw = await res.text();
        const out: string[] = [`${method} ${url} → HTTP ${res.status}`];
        // 提取字段写入变量
        const saved: string[] = [];
        if (extract?.length) {
          let json: unknown = null;
          try {
            json = JSON.parse(raw);
          } catch {
            // 非 JSON 响应则跳过提取
          }
          if (json) {
            const get = (dot: string): unknown =>
              dot.split('.').reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), json);
            for (const e of extract) {
              const v = get(e.path);
              if (v !== undefined && v !== null) {
                setVar(e.name, String(v));
                saved.push(`${e.name}=${String(v)}`);
              }
            }
          }
        }
        out.push(saved.length ? `已提取变量:${saved.join(' | ')}` : '');
        out.push(`响应体(截断 2000 字):\n${raw.slice(0, 2000)}`);
        return textResult(out.filter(Boolean).join('\n'));
      } catch (e) {
        return textResult(`接口请求失败:${(e as Error).message}`);
      }
    }
  );

  server.tool(
    'tester_cache_stats',
    '查看选择器持久缓存(test-result/locator-cache.json)的命中率统计:缓存条目数/累计命中/累计失效/命中率。selfHeal 定位命中后会写入缓存,重复运行同用例应看到命中率上升、Token 定位开销下降;命中率低说明页面结构经常变,或选择器质量差',
    {},
    () => {
      const s = locatorCacheStats();
      return textResult(
        s.disabled
          ? '选择器缓存已关闭(设置了 TESTER_LOCATOR_CACHE=0)'
          : [
              `选择器缓存统计:`,
              `  缓存条目:${s.total}`,
              `  累计命中:${s.hits}`,
              `  累计失效:${s.misses}`,
              `  命中率:${(s.hitRate * 100).toFixed(1)}%`,
              `  VLM 视觉降级:${s.vlmUses} 次`
            ].join('\n')
      );
    }
  );

  server.tool(
    'tester_generate_spec',
    '根据 test-cases/ 下的用例文件生成 Playwright spec:先用 DSL 解析(操作→可执行步骤,预期→断言),生成带操作/断言的完整代码(选择器用 selfHeal 多候选占位),AI 只需核对/微调选择器,不用从空白骨架补。写到 tests/<feature>/',
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
      // DSL:结构化用例 → 操作代码 + 断言代码(代码层生成,AI 只微调选择器)
      const dsl = parseCaseToDsl(text, base);
      const ops = dslToCode(dsl).split('\n');
      const asserts = dslToAssertions(dsl).split('\n');
      const opBody = ops.length ? ops.join('\n') : `  // ⚠ 未识别到"操作"步骤,请用 browser_snapshot 看结构后补操作`;
      const assertBody = asserts.join('\n');
      const skeleton = `import { test, expect } from '@playwright/test';
import { apiRecorder, expectApi, waitForVisible, waitForClickable, waitForText, waitForURL, selfHeal, mockRoute, tamperResponse, extractField, setVar, getVar, installPageGuard, waitMaskGone } from '@create-tester/core';

// 用例来源: ${caseRef}
${guide}
// 说明:以下操作/断言由用例自动生成(DSL),选择器是 selfHeal 占位——用 browser_snapshot 看结构后核对/微调每个 selfHeal 的候选即可。
// 1. 每个用例必须有业务断言,禁止只点不验。
// 2. 断言依据 = 用例文档"预期",不是页面现状;不符就报告,不改断言迁就。
// 3. 需要登录:import { ensureLoggedIn } from '../../_login'; 用例开头 await ensureLoggedIn(page);

test('${firstMeaningfulLine(text) || base}', async ({ page }) => {
  const api = apiRecorder(page);
  installPageGuard(page); // 弹窗自动 accept,防弹窗卡死/误断用例
${goto}

  // ── 操作(DSL 自动生成,核对 selfHeal 候选) ──
${opBody}

  // ── 业务断言(DSL 自动生成,核对期望) ──
${assertBody}
});
`;
      fs.writeFileSync(targetFile, skeleton, 'utf8');
      return textResult(`已生成:${targetFile}\n操作/断言已由用例自动生成(DSL),用 browser_snapshot 看页面结构核对 selfHeal 选择器,然后 tester_run_tests`);
    }
  );

  server.tool(
    'tester_export_doc',
    '导出标准测试文档:把 tests/ 下的 spec(用例标题 + 操作/断言步骤)+ 最近一次执行结果(test-result/test-results.json 的通过/失败/跳过)汇总成 Markdown,写到 test-result/exported-cases.md。供缺陷单、测试报告归档用',
    {
      out: z.string().optional().describe('输出文件路径,缺省 test-result/exported-cases.md')
    },
    ({ out }) => {
      const root = projectRoot();
      const specFiles = defaultSpecFiles();
      if (!specFiles.length) return textResult('tests/ 下没有 spec,无法导出');
      // 读最近执行结果(可能没有)
      const reportFile = path.join(root, 'test-result', 'test-results.json');
      let report: { suites?: unknown[] } | null = null;
      try {
        report = fs.existsSync(reportFile) ? (JSON.parse(fs.readFileSync(reportFile, 'utf8')) as { suites?: unknown[] }) : null;
      } catch {
        report = null;
      }
      const statusOf = new Map<string, string>();
      const walk = (suites: unknown[]): void => {
        for (const s of suites as Array<{ title?: string; suites?: unknown[]; specs?: unknown[] }>) {
          if (s.suites?.length) walk(s.suites);
          for (const spec of s.specs || []) {
            const sp = spec as { title?: string; tests?: Array<{ title?: string; results?: Array<{ status?: string }> }> };
            for (const t of sp.tests || []) {
              const st = t.results?.[t.results.length - 1]?.status;
              statusOf.set(sp.title || t.title || '', st || 'unknown');
            }
          }
        }
      };
      if (report?.suites?.length) walk(report.suites);
      // 按 spec 文件分组渲染
      const md: string[] = ['# 测试用例文档', '', `> 导出时间:${new Date().toISOString()}`, `> 来源:${specFiles.length} 个 spec 文件`, ''];
      const STATUS_EMOJI: Record<string, string> = { passed: '✅', failed: '❌', skipped: '⏭', timedOut: '⏱', unknown: '?' };
      for (const file of specFiles) {
        let src = '';
        try {
          src = fs.readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        const rel = path.relative(root, file).replace(/\\/g, '/');
        md.push(`## ${rel}`, '');
        // 提取 test('标题', ...) 块
        const re = /test\s*\(\s*['"`]([^'"`]+)['"`]/g;
        let m: RegExpExecArray | null;
        const titles: string[] = [];
        while ((m = re.exec(src))) titles.push(m[1]);
        if (!titles.length) {
          md.push('_(未识别到用例,请人工补录)_', '');
          continue;
        }
        for (const t of titles) {
          const st = statusOf.get(t) || 'unknown';
          md.push(`- ${STATUS_EMOJI[st] ?? '?'} **${t}**(状态:${st === 'unknown' ? '未执行' : st})`);
        }
        // 抽样展示 spec 中的断言/操作行(去注释,取前若干)
        const lines = src
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('//') && !l.startsWith('import') && !l.startsWith('export'))
          .slice(0, 20);
        if (lines.length) {
          md.push('', '```ts', ...lines.slice(0, 12), '```');
        }
        md.push('');
      }
      const outFile = cwdResolve(out || 'test-result/exported-cases.md');
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, md.join('\n'), 'utf8');
      return textResult(`已导出:${outFile}\n共 ${specFiles.length} 个 spec,可用表格/缺陷单归档`);
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
