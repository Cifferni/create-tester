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
import { runPlaywrightTestPassthrough } from '../src/playwright';

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
  .description('运行测试(透传 playwright test),不带参数跑 tests/ 下所有用例')
  .argument('[files...]', 'spec 文件,默认 tests/ 下全部')
  .option('--headed', '带界面执行')
  .action(async (files: string[] | undefined, opts: { headed?: boolean }) => {
    const list = files && files.length ? files : defaultSpecFiles();
    const code = await runPlaywrightTestPassthrough(list, process.cwd());
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
    // 连接配置由 src/mcp 启动时打印到 stderr(node mcp/server.cjs 与 tester mcp 一致)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../src/mcp');
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
