// 交互式跑测试:node scripts/test.cjs [playwright参数...]
// 运行前先选环境(来自 tester.config.ts 的 envs 表),方向键选择即可,不用记环境变量。
// 等价于:TESTER_ENV=<环境> npx playwright test <参数>
//   高级用法(可选,一般用不到):
//     TESTER_ENV=uat node scripts/test.cjs --grep @smoke  跳过菜单直接跑指定环境
//     BASE_URL=http://x node scripts/test.cjs             显式指定地址(优先级最高)
// 环境选择逻辑与 scripts/login.cjs 完全一致,保证"登录哪个环境就跑哪个环境"。
const { spawn } = require('child_process');
const path = require('path');
const { pickItem, style, spinner } = require('./_menu.cjs');
const { loadProjectEnv } = require('./_env.cjs');

// 加载项目根目录的 .env 与当前环境的 .env.<环境名>(已设的环境变量优先)
loadProjectEnv(process.cwd());

const { cyan, dim, yellow, green, red } = style;

// ── 读 tester.config.ts(与 playwright.config.ts 同源),失败时回退默认值 ──
function loadTesterConfig() {
  try {
    const jiti = require('jiti')(__filename, { interopDefault: true });
    const mod = jiti(path.join(process.cwd(), 'tester.config.ts'));
    return (mod && (mod.testerConfig || mod.default || mod)) || {};
  } catch {
    return {};
  }
}

const cfg = loadTesterConfig();
// envs 值可以是对象(新格式:{baseURL,browser,login})或字符串地址(旧格式),统一取地址
const ENVS = Object.fromEntries(
  Object.entries(cfg.envs || {}).map(([k, v]) => [k, typeof v === 'string' ? v : (v && v.baseURL) || ''])
);
const DEFAULT_ENV = cfg.defaultEnv || Object.keys(ENVS)[0] || 'test';
const envNames = Object.keys(ENVS);

// ── 交互式选择环境(显式指定时跳过菜单) ──
function pickEnv() {
  // 优先级:显式 BASE_URL > 显式 TESTER_ENV > 只有一个环境直接用它 > 交互菜单 > 默认环境
  if (process.env.BASE_URL) {
    return Promise.resolve(process.env.TESTER_ENV || DEFAULT_ENV);
  }
  if (process.env.TESTER_ENV) {
    return Promise.resolve(process.env.TESTER_ENV);
  }
  if (envNames.length <= 1) {
    return Promise.resolve(envNames[0] || DEFAULT_ENV);
  }
  // 多个环境:方向键菜单(选项带地址,方便看清选的是哪个环境)
  return pickItem(
    '请选择要测试的环境:',
    envNames.map((n) => `${n}  ${ENVS[n]}`),
    `${DEFAULT_ENV}  ${ENVS[DEFAULT_ENV]}`
  ).then((line) => line.split('  ')[0]);
}

// ── 探测被测地址是否可达(等待时显示 spinner) ──
function checkReachable(baseURL) {
  const url = new URL(baseURL);
  const port = url.port || (url.protocol === 'https:' ? 443 : 80);
  return new Promise((resolve) => {
    const req = (url.protocol === 'https:' ? require('https') : require('http')).get(
      { host: url.hostname, port, path: url.pathname || '/', method: 'GET', timeout: 5000 },
      (res) => {
        res.resume();
        resolve(true);
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

(async () => {
  const envName = await pickEnv();
  const baseURL = process.env.BASE_URL || ENVS[envName] || ENVS[DEFAULT_ENV] || '';
  const env = { ...process.env, TESTER_ENV: envName };
  // playwright 传参:透传命令行参数(如 --grep / --headed / spec 文件)
  const args = process.argv.slice(2);

  console.log('');
  console.log(cyan('  ┌─────────────────────────────────────────────┐'));
  console.log(cyan('  │                开始跑测试                     │'));
  console.log(cyan('  └─────────────────────────────────────────────┘'));
  console.log('');
  console.log(`  ${cyan('环境')}   ${envName}`);
  if (baseURL) console.log(`  ${cyan('地址')}   ${baseURL}`);
  if (args.length) console.log(`  ${cyan('参数')}   ${args.join(' ')}`);
  console.log('');

  // 先探测环境是否可达:等待时显示 spinner
  if (baseURL) {
    const spin = spinner(`正在探测环境 ${envName}(${baseURL})...`);
    const reachable = await checkReachable(baseURL);
    if (!reachable) {
      spin.fail('✗ 环境不可达');
      console.log(red(`  ✗ 连不上 ${baseURL}`));
      console.log(dim('  请先启动被测应用,或检查环境地址配置(tester.config.ts 的 envs)。'));
      console.log(dim('  也可以临时指定地址: BASE_URL=http://... npm run test'));
      process.exit(1);
    }
    spin.stop('✓ 环境可达');
  }

  console.log(`  ${dim('正在运行')} playwright test${args.length ? ' ' + args.join(' ') : ''}...`);
  console.log('');

  // Windows 上 playwright 是 .cmd,spawn 需要 shell;用单字符串命令避免"shell+数组参数"的安全警告
  const cmd = `npx playwright test${args.length ? ' ' + args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ') : ''}`;
  const child = spawn(cmd, { stdio: 'inherit', shell: true, windowsHide: true, env });
  child.on('close', (code) => {
    console.log('');
    if (code === 0) console.log(green('  ✓ 测试全部通过'));
    else console.log(red(`  ✗ 测试结束,退出码 ${code}(有失败用例,看上方报告)`));
    console.log('');
    process.exit(code ?? 1);
  });
})().catch((e) => {
  console.error(red(`  ✗ 出错:${e.message}`));
  process.exit(1);
});
