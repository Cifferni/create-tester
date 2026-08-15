// 浏览器启动封装:根据 playwright.config.ts 的 projects 选择浏览器
//   chromium - Playwright 自带,需 playwright install chromium(默认)
//   chrome   - 使用系统已安装的 Chrome,免下载
//   firefox / webkit - Playwright 自带,需对应 install

import { chromium, firefox, webkit, type Browser } from 'playwright';
import type { BrowserName } from './types';

type LaunchOptions = Parameters<typeof chromium.launch>[0];

// 在 MCP server 进程内复用同一个浏览器:snapshot 等工具连开页面不用每次重拉浏览器(能省 1-2s/次)
let shared: Browser | null = null;

export async function launchBrowser(browser: BrowserName | undefined, options: LaunchOptions): Promise<Browser> {
  if (shared && shared.isConnected()) return shared;
  const name = browser || 'chromium';
  const launched =
    name === 'chrome'
      ? await chromium.launch({ ...options, channel: 'chrome' })
      : name === 'firefox'
        ? await firefox.launch(options)
        : name === 'webkit'
          ? await webkit.launch(options)
          : await chromium.launch(options);
  shared = launched;
  return launched;
}

export function closeBrowser(): Promise<void> {
  if (shared) {
    const b = shared;
    shared = null;
    return b.close();
  }
  return Promise.resolve();
}
