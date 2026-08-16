import { defineConfig, devices } from '@playwright/test';
import { testerConfig } from './tester.config';

// 配置来源:tester.config.ts(总开关面板,白话注释)+ 环境变量可覆盖
//   BASE_URL         被测页面地址(默认 http://localhost:3000;显式设置优先于 envs 表)
//   TESTER_BROWSER   浏览器:chromium/chrome/firefox/webkit(默认 chromium)
//   TESTER_ACCOUNT   账号(缺省 default;多账号隔离时用,如 TESTER_ACCOUNT=admin 切第二个账号)
//   TESTER_ENV       环境名(test/uat/prod 等),命中 testerConfig.envs 表则自动覆盖 BASE_URL
const ENVS = testerConfig.envs;
const ENV = process.env.TESTER_ENV || '';
const BROWSER = process.env.TESTER_BROWSER || 'chromium';
const ACCOUNT = process.env.TESTER_ACCOUNT || 'default';
// 各账号登录态独立文件(auth-<account>.json),多账号互不覆盖
const AUTH_FILE = `test-result/auth-${ACCOUNT}.json`;
// TESTER_ENV 命中则覆盖被测地址;显式 BASE_URL 永远最高优先级
const BASE_URL = process.env.BASE_URL || (ENVS[ENV] || 'http://localhost:3000');

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
    video: 'retain-on-failure'
  },
  projects: [
    // setup 先登录一次存 test-result/auth-<account>.json,业务用例共享登录态(整轮只登一次)
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { ...projectFor(BROWSER), dependencies: ['setup'] }
  ]
});

function projectFor(browser: string) {
  switch (browser) {
    case 'chrome':
      return {
        name: 'chrome',
        use: { ...devices['Desktop Chrome'], channel: 'chrome', storageState: AUTH_FILE }
      };
    case 'firefox':
      return { name: 'firefox', use: { ...devices['Desktop Firefox'], storageState: AUTH_FILE } };
    case 'webkit':
      return { name: 'webkit', use: { ...devices['Desktop Safari'], storageState: AUTH_FILE } };
    default:
      return { name: 'chromium', use: { ...devices['Desktop Chrome'], storageState: AUTH_FILE } };
  }
}
