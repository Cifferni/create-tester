// 人工登录一次(验证码/短信场景):node scripts/login.cjs
// 打开带界面浏览器,测试人员手动登录(输验证码/收短信),登录态自动存到 test-result/auth-<env>-<account>.json,之后所有用例复用。
// 交互式:先选环境,再选账号(已有的账号 + 自定义新账号),全程方向键/输入,不用改文件、记变量。
//   高级用法(可选,一般用不到):
//     TESTER_ENV=uat node scripts/login.cjs        跳过菜单直接登录指定环境
//     TESTER_ACCOUNT=admin node scripts/login.cjs  跳过菜单直接登录指定账号
//     BASE_URL=http://x node scripts/login.cjs     显式指定地址(优先级最高)
//     TESTER_LOGIN=1 npm run login                 强制走人工登录(项目配了不需要登录时)
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pickItem, style, spinner, inputText } = require('./_menu.cjs');

const { dim, cyan, yellow, green, red } = style;

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

// ── 读 tests/_login.ts 的 TEST_ACCOUNTS 表(已有账号),失败时回退只有 default ──
function loadTestAccounts() {
  try {
    const jiti = require('jiti')(__filename, { interopDefault: true });
    const mod = jiti(path.join(process.cwd(), 'tests', '_login.ts'));
    const accounts = mod && (mod.TEST_ACCOUNTS || (mod.default && mod.default.TEST_ACCOUNTS));
    if (accounts && typeof accounts === 'object') return accounts;
  } catch {
    // 读取失败则用默认
  }
  return { default: { user: '', password: '' } };
}

const cfg = loadTesterConfig();
const ENVS = cfg.envs || {};
const DEFAULT_ENV = cfg.defaultEnv || Object.keys(ENVS)[0] || 'test';
const envNames = Object.keys(ENVS);
const LOGIN = process.env.TESTER_LOGIN !== '0' && (cfg.login?.enabled ?? true);

if (!LOGIN) {
  console.log('');
  console.log(yellow('  ⚠ 本项目不需要登录'));
  console.log('');
  console.log(dim('    在 tester.config.ts 里已配置 login.enabled=false,'));
  console.log(dim('    所以不用执行 npm run login,直接跑测试即可:'));
  console.log('');
  console.log(dim('      npm run test'));
  console.log('');
  console.log(dim('    如果这个项目其实需要登录,可强制:'));
  console.log(dim('      TESTER_LOGIN=1 npm run login'));
  console.log('');
  process.exit(0);
}

// ── 交互式选择环境(显式指定时跳过菜单) ──
function pickEnv() {
  if (process.env.BASE_URL) {
    return Promise.resolve({ envName: process.env.TESTER_ENV || DEFAULT_ENV, baseURL: process.env.BASE_URL });
  }
  if (process.env.TESTER_ENV) {
    const url = ENVS[process.env.TESTER_ENV] || ENVS[DEFAULT_ENV] || 'http://localhost:3000';
    return Promise.resolve({ envName: process.env.TESTER_ENV, baseURL: url });
  }
  if (envNames.length <= 1) {
    const envName = envNames[0] || DEFAULT_ENV;
    return Promise.resolve({ envName, baseURL: ENVS[envName] || 'http://localhost:3000' });
  }
  return pickItem(
    '请选择要登录的环境:',
    envNames.map((n) => `${n}  ${ENVS[n]}`),
    `${DEFAULT_ENV}  ${ENVS[DEFAULT_ENV]}`
  ).then((line) => {
    const envName = line.split('  ')[0];
    return { envName, baseURL: ENVS[envName] || 'http://localhost:3000' };
  });
}

// ── 交互式选择/新建账号:列出已有账号 + 「输入新账号」选项 ──
async function pickAccount(envName) {
  const accounts = loadTestAccounts();
  const existing = Object.keys(accounts);
  const NEW_ACCOUNT = '(输入新账号名...)';
  const options = [...existing, NEW_ACCOUNT];
  const defaultKey = process.env.TESTER_ACCOUNT && existing.includes(process.env.TESTER_ACCOUNT)
    ? process.env.TESTER_ACCOUNT
    : existing[0];

  // 显式指定且存在:直接用
  if (process.env.TESTER_ACCOUNT && existing.includes(process.env.TESTER_ACCOUNT)) {
    return process.env.TESTER_ACCOUNT;
  }

  const choice = await pickItem(
    '请选择登录的账号:',
    options.map((k) => (k === NEW_ACCOUNT ? `${dim(k)}` : k)),
    defaultKey
  );
  if (choice !== NEW_ACCOUNT) return choice;

  // 输入新账号名
  const name = await inputText('请输入新账号名(如 admin / 张三,仅用作登录态文件区分):', 'admin');
  if (!name) {
    console.log(dim('未输入账号名,取消。'));
    process.exit(0);
  }
  // 把新账号写回 tests/_login.ts 的 TEST_ACCOUNTS(自动建入口,以后测试/登录都可用)
  const loginFile = path.join(process.cwd(), 'tests', '_login.ts');
  try {
    let src = fs.readFileSync(loginFile, 'utf8');
    // 只检测真正的账号定义(带缩进+冒号),排除注释里的示例
    const accountDef = new RegExp(`^  ${name}:\\s*\\{`, 'm');
    if (!accountDef.test(src)) {
      // 在 TEST_ACCOUNTS 里插入新账号:先找 "default: {" 定位块起点,再在块结束的 "};" 前插入
      const blockStart = src.indexOf('default: {');
      if (blockStart >= 0) {
        const closeIdx = src.indexOf('};', blockStart);
        if (closeIdx >= 0) {
          const lastLineEnd = src.lastIndexOf('\n', closeIdx);
          src = src.slice(0, lastLineEnd + 1) + `  ${name}: { user: '', password: '' },  // 由 npm run login 自动添加\n` + src.slice(lastLineEnd + 1);
          fs.writeFileSync(loginFile, src, 'utf8');
          console.log(green(`  ✓ 已把账号「${name}」写入 tests/_login.ts(账号密码留空,人工登录时在浏览器里填)。`));
        } else {
          console.log(dim('  (未找到 TEST_ACCOUNTS 结束位置,账号「' + name + '」仅用于本次登录态文件命名)'));
        }
      } else {
        console.log(dim('  (未找到 TEST_ACCOUNTS,账号「' + name + '」仅用于本次登录态文件命名)'));
      }
    } else {
      console.log(dim(`  (账号「${name}」已存在于 tests/_login.ts,无需重复添加)`));
    }
  } catch (e) {
    console.log(dim(`  (未自动写入 _login.ts:${e.message})`));
  }
  return name;
}

// 1) 先探测被测地址是否可达
async function checkReachable(baseURL) {
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

function printHeader() {
  console.log('');
  console.log(cyan('  ┌─────────────────────────────────────────────┐'));
  console.log(cyan('  │             人工登录(验证码/短信)             │'));
  console.log(cyan('  └─────────────────────────────────────────────┘'));
  console.log('');
}

(async () => {
  printHeader();
  const { envName, baseURL } = await pickEnv();
  const account = await pickAccount(envName);
  const authFile = `test-result/auth-${envName}-${account}.json`;
  const authPath = path.join(process.cwd(), authFile);

  const spin = spinner(`正在探测环境 ${envName}(${baseURL})...`);
  const reachable = await checkReachable(baseURL);
  if (!reachable) {
    spin.fail('✗ 环境不可达');
    console.error(red(`  ✗ 连不上 ${baseURL}`));
    console.error(dim('  请先启动被测应用,或设 BASE_URL 指向已启动的地址,再重试。'));
    process.exit(1);
  }
  spin.stop('✓ 环境可达');
  fs.mkdirSync(path.dirname(authPath), { recursive: true });
  if (fs.existsSync(authPath)) fs.rmSync(authPath, { force: true });

  console.log(`  ${cyan('环境')}   ${envName}`);
  console.log(`  ${cyan('账号')}   ${account}`);
  console.log(`  ${cyan('地址')}   ${baseURL}`);
  console.log('');
  console.log(`  ${yellow('接下来:')}`);
  console.log(`    ${dim('1. 浏览器会自动打开上面的地址,请手动登录(输验证码/收短信)。')}`);
  console.log(`    ${dim('2. 登录成功后**关掉浏览器**,登录态会自动保存。')}`);
  console.log(`    ${dim('3. 之后所有用例复用该登录态,不用再登录。')}`);
  console.log(`    ${dim('   保存位置:')} ${green(authFile)}`);
  console.log('');

  const cmd = process.platform === 'win32' ? `npx playwright codegen "${baseURL}" "--save-storage=${authFile}"` : `npx playwright codegen '${baseURL}' '--save-storage=${authFile}'`;
  const child = spawn(cmd, { stdio: 'inherit', shell: true, windowsHide: true });
  child.on('close', (code) => {
    if (code !== 0) {
      console.error(red(`  ✗ playwright codegen 异常退出(code=${code}),登录态未保存。`));
      process.exit(code ?? 1);
    }
    if (fs.existsSync(authPath) && fs.statSync(authPath).size > 100) {
      console.log('');
      console.log(green(`  ✓ 登录态已保存到 ${authFile}`));
      console.log(dim('  现在可以直接跑测试了:'));
      console.log(dim('    npm run test'));
      console.log('');
      process.exit(0);
    }
    console.error(red(`  ✗ 未生成有效登录态:${authFile}`));
    console.error(dim('  可能没完成登录就关掉了浏览器,请重新运行:'));
    console.error(dim('    npm run login'));
    console.error(dim('  在浏览器里**登录成功后再关掉**。'));
    process.exit(1);
  });
})().catch((e) => {
  console.error(red(`  ✗ 出错:${e.message}`));
  process.exit(1);
});
