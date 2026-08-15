// 运行配置来源:被测地址与浏览器来自 playwright.config.ts(唯一配置源,MCP snapshot 打开页面时读取)

import fs from 'fs';
import path from 'path';
import { createJiti } from 'jiti';
import type { BrowserName } from './types';

export interface PWConfig {
  baseURL: string;
  browser: BrowserName;
}

// 从 playwright.config.ts 读被测地址与浏览器(单一配置源)
export function playwrightConfig(urlOverride?: string): PWConfig {
  let baseURL = 'http://localhost:3000';
  let browser: BrowserName = 'chromium';
  // MCP 场景用 tester mcp <dir> 传的工程根目录,缺省当前目录
  const file = path.join(process.env.TESTER_PROJECT_ROOT || process.cwd(), 'playwright.config.ts');
  if (fs.existsSync(file)) {
    try {
      const jiti = createJiti(__filename);
      const mod = jiti(file) as {
        default?: { use?: { baseURL?: string }; projects?: Array<{ name?: string }> };
      };
      const cfg = mod.default;
      if (cfg?.use?.baseURL) baseURL = cfg.use.baseURL;
      const p = cfg?.projects?.[0]?.name;
      if (p === 'chrome' || p === 'firefox' || p === 'webkit' || p === 'chromium') browser = p;
    } catch {
      // 读不到就用默认
    }
  }
  if (urlOverride) baseURL = urlOverride;
  return { baseURL, browser };
}
