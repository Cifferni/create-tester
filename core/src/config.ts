// 运行配置来源:被测地址/浏览器/开关来自 playwright.config.ts(唯一配置源),环境变量可覆盖。
// 优先级:环境变量 > playwright.config.ts 导出的 testerConfig > 内置默认值。

import fs from 'fs';
import path from 'path';
import { createJiti } from 'jiti';
import type { BrowserName, FailureCategory } from './types';

export interface PWConfig {
  baseURL: string;
  browser: BrowserName;
}

export interface TesterConfig {
  /** 多环境地址表(playwright.config.ts 的 ENVS;TESTER_ENV 命中时切到对应地址) */
  envs?: Record<string, string>;
  /** 功能开关(环境变量可覆盖) */
  switches?: {
    /** 选择器持久缓存,对应 TESTER_LOCATOR_CACHE=0 关闭 */
    locatorCache?: boolean;
    /** 跨用例变量全局落盘,对应 TESTER_VARS=0 关闭 */
    vars?: boolean;
  };
  /** 失败自动重试策略 */
  retry?: {
    /** 最多重试轮数 */
    maxRounds?: number;
    /** 哪些失败分类可自动重试(缺省 定位/网络/超时) */
    retryable?: FailureCategory[];
  };
  /** VLM 视觉降级兜底 */
  vlm?: {
    /** 是否启用视觉降级(默认 false,配了 plugin 后自动生效) */
    enabled?: boolean;
    /** 视觉模型名(如 glm-4v / qwen-vl-max / gpt-4o),传给模型服务的标识 */
    model?: string;
    /** 视觉模型服务 API 地址(兼容 OpenAI 风格接口) */
    apiUrl?: string;
    /** API key(也可用环境变量 TESTER_VLM_API_KEY,env 优先级更高,避免写死在仓库) */
    apiKey?: string;
    /** 单次视觉定位超时秒数,默认 8(超时即放弃,不阻塞测试链路) */
    timeout?: number;
  };
}

function configFile(): string {
  return path.join(process.env.TESTER_PROJECT_ROOT || process.cwd(), 'playwright.config.ts');
}

// 读 playwright.config.ts 导出(默认 export + 命名导出 testerConfig)。读取失败返回 null。
function readModule(): { default?: { use?: { baseURL?: string }; projects?: Array<{ name?: string }> }; testerConfig?: TesterConfig } | null {
  const file = configFile();
  if (!fs.existsSync(file)) return null;
  try {
    const jiti = createJiti(__filename);
    return jiti(file) as { default?: { use?: { baseURL?: string }; projects?: Array<{ name?: string }> }; testerConfig?: TesterConfig };
  } catch {
    return null;
  }
}

// 从 playwright.config.ts 读被测地址与浏览器(单一配置源)
export function playwrightConfig(urlOverride?: string): PWConfig {
  let baseURL = 'http://localhost:3000';
  let browser: BrowserName = 'chromium';
  const mod = readModule();
  const cfg = mod?.default;
  if (cfg?.use?.baseURL) baseURL = cfg.use.baseURL;
  const p = cfg?.projects?.[0]?.name;
  if (p === 'chrome' || p === 'firefox' || p === 'webkit' || p === 'chromium') browser = p;
  if (urlOverride) baseURL = urlOverride;
  return { baseURL, browser };
}

// testerConfig 读取(模块级缓存,避免高频 selfHeal 每次都 jiti 编译)
let cached: TesterConfig | null | undefined;

export function testerConfig(): TesterConfig {
  if (cached !== undefined) return cached ?? {};
  cached = readModule()?.testerConfig ?? {};
  return cached;
}

// 手动清缓存(set_base_url 等改动 config 文件后调用,保证下次读到最新)
export function clearConfigCache(): void {
  cached = undefined;
}

// ── 开关解析:环境变量 > testerConfig.switches > 默认 ──

export function locatorCacheEnabled(): boolean {
  if (process.env.TESTER_LOCATOR_CACHE !== undefined) return process.env.TESTER_LOCATOR_CACHE !== '0';
  const s = testerConfig().switches?.locatorCache;
  return s !== undefined ? s : true;
}

export function varsEnabled(): boolean {
  if (process.env.TESTER_VARS !== undefined) return process.env.TESTER_VARS !== '0';
  const s = testerConfig().switches?.vars;
  return s !== undefined ? s : true;
}

// 当前生效的 tester 配置(含 env 覆盖后的最终值),供 tester_config 工具只读展示
export function effectiveTesterConfig(): TesterConfig & { switchesResolved: { locatorCache: boolean; vars: boolean }; vlmResolved: boolean } {
  const c = testerConfig();
  return {
    ...c,
    switchesResolved: { locatorCache: locatorCacheEnabled(), vars: varsEnabled() },
    vlmResolved: c.vlm?.enabled ?? false
  };
}

// VLM 配置解析:env(TESTER_VLM_API_KEY) > testerConfig.vlm
export function vlmConfig(): { enabled: boolean; model: string; apiUrl: string; apiKey: string; timeoutMs: number } {
  const v = testerConfig().vlm ?? {};
  return {
    enabled: v.enabled ?? false,
    model: v.model || '',
    apiUrl: v.apiUrl || '',
    apiKey: process.env.TESTER_VLM_API_KEY || v.apiKey || '',
    timeoutMs: Math.max((v.timeout ?? 8), 1) * 1000
  };
}
