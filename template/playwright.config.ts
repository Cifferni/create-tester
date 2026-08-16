import { defineConfig, devices } from '@playwright/test';
import { testerConfig } from './tester.config';
import { authFileName } from './tests/_login';
import { loadProjectEnv } from './scripts/_env.cjs';
import path from 'path';

// 加载项目根目录的 .env 与当前环境的 .env.<环境名>(环境名来自 TESTER_ENV 或 tester.config.ts 的 defaultEnv)。
// 优先级:已设置的环境变量 > .env.<环境> > .env > tester.config.ts。
loadProjectEnv(__dirname);

// 配置来源:tester.config.ts(总开关面板,白话注释)+ 环境变量/.env 可覆盖
//   BASE_URL         被测页面地址(显式设置优先于所有环境配置)
//   TESTER_BROWSER   浏览器:chromium/chrome/firefox/webkit(优先级高于当前环境的 browser)
//   TESTER_ACCOUNT   账号(缺省 default;多账号隔离时用,如 TESTER_ACCOUNT=admin 切第二个账号)
//   TESTER_ENV       环境名(dev/test/uat/prod 等),命中 testerConfig.envs 表则用该环境的完整配置
//   TESTER_LOGIN     是否登录:0=不登录/1=登录(优先级高于当前环境的 login)
const ENVS = testerConfig.envs || {};
const DEFAULT_ENV = testerConfig.defaultEnv || 'test';
const ENV = process.env.TESTER_ENV || '';

// 取某个环境的配置对象:envs 值可以是对象(新格式)或字符串地址(旧格式兼容)
function envOf(name: string): { baseURL?: string; browser?: string; login?: boolean } {
  const raw = ENVS[name];
  if (!raw) return {};
  if (typeof raw === 'string') return { baseURL: raw }; // 旧格式:环境名 -> 地址字符串
  return raw;
}

// 当前生效环境的配置
const cur = envOf(ENV || DEFAULT_ENV);
// 被测地址优先级:显式 BASE_URL > 当前环境 baseURL > 默认环境的地址 > 兜底
const BASE_URL = process.env.BASE_URL || cur.baseURL || envOf(DEFAULT_ENV).baseURL || 'http://localhost:3000';
// 浏览器:env TESTER_BROWSER > 当前环境 browser > testerConfig.browser > 默认 chromium
const BROWSER = process.env.TESTER_BROWSER || cur.browser || testerConfig.browser || 'chromium';
const ACCOUNT = process.env.TESTER_ACCOUNT || 'default';
// 是否登录:env TESTER_LOGIN > 当前环境 login > testerConfig.login > 默认 true
const LOGIN = process.env.TESTER_LOGIN !== '0' && (cur.login ?? testerConfig.login?.enabled ?? true);
// 登录态文件:按 环境+账号 区分(auth-<env>-<account>.json),与 _login.ts/auth.setup.ts/login.cjs 保持一致
const AUTH_FILE = authFileName();

// tester 专属配置来自 tester.config.ts(re-export 供 @create-tester/core 读取;优先级 env > 本文件 > 默认)
export { testerConfig };

// 所有输出(报告/产物/抓包)统一放在 test-result/ 下
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // 默认 1 个 worker:串行,避免用例之间互相踩数据(改配置/共享状态)。
  // 用例彼此隔离(各自造数据、各自清理)后,可调大加速,如 workers: 4;
  // 或跑的时候传 workers 参数,如 tester_run_tests {workers: 4} / tester run --workers 4。
  workers: 1,
  // 单条用例超时:卡死会被截断,不拖垮整轮(慢用例单独用 test.setTimeout 放大)
  timeout: 30000,
  outputDir: 'test-result/output',
  reporter: [
    ['html', { outputFolder: 'test-result/report', open: 'never' }],
    ['json', { outputFile: 'test-result/test-results.json' }]
  ],
  use: {
    baseURL: BASE_URL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // 录屏:失败/超时的用例保留视频(配合截图+trace,复盘更完整)
    video: 'retain-on-failure',
    // 不需要登录时就不挂登录态;需要登录时 auth.setup 生成后由 storageState 加载
    storageState: LOGIN ? AUTH_FILE : undefined
  },
  projects: LOGIN
    ? [
        // setup 先登录一次存 test-result/auth-<account>.json,业务用例共享登录态(整轮只登一次)
        { name: 'setup', testMatch: /auth\.setup\.ts/ },
        { ...projectFor(BROWSER), dependencies: ['setup'] }
      ]
    : [projectFor(BROWSER)]
});

function projectFor(browser: string) {
  switch (browser) {
    case 'chrome':
      return {
        name: 'chrome',
        use: { ...devices['Desktop Chrome'], channel: 'chrome', storageState: LOGIN ? AUTH_FILE : undefined }
      };
    case 'firefox':
      return { name: 'firefox', use: { ...devices['Desktop Firefox'], storageState: LOGIN ? AUTH_FILE : undefined } };
    case 'webkit':
      return { name: 'webkit', use: { ...devices['Desktop Safari'], storageState: LOGIN ? AUTH_FILE : undefined } };
    default:
      return { name: 'chromium', use: { ...devices['Desktop Chrome'], storageState: LOGIN ? AUTH_FILE : undefined } };
  }
}
