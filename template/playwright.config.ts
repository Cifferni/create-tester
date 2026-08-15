import { defineConfig, devices } from '@playwright/test';

// 配置来源:环境变量(也可直接改这里)
//   BASE_URL        被测页面地址(默认 http://localhost:3000)
//   TESTER_BROWSER  浏览器:chromium/chrome/firefox/webkit(默认 chromium)
const BROWSER = process.env.TESTER_BROWSER || 'chromium';

// 所有输出(报告/产物/抓包)统一放在 result/ 下
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // 默认 1 个 worker:串行,避免用例之间互相踩数据(改配置/共享状态)。
  // 用例彼此隔离(各自造数据、各自清理)后,可调大加速,如 workers: 4。
  workers: 1,
  outputDir: 'result/output',
  reporter: [
    ['html', { outputFolder: 'result/report', open: 'never' }],
    ['json', { outputFile: 'result/test-results.json' }]
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [projectFor(BROWSER)]
});

function projectFor(browser: string) {
  switch (browser) {
    case 'chrome':
      return { name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } };
    case 'firefox':
      return { name: 'firefox', use: { ...devices['Desktop Firefox'] } };
    case 'webkit':
      return { name: 'webkit', use: { ...devices['Desktop Safari'] } };
    default:
      return { name: 'chromium', use: { ...devices['Desktop Chrome'] } };
  }
}
