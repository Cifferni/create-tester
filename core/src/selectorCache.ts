// 选择器持久缓存:selfHeal 定位命中后把首选选择器落盘,下次运行优先读缓存(快路径),
// 不再重复走"多候选探测 → 让 AI 重识"的慢路径,降低 Token 开销、提升稳定性。
// 缓存文件 test-result/locator-cache.json(gitignore 覆盖,随测试产物一起清)。
// 开关:环境变量 TESTER_LOCATOR_CACHE=0 关闭(缺省开)。

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { locatorCacheEnabled } from './config';

export type LocatorMethod = 'css' | 'testid' | 'text-exact' | 'text';

export interface LocatorCacheEntry {
  /** 落盘的首选选择器字符串(对应候选字符串) */
  selector: string;
  /** 定位方式:css / testid / text-exact / text(供快速重建 locator) */
  method: LocatorMethod;
  /** 累计命中次数 */
  hits: number;
  /** 累计失效次数(缓存命中但定位失败) */
  misses: number;
  /** 最近写入时间戳 */
  updatedAt: number;
}

export type LocatorCacheData = Record<string, LocatorCacheEntry>;

function enabled(): boolean {
  return locatorCacheEnabled();
}

// 缓存文件路径:优先工程根(与 playwright.config.ts 同一位置),缺省 cwd
function cacheFilePath(): string {
  return path.join(process.env.TESTER_PROJECT_ROOT || process.cwd(), 'test-result', 'locator-cache.json');
}

// 缓存 key:归一化 URL(去掉 query/hash)+ 候选串,避免"URL 参数变一下就缓存全废"
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

export function locatorCacheKey(url: string, candidates: string[]): string {
  const seed = `${normalizeUrl(url)}\n${candidates.join('\n')}`;
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 24);
}

// ── 进程内缓存 + 合并写:读一次进内存,多次 mutate 只落盘一次 ──

let memory: LocatorCacheData | null = null;
let writeQueued = false;
let dirty = false;

function loadMemory(): LocatorCacheData {
  if (memory) return memory;
  if (!enabled()) {
    memory = {};
    return memory;
  }
  try {
    const file = cacheFilePath();
    memory = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as LocatorCacheData) : {};
  } catch {
    memory = {};
  }
  return memory;
}

function flush(): void {
  if (!dirty || !memory) return;
  dirty = false;
  try {
    const file = cacheFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(memory, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch {
    // 缓存写失败不影响测试执行
  }
}

// 变更入队:记 dirty,同一 tick 内多次变更只写一次(异步尾随写)
function scheduleWrite(): void {
  if (!memory) return;
  dirty = true;
  if (writeQueued) return;
  writeQueued = true;
  setTimeout(() => {
    writeQueued = false;
    flush();
  }, 0);
}

export function readLocatorCache(): LocatorCacheData {
  return { ...loadMemory() };
}

export interface LocatorCacheStats {
  total: number;
  hits: number;
  misses: number;
  hitRate: number;
  /** VLM 视觉降级累计次数(语义定位全失败后启用) */
  vlmUses: number;
  disabled: boolean;
}

// 命中率统计:供报告/CLI 展示"缓存帮我们省了多少次 AI 定位"
export function locatorCacheStats(): LocatorCacheStats {
  const data = loadMemory();
  let hits = 0;
  let misses = 0;
  for (const e of Object.values(data)) {
    hits += e.hits;
    misses += e.misses;
  }
  return {
    total: Object.keys(data).length,
    hits,
    misses,
    hitRate: hits + misses > 0 ? hits / (hits + misses) : 0,
    vlmUses,
    disabled: !enabled()
  };
}

// VLM 降级计数:记录语义定位失败后启用视觉兜底的次数
let vlmUses = 0;
export function recordVlmUse(): void {
  vlmUses++;
}

// 读某个 key 的缓存条目(不存在返回 undefined)
export function getCachedSelector(key: string): LocatorCacheEntry | undefined {
  return loadMemory()[key];
}

// 记录一次命中(hits+1,misses 清零)。命中即说明选择器仍有效,是可信的。
export function recordCacheHit(key: string, entry: Pick<LocatorCacheEntry, 'selector' | 'method'>): void {
  const data = loadMemory();
  const prev = data[key];
  data[key] = { ...entry, hits: (prev?.hits ?? 0) + 1, misses: 0, updatedAt: Date.now() };
  scheduleWrite();
}

// 记录一次失效(misses+1);连续失效超过阈值剔除,避免脏选择器永久占缓存
export function recordCacheMiss(key: string, maxMisses = 3): void {
  const data = loadMemory();
  const prev = data[key];
  if (!prev) return;
  const misses = (prev.misses ?? 0) + 1;
  if (misses >= maxMisses) {
    delete data[key];
    scheduleWrite();
    return;
  }
  data[key] = { ...prev, misses, updatedAt: Date.now() };
  scheduleWrite();
}
