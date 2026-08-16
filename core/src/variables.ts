// 变量系统(跨步骤 / 跨用例参数传递):
//   setVar/getVar 读写变量,支撑「用例A创建订单提取 orderId → 用例B用 orderId 查询/编辑」的长链路。
// 三种来源(读取优先级从高到低):
//   1. 全局变量文件 test-result/.vars.json(跨 spec、跨进程,由 setVar 写入)
//   2. 环境变量 process.env(运行前注入,如 TESTER_ACCOUNT)
//   3. 局部内存(单 spec 内,仅本文件进程,测试运行结束即失效)
// 用 TESTER_VARS=0 可关闭全局落盘(只用局部/环境)。

import fs from 'fs';
import path from 'path';
import { varsEnabled } from './config';

type VarsMap = Record<string, string>;

// 全局变量文件路径:优先工程根(与 playwright.config.ts 同一位置),缺省 cwd
function varsFilePath(): string {
  return path.join(process.env.TESTER_PROJECT_ROOT || process.cwd(), 'test-result', '.vars.json');
}

function globalEnabled(): boolean {
  return varsEnabled();
}

// 单 spec 内共享的局部内存(进程内有效)
const local: VarsMap = {};

// ── 全局文件读写(带进程内缓存,避免每次 getVar 都读盘) ──

let globalCache: VarsMap | null = null;
let writeQueued = false;
let dirty = false;

function loadGlobal(): VarsMap {
  if (globalCache) return globalCache;
  if (!globalEnabled()) {
    globalCache = {};
    return globalCache;
  }
  try {
    const file = varsFilePath();
    globalCache = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as VarsMap) : {};
  } catch {
    globalCache = {};
  }
  return globalCache;
}

function flushGlobal(): void {
  if (!dirty || !globalCache) return;
  dirty = false;
  try {
    const file = varsFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(globalCache, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch {
    // 写失败不影响测试
  }
}

function scheduleWrite(): void {
  if (!globalEnabled()) return;
  dirty = true;
  if (writeQueued) return;
  writeQueued = true;
  setTimeout(() => {
    writeQueued = false;
    flushGlobal();
  }, 0);
}

// 设置变量:写全局(跨 spec/跨进程)+ 局部内存。值统一转字符串。
export function setVar(name: string, value: string | number | boolean): void {
  const s = String(value);
  local[name] = s;
  if (globalEnabled()) {
    loadGlobal()[name] = s;
    scheduleWrite();
  }
}

// 读取变量:局部内存 > 全局文件 > 环境变量。读不到返回 ''。
export function getVar(name: string): string {
  if (name in local) return local[name];
  if (globalEnabled() && name in loadGlobal()) return loadGlobal()[name];
  return process.env[name] ?? '';
}

// 读取变量,空值抛错(带说明,方便排查"前置用例没跑/没 setVar")
export function getVarOrFail(name: string, hint = ''): string {
  const v = getVar(name);
  if (!v) {
    throw new Error(
      `变量 ${name} 为空:${hint || `请确认前置用例已执行并 setVar('${name}', ...),或通过环境变量/数据驱动提供。`}`
    );
  }
  return v;
}

// 列出当前可见变量(局部 + 全局,不含环境变量),供调试/报告
export function listVars(): VarsMap {
  return { ...loadGlobal(), ...local };
}

// 清空全部变量(局部 + 全局文件)。跑全量回归前调用,避免上一次运行的残留变量污染本次。
export function resetVars(): void {
  for (const k of Object.keys(local)) delete local[k];
  if (globalEnabled()) {
    const g = loadGlobal();
    for (const k of Object.keys(g)) delete g[k];
    dirty = true;
    flushGlobal();
  }
  globalCache = null;
}
