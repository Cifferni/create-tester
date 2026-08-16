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

  if (opts.install !== false) {
    console.log('[create-tester] 正在 npm install(首次会下载依赖与浏览器,请稍候)…');
    const child = spawn('npm', ['install'], { cwd: target, stdio: 'inherit', shell: true, windowsHide: true });
    await new Promise((resolve) => child.on('close', resolve));
  }
  printProjectInfo(target, name, browser, extras, opts.install !== false);
}

// 项目信息总览:创建/安装完成后打印给测试人员看
function printProjectInfo(target: string, name: string, browser: string, extras: string[], installed: boolean): void {
  const bar = '='.repeat(56);
  const thin = '-'.repeat(56);
  const rootUrl = target.replace(/\\/g, '/');
  const lines: string[] = [
    '',
    bar,
    `  ${name} 测试项目已${installed ? '创建完成' : '创建(待 npm install)'}`,
    bar,
    `  项目路径   ${target}`,
    `  主浏览器   ${browser}${extras.length ? `(+ ${extras.join(', ')})` : ''}`,
    `  用例目录   test-cases/   放你已有的用例(Excel/XMind/Markdown/CSV/TXT)`,
    `  回归用例   tests/        可执行用例(AI 生成)`,
    `  测试报告   ${rootUrl}/test-result/report/index.html`,
    `  MCP 连接   工程已带 .mcp.json,支持项目级 MCP 的 AI 打开即连`,
    thin,
    '  开始用:',
    `  1. 把用例丢进 test-cases/`,
    `  2. 用 AI 打开本工程,直接说需求,例如:`,
    `     "把 test-cases/登录.xlsx 转成测试用例跑一遍,失败的给我分析根因"`,
    `  3. 回归:cd ${target} && npm run test(不需要开 AI)`,
    `  4. 登录:对话里报账号密码;验证码则首次 npm run login`,
    installed ? '' : '  然后:npm install 安装依赖与浏览器',
    bar,
    ''
  ];
  console.log(lines.filter((l) => l !== '').join('\n'));
}

// 生成工程级 .mcp.json:支持项目级 MCP 的 harness 打开工程自动连接两套 server。
//  playwright:官方 @playwright/mcp,负责浏览器操作(快照/点击/输入/断言)
//  tester:    自研测试工程工具(用例读取/生成/跑测/报告/登录/env)
function writeMcpJson(target: string): void {
  const rootUrl = target.replace(/\\/g, '/');
  const mcp = {
    mcpServers: {
      playwright: {
        command: 'npx',
        args: ['@playwright/mcp@latest', '--headless', '--config', `${rootUrl}/mcp/playwright-mcp.json`]
      },
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
      '@create-tester/core': '^0.7.1',
      '@playwright/mcp': '^0.0.79',
      '@playwright/test': PLAYWRIGHT_TEST_VERSION,
      playwright: '^1.49.1',
      esbuild: '^0.28.2',
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

// 升级已建的测试工程:在工程根目录跑 `npx create-tester@latest upgrade`
// 引擎核心已拆为 @create-tester/core 依赖,升级=更新依赖版本(npm install @create-tester/core@latest),
// 不再覆盖任何文件,也不会触碰用户改过的配置/脚本。
// 新版引入的新模板文件(如 tester.config.ts)会补齐,但绝不覆盖已存在的文件。
program
  .command('upgrade')
  .description('升级当前测试工程到最新引擎(更新 @create-tester/core 依赖,不覆盖你改过的任何文件;缺的新模板文件会补齐)')
  .option('--no-install', '只改 package.json 版本号,不执行 npm install')
  .action((opts: { install?: boolean }) => {
    const noInstall = opts.install === false || process.argv.includes('--no-install');
    const root = process.cwd();
    const pkgFile = path.join(root, 'package.json');
    if (!fs.existsSync(pkgFile)) {
      console.error('[upgrade] 未找到 package.json(请在测试工程根目录运行)');
      process.exit(1);
    }
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8')) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };
    // 找到 @create-tester/core 的声明位置(devDependencies 优先)
    if (pkg.devDependencies?.['@create-tester/core'] === undefined && pkg.dependencies?.['@create-tester/core'] === undefined) {
      console.error('[upgrade] 当前工程未声明 @create-tester/core,无需升级');
      process.exit(0);
    }
    // 补齐新版引入的模板文件(只补缺失的,绝不覆盖已存在的):如 tester.config.ts 等
    const filled = fillMissingTemplateFiles(root);
    const filledText = filled.length
      ? `已补齐新模板文件:\n${filled.map((f) => `  - ${f}`).join('\n')}`
      : '无需补齐模板文件(已有的都在)';
    if (noInstall) {
      pkg.devDependencies!['@create-tester/core'] = 'latest';
      fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
      console.log(`[upgrade] 已把 @create-tester/core 版本号改为 latest,请执行 npm install\n[upgrade] ${filledText.replace(/\n/g, '\n[upgrade] ')}`);
      process.exit(0);
    }
    // 正常路径:直接 npm install 最新版(依赖版本管理,引擎文件不动)
    const child = spawn('npm', ['install', '@create-tester/core@latest', '--save-dev'], {
      cwd: root,
      stdio: 'inherit',
      shell: true,
      windowsHide: true
    });
    child.on('close', (code) => {
      console.log(`[upgrade] 引擎已升级到最新。未覆盖你改过的任何文件(配置/脚本/specs)。\n[upgrade] ${filledText.replace(/\n/g, '\n[upgrade] ')}`);
      process.exit(code ?? 0);
    });
  });

// 补齐新版模板新增的文件(只补缺失的):tester.config.ts / plugin/vlm.example.cjs / ci.example.yml。
// 老工程升级后 core 已更新,但缺少新模板文件时新功能(如 tester.config.ts 配置)拿不到,这里补上。
// 返回本次补齐的文件列表(相对路径)。
function fillMissingTemplateFiles(root: string): string[] {
  const filled: string[] = [];
  const templateDir = path.join(__dirname, '..', 'template');
  if (!fs.existsSync(templateDir)) return filled; // 从 npm 包运行时 template 在包内,路径有效
  const toFill = ['tester.config.ts', path.join('plugin', 'vlm.example.cjs'), 'ci.example.yml'];
  for (const rel of toFill) {
    const src = path.join(templateDir, rel);
    const dst = path.join(root, rel);
    if (!fs.existsSync(src)) continue;
    if (fs.existsSync(dst)) continue; // 已有(用户改过或已补过)不覆盖
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    filled.push(rel);
    console.log(`[upgrade] 已补齐新模板文件:${rel}(新版本引入,你未改过它)`);
  }
  return filled;
}

program
  .name('create-tester')
  .description('创建 tester 测试项目(脚手架)')
  .version('0.5.6')
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
