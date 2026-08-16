import { defineConfig, devices } from '@playwright/test';
import { testerConfig } from './tester.config';
import { authFileName } from './tests/_login';

// 配置来源:tester.config.ts(总开关面板,白话注释)+ 环境变量可覆盖
//   BASE_URL         被测页面地址(默认 http://localhost:3000;显式设置优先于 envs 表)
//   TESTER_BROWSER   浏览器:chromium/chrome/firefox/webkit(默认 chromium)
//   TESTER_ACCOUNT   账号(缺省 default;多账号隔离时用,如 TESTER_ACCOUNT=admin 切第二个账号)
//   TESTER_ENV       环境名(test/uat/prod 等),命中 testerConfig.envs 表则自动覆盖 BASE_URL
const ENVS = testerConfig.envs || {};
const DEFAULT_ENV = testerConfig.defaultEnv || 'test';
const ENV = process.env.TESTER_ENV || '';
const BROWSER = process.env.TESTER_BROWSER || 'chromium';
const ACCOUNT = process.env.TESTER_ACCOUNT || 'default';
// 被测系统是否需要登录(tester.config.ts 的 login.enabled;TESTER_LOGIN=0 可临时关闭)
// 不需要登录的项目:不走登录、不依赖 auth 文件,直接跑
const LOGIN = process.env.TESTER_LOGIN !== '0' && (testerConfig.login?.enabled ?? true);
// 登录态文件:按 环境+账号 区分(auth-<env>-<account>.json),与 _login.ts/auth.setup.ts/login.cjs 保持一致
const AUTH_FILE = authFileName();
// 被测地址优先级:显式 BASE_URL > TESTER_ENV 命中 envs 表 > 默认环境的地址 > 兜底
const BASE_URL = process.env.BASE_URL || (ENV ? ENVS[ENV] : ENVS[DEFAULT_ENV]) || 'http://localhost:3000';

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
