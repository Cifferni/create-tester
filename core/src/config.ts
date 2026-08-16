// 运行配置来源:被测地址/浏览器/开关来自 tester.config.ts(经 playwright.config.ts 暴露),环境变量可覆盖。
// 优先级:环境变量 > playwright.config.ts 导出的 testerConfig > 内置默认值。

import fs from 'fs';
import path from 'path';
import { createJiti } from 'jiti';
import type { BrowserName, FailureCategory } from './types';

export interface PWConfig {
  baseURL: string;
  browser: BrowserName;
}

/** 单个环境(dev/test/uat/prod 等)的完整配置 */
export interface EnvConfig {
  /** 该环境被测地址 */
  baseURL: string;
  /** 该环境用哪个浏览器(chromium/chrome/firefox/webkit),缺省用全局 browser */
  browser?: BrowserName;
  /** 该环境是否需要登录,缺省用全局 login.enabled */
  login?: boolean;
  /** 该环境的 VLM 视觉兜底配置(enabled/model/apiUrl/timeout);apiKey 走 .env.<环境> 的 TESTER_VLM_API_KEY */
  vlm?: EnvVlmConfig;
}

/** 单个环境的 VLM 配置(apiKey 不在这里,走 .env.<环境> 的 TESTER_VLM_API_KEY,避免进 git) */
export interface EnvVlmConfig {
  /** 是否启用视觉降级(默认 false,配了 plugin 后自动生效) */
  enabled?: boolean;
  /** 视觉模型名(如 glm-4v / qwen-vl-max / gpt-4o),传给模型服务的标识 */
  model?: string;
  /** 视觉模型服务 API 地址(兼容 OpenAI 风格接口) */
  apiUrl?: string;
  /** 单次视觉定位超时秒数,默认 8(超时即放弃,不阻塞测试链路) */
  timeout?: number;
}

export interface TesterConfig {
  /** 多环境配置表:每个环境一段完整配置(地址/浏览器/登录/VLM)。兼容旧格式:值可以是字符串地址 */
  envs?: Record<string, EnvConfig | string>;
  /** 默认环境名:未传 TESTER_ENV 时用该环境的配置,缺省 'test' */
  defaultEnv?: string;
  /** 全局默认浏览器(环境没单独配 browser 时用),缺省 chromium */
  browser?: BrowserName;
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
  /** VLM 视觉降级兜底(全局;apiKey 走 .env.<环境> 的 TESTER_VLM_API_KEY) */
  vlm?: {
    /** 是否启用视觉降级(默认 false,配了 plugin 后自动生效) */
    enabled?: boolean;
    /** 视觉模型名(如 glm-4v / qwen-vl-max / gpt-4o),传给模型服务的标识 */
    model?: string;
    /** 视觉模型服务 API 地址(兼容 OpenAI 风格接口) */
    apiUrl?: string;
    /** API key(推荐用 .env.<环境> 的 TESTER_VLM_API_KEY,避免进仓库) */
    apiKey?: string;
    /** 单次视觉定位超时秒数,默认 8(超时即放弃,不阻塞测试链路) */
    timeout?: number;
  };
  /** 登录开关(全局默认;每个环境可用 envs[x].login 单独覆盖) */
  login?: {
    /** 是否需要登录(默认 true) */
    enabled?: boolean;
  };
  /** 测试后自动恢复数据:每轮测试结束后自动执行 mcp/env-reset.cjs 清理/还原被测数据 */
  autoReset?: {
    /** 是否启用自动恢复(默认 false) */
    enabled?: boolean;
    /** 只在有失败时恢复(true 节省时间;false 不管成败都恢复,保证环境恒净) */
    onFailureOnly?: boolean;
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

// 从 playwright.config.ts 读被测地址与浏览器(配置源为 tester.config.ts,经 playwright.config.ts 暴露)
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

// 当前环境名:TESTER_ENV 显式指定,否则用 tester.config.ts 的 defaultEnv,缺省 'test'
export function currentEnv(): string {
  return process.env.TESTER_ENV || testerConfig().defaultEnv || 'test';
}

// 取指定环境的配置(兼容旧格式:envs 值可能是字符串地址)
export function envConfig(name?: string): EnvConfig {
  const n = name || currentEnv();
  const raw = testerConfig().envs?.[n];
  if (typeof raw === 'string') return { baseURL: raw }; // 旧格式:环境名 -> 地址字符串
  return raw || { baseURL: '' };
}

// ── 开关解析:环境变量 > 当前环境的配置 > testerConfig 全局 > 默认 ──

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

// 浏览器:env TESTER_BROWSER > 当前环境 browser > 全局 browser > 默认 chromium
export function browserName(): BrowserName {
  if (process.env.TESTER_BROWSER) return (process.env.TESTER_BROWSER as BrowserName);
  const e = envConfig();
  if (e.browser) return e.browser;
  return (testerConfig().browser as BrowserName) || 'chromium';
}

// 当前生效的 tester 配置(含 env 覆盖后的最终值),供 tester_config 工具只读展示
export function effectiveTesterConfig(): TesterConfig & {
  switchesResolved: { locatorCache: boolean; vars: boolean };
  vlmResolved: boolean;
  currentEnv: string;
  envResolved: EnvConfig;
} {
  const c = testerConfig();
  const cur = envConfig();
  return {
    ...c,
    switchesResolved: { locatorCache: locatorCacheEnabled(), vars: varsEnabled() },
    vlmResolved: vlmConfig().enabled,
    currentEnv: currentEnv(),
    envResolved: cur
  };
}

// VLM 配置解析:enabled/model/apiUrl/timeout 从 tester.config.ts 读(当前环境 envs[x].vlm > 全局 testerConfig.vlm);
// apiKey 只走 .env.<环境> 的 TESTER_VLM_API_KEY,不进 tester.config.ts、不进 git。
export function vlmConfig(): { enabled: boolean; model: string; apiUrl: string; apiKey: string; timeoutMs: number } {
  const cur = envConfig().vlm;
  const global = testerConfig().vlm ?? {};
  const v = cur ?? global;
  return {
    enabled: v.enabled ?? false,
    model: v.model || global.model || '',
    apiUrl: v.apiUrl || global.apiUrl || '',
    apiKey: process.env.TESTER_VLM_API_KEY || global.apiKey || '',
    timeoutMs: Math.max((v.timeout ?? global.timeout ?? 8), 1) * 1000
  };
}

// 登录开关:env TESTER_LOGIN > 当前环境 login > testerConfig.login > 默认 true
export function loginEnabled(): boolean {
  if (process.env.TESTER_LOGIN !== undefined) return process.env.TESTER_LOGIN !== '0';
  const e = envConfig();
  if (e.login !== undefined) return e.login;
  const l = testerConfig().login?.enabled;
  return l !== undefined ? l : true;
}

// 测试后自动恢复数据:env TESTER_AUTO_RESET=0 关闭 / =1 打开(默认关)
export function autoResetEnabled(): boolean {
  if (process.env.TESTER_AUTO_RESET !== undefined) return process.env.TESTER_AUTO_RESET !== '0';
  const a = testerConfig().autoReset?.enabled;
  return a !== undefined ? a : false;
}

// 自动恢复是否只在失败时触发(默认 false=不管成败都恢复)
export function autoResetOnFailureOnly(): boolean {
  const a = testerConfig().autoReset?.onFailureOnly;
  return a !== undefined ? a : false;
}
