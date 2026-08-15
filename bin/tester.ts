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

program.parseAsync(process.argv).catch((e: Error) => {
  console.error(e);
  process.exit(1);
});
