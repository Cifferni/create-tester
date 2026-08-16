// CLI 入口:tester = Playwright 之上的规范 + MCP 工具服务器
//   init        初始化目录规范(playwright.config + test-cases + tests)
//   run         透传 playwright test
//   mcp         启动 MCP stdio server,暴露用例解析/页面快照/跑测试等工具给 AI harness
//   install-browsers  安装 Playwright 浏览器(postinstall 用)

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { program } from 'commander';
import pkg from '../package.json';
import { initProject } from '../src/init';
import { runPlaywrightTestPassthrough } from '@create-tester/core';
import { startWebView } from '@create-tester/core';

program
  .name('tester')
  .description('Playwright 之上的规范 + MCP 工具服务器:测试人员说人话,AI harness 写用例、跑测试、判失败')
  .version(pkg.version);

program
  .command('init')
  .description('初始化目录规范(playwright.config.ts / test-cases / tests)')
  .action(() => {
    initProject();
  });

program
  .command('run')
  .description('运行测试(透传 playwright test),不带参数跑 tests/ 下所有用例。CI 友好:退出码 0=全通过,1=有失败')
  .argument('[files...]', 'spec 文件,默认 tests/ 下全部')
  .option('--headed', '带界面执行(默认无头)')
  .option('--workers <n>', '并行 worker 数(需用例彼此隔离,否则会互踩数据)')
  .option('--grep <pattern>', '只跑匹配的用例(标签或标题关键字,如 @smoke)')
  .option('--env <name>', '环境名(test/uat/prod 等,对应 tester.config.ts 的 envs 表;不指定时用 defaultEnv 的地址,等价于 TESTER_ENV=<name>)')
  .action(async (files: string[] | undefined, opts: { headed?: boolean; workers?: string; grep?: string; env?: string }) => {
    const list = files && files.length ? files : defaultSpecFiles();
    if (!list.length) {
      console.error('[tester] tests/ 下没有 spec,先让 AI 生成或用 tester init');
      process.exit(1);
    }
    if (opts.env) {
      process.env.TESTER_ENV = opts.env;
    }
    const extraArgs: string[] = [];
    if (opts.workers) extraArgs.push(`--workers=${opts.workers}`);
    if (opts.grep) extraArgs.push(`--grep=${opts.grep}`);
    if (opts.headed) extraArgs.push('--headed');
    const code = await runPlaywrightTestPassthrough(list, process.cwd(), extraArgs);
    process.exit(code);
  });

program
  .command('mcp')
  .description('启动 MCP stdio server;自动取当前目录为工程根,并打印可粘贴到 AI harness 的连接配置')
  .argument('[dir]', '测试工程根目录(缺省自动取当前目录)')
  .action((dir?: string) => {
    const root = path.resolve(dir || process.cwd());
    // 工具按 projectRoot 读 test-cases/、tests/、test-result/,不依赖 harness 的 cwd
    process.env.TESTER_PROJECT_ROOT = root;
    // 连接配置由 core mcp 启动时打印到 stderr(node mcp/server.cjs 与 tester mcp 一致)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@create-tester/core/dist/mcp/server.cjs');
  });

program
  .command('install-browsers')
  .description('安装 Playwright 浏览器(项目 postinstall 自动调用)')
  .argument('[names...]', '浏览器名,默认 chromium')
  .action(async (names?: string[]) => {
    const list = names && names.length ? names : ['chromium'];
    await runPlaywrightInstall(list);
  });

program
  .command('view')
  .description('启动只读 Web 查看面板(展示 test-result 测试结果,浏览器打开后自动刷新)')
  .option('-p, --port <number>', '监听端口,默认 8321')
  .action(async (opts: { port?: string }) => {
    const root = process.cwd();
    try {
      const { url } = await startWebView({ projectRoot: root, port: Number(opts.port) || 8321 });
      console.log(`[tester] 测试结果面板已启动:${url}(只读;Ctrl+C 停止)`);
    } catch (e) {
      console.error(`[tester] 面板启动失败:${(e as Error).message}(端口被占用可换 -p)`);
      process.exit(1);
    }
  });

program
  .command('diag')
  .description('诊断测试工程环境:依赖/配置/目录/MCP 握手,一键定位问题')
  .action(async () => {
    const root = process.cwd();
    let allOk = true;
    const mark = (ok: boolean, label: string, detail = ''): void => {
      if (!ok) allOk = false;
      console.log(`${ok ? '✓' : '✗'} ${label}${detail ? '  ' + detail : ''}`);
    };
    // 依赖
    for (const dep of ['@playwright/test', 'playwright', '@modelcontextprotocol/sdk', 'zod', 'jiti', 'xlsx']) {
      try {
        require.resolve(`${dep}/package.json`, { paths: [root] });
        mark(true, `依赖 ${dep}`);
      } catch {
        mark(false, `依赖 ${dep}`, '(未安装,在工程根目录 npm install)');
      }
    }
    // 配置文件与目录
    const cfg = path.join(root, 'playwright.config.ts');
    mark(fs.existsSync(cfg), 'playwright.config.ts', fs.existsSync(cfg) ? '' : '(缺失,可 tester init 或重建工程)');
    for (const d of ['test-cases', 'tests', 'mcp']) {
      const p = path.join(root, d);
      mark(fs.existsSync(p), `目录 ${d}/`, fs.existsSync(p) ? '' : '(缺失)');
    }
    // MCP 握手
    mark(await checkMcpHandshake(root), 'MCP server 握手', '');
    console.log(allOk ? '\n环境正常,可以开测。' : '\n有环境问题,按 ✗ 项修复。');
    process.exit(allOk ? 0 : 1);
  });

function defaultSpecFiles(): string[] {
  const dir = path.join(process.cwd(), 'tests');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true })
    .filter((f) => /\.spec\.(ts|js|mjs|tsx|jsx)$/.test(String(f)))
    .map((f) => path.join(dir, String(f)));
}

async function runPlaywrightInstall(names: string[]): Promise<void> {
  const child = spawn('npx', ['playwright', 'install', ...names], { stdio: 'inherit', shell: true, windowsHide: true });
  await new Promise((resolve) => child.on('close', resolve));
}

// 启动 mcp/server.cjs 发 initialize,确认能握手
function checkMcpHandshake(root: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = path.join(root, 'mcp', 'server.cjs');
    if (!fs.existsSync(server)) {
      resolve(false);
      return;
    }
    const child = spawn(process.execPath, [server], { cwd: root, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    let done = false;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), 10000);
    child.stdout.on('data', (d) => {
      if (String(d).includes('serverInfo')) finish(true);
    });
    child.on('error', () => finish(false));
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'diag', version: '1' } }
      }) + '\n'
    );
  });
}

program.parseAsync(process.argv).catch((e: Error) => {
  console.error(e);
  process.exit(1);
});
