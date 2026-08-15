// 浏览器启动封装:根据 playwright.config.ts 的 projects 选择浏览器
//   chromium - Playwright 自带,需 playwright install chromium(默认)
//   chrome   - 使用系统已安装的 Chrome,免下载
//   firefox / webkit - Playwright 自带,需对应 install

import { chromium, firefox, webkit, type Browser } from 'playwright';
import type { BrowserName } from './types';

type LaunchOptions = Parameters<typeof chromium.launch>[0];

export function launchBrowser(browser: BrowserName | undefined, options: LaunchOptions): Promise<Browser> {
  const name = browser || 'chromium';
  switch (name) {
    case 'chrome':
      return chromium.launch({ ...options, channel: 'chrome' });
    case 'firefox':
      return firefox.launch(options);
    case 'webkit':
      return webkit.launch(options);
    default:
      return chromium.launch(options);
  }
}
