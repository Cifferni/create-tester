// create-tester:交互式创建 tester 测试项目(脚手架,本包同时提供 tester 引擎 CLI)
// 用法: npm create tester / npx create-tester / create-tester

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { program } from 'commander';
import prompts from 'prompts';

const PLAYWRIGHT_TEST_VERSION = '^1.49.1';

const BROWSER_CHOICES = [
  { title: 'Chromium — Playwright 内置,自动下载(推荐)', value: 'chromium' },
  { title: 'Chrome — 用系统已装的 Chrome,免下载', value: 'chrome' },
  { title: 'Firefox — Playwright 内置,自动下载', value: 'firefox' },
  { title: 'WebKit — Playwright 内置,自动下载', value: 'webkit' }
];

interface Options {
  name?: string;
  browser?: string;
  extraBrowsers?: string[];
  install?: boolean;
  force?: boolean;
}

async function main(opts: Options): Promise<void> {
  const isTTY = Boolean(process.stdin.isTTY);
  let name = opts.name;
  let browser = opts.browser;
  let extras: string[] = opts.extraBrowsers || [];

  if (isTTY) {
    const res = await prompts([
      { type: 'text', name: 'name', message: '项目名称', initial: name || 'my-test' },
      { type: 'select', name: 'browser', message: '主浏览器', initial: 0, choices: BROWSER_CHOICES },
      {
        type: 'multiselect',
        name: 'extras',
        message: '额外安装的浏览器(可多选,用于跨浏览器回归)',
        min: 0,
        choices: BROWSER_CHOICES.filter((c) => c.value !== 'chrome').map((c) => ({ title: c.title, value: c.value }))
      }
    ]);
    if (!res) process.exit(1);
    name = res.name || 'my-test';
    browser = res.browser;
    extras = res.extras || [];
  } else {
    const piped = (await readAllStdin()).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const ask = (def: string): string => {
      const next = piped.shift();
      return next !== undefined ? next : def;
    };
    if (!name) name = ask('my-test');
    if (!browser) {
      const choice = ask('1');
      browser = { '1': 'chromium', '2': 'chrome', '3': 'firefox' }[choice] || 'chromium';
    }
  }

  name = name || 'my-test';
  browser = browser || 'chromium';
  if (!['chromium', 'chrome', 'firefox', 'webkit'].includes(browser)) {
    console.error(`[create-tester] 不支持的浏览器:${browser}(可选 chromium/chrome/firefox/webkit)`);
    process.exit(1);
  }
  extras = extras.filter((x) => x !== browser && ['chromium', 'firefox', 'webkit'].includes(x));

  const target = path.resolve(process.cwd(), name);
  if (fs.existsSync(target) && fs.readdirSync(target).length > 0 && !opts.force) {
    console.error(`[create-tester] 目录已存在且非空:${target}(加 --force 覆盖,或换名字)`);
    process.exit(1);
  }
  fs.mkdirSync(target, { recursive: true });

  const templateDir = path.join(__dirname, '..', 'template');
  copyTemplate(templateDir, target);
  writePackageJson(target, name, browser, extras);
  setBrowser(target, browser);
  writeMcpJson(target);

  console.log(`[create-tester] 已创建测试项目:${target}`);
  console.log(`[create-tester] 主浏览器:${browser}${browser === 'chrome' ? '(系统 Chrome,免下载)' : ''}`);
  if (extras.length) console.log(`[create-tester] 额外浏览器:${extras.join(', ')}`);
  console.log('[create-tester] 引擎代码在 mcp/,依赖与浏览器随 npm install 自动安装');
  console.log('[create-tester] 已生成 .mcp.json:支持项目级 MCP 的 AI(Claude Code/Cursor/opencode)打开工程即自动连接,无需手动启动');

  if (opts.install !== false) {
    console.log('[create-tester] 正在 npm install(首次会下载依赖与浏览器,请稍候)…');
    const child = spawn('npm', ['install'], { cwd: target, stdio: 'inherit', shell: true });
    await new Promise((resolve) => child.on('close', resolve));
    console.log('[create-tester] 安装完成,可以直接用了:');
    console.log('  cd ' + target);
    console.log('  npm run test        # 跑回归(playwright test,不用开 AI)');
    console.log('  # 让 AI 干活:用支持项目级 .mcp.json 的 AI 打开本工程,直接聊天即可');
  } else {
    console.log('  接下来:');
    console.log('  cd ' + target);
    console.log('  npm install');
    console.log('  npm run test        # 跑回归(playwright test,不用开 AI)');
    console.log('  # 让 AI 干活:用支持项目级 .mcp.json 的 AI 打开本工程,直接聊天即可');
  }
}

// 生成工程级 .mcp.json:支持项目级 MCP 的 harness 打开工程自动连接,测试人员无需手动启动
function writeMcpJson(target: string): void {
  const rootUrl = target.replace(/\\/g, '/');
  const mcp = {
    mcpServers: {
      tester: { command: 'node', args: [`${rootUrl}/mcp/server.cjs`], cwd: rootUrl }
    }
  };
  fs.writeFileSync(path.join(target, '.mcp.json'), JSON.stringify(mcp, null, 2) + '\n', 'utf8');
}

function copyTemplate(templateDir: string, target: string): void {
  fs.cpSync(templateDir, target, { recursive: true });
  // npm 打包会排除 .gitignore,发布包里用 _gitignore,创建项目时转回并清理
  const gitignore = path.join(target, '.gitignore');
  if (!fs.existsSync(gitignore)) {
    fs.copyFileSync(path.join(templateDir, '_gitignore'), gitignore);
  }
  const stale = path.join(target, '_gitignore');
  if (fs.existsSync(stale)) fs.unlinkSync(stale);
}

function writePackageJson(target: string, name: string, browser: string, extras: string[]): void {
  const pkgName = sanitizeName(name);
  const browsers = [browser, ...extras].filter((x) => x !== 'chrome');
  const scripts: Record<string, string> = {
    test: 'playwright test',
    'test:headed': 'playwright test --headed',
    login: 'node scripts/login.cjs',
    mcp: 'node mcp/server.cjs'
  };
  if (browsers.length) {
    scripts.postinstall = `npx playwright install ${browsers.join(' ')}`;
  }
  const pkg = {
    name: pkgName,
    version: '0.1.0',
    private: true,
    scripts,
    devDependencies: {
      '@modelcontextprotocol/sdk': '^1.30.0',
      '@playwright/test': PLAYWRIGHT_TEST_VERSION,
      playwright: '^1.49.1',
      jiti: '^2.7.0',
      zod: '^3.25 || ^4.0',
      xlsx: 'https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz'
    }
  };
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

function setBrowser(target: string, browser: string): void {
  const file = path.join(target, 'playwright.config.ts');
  if (fs.existsSync(file)) {
    const text = fs
      .readFileSync(file, 'utf8')
      .replace(/TESTER_BROWSER \|\| 'chromium'/, `TESTER_BROWSER || '${browser}'`);
    fs.writeFileSync(file, text, 'utf8');
  }
}

function sanitizeName(name: string): string {
  const clean = name.toLowerCase().replace(/[^a-z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return clean || 'tester-project';
}

function readAllStdin(): Promise<string> {
  return new Promise((resolve) => {
    let s = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (s += c));
    process.stdin.on('end', () => resolve(s));
  });
}

program
  .name('create-tester')
  .description('创建 tester 测试项目(脚手架)')
  .version('0.5.3')
  .argument('[name]', '项目目录名(不填则交互询问)')
  .option('-b, --browser <name>', '主浏览器:chromium/chrome/firefox/webkit')
  .option('--extra-browsers <names>', '额外浏览器,逗号分隔')
  .option('--no-install', '不自动执行 npm install')
  .option('--force', '目录已存在且非空时强制覆盖')
  .action(async (name: string | undefined, opts: { browser?: string; extraBrowsers?: string; install?: boolean; force?: boolean }) => {
    await main({
      name,
      browser: opts.browser,
      extraBrowsers: opts.extraBrowsers ? opts.extraBrowsers.split(',').map((s) => s.trim()) : [],
      install: opts.install,
      force: opts.force
    });
  });

program.parseAsync(process.argv).catch((e: Error) => {
  console.error(e);
  process.exit(1);
});
