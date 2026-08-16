// VLM 视觉降级兜底(V6):语义定位(selfHeal 多候选)全部失败时,降级调用视觉模型按坐标定位。
// 设计原则(与 Issue 结论一致):结构化定位为主,视觉仅作兜底、默认关闭;
// 视觉定位成功后尽量反向沉淀选择器缓存(见 api.ts 的 selfHeal 与 selectorCache 打通),减少后续重复调用视觉模型。
// 接入方式:工程 plugin/ 下放一个 type:'locatorVlm' 的插件,selfHeal 全失败时自动降级调用。

import type { Page } from '@playwright/test';
import { loadPlugins, type TesterPlugin } from './plugins';
import { vlmConfig } from './config';

// 缓存已加载的 VLM 插件(避免每次 selfHeal 失败都重新扫描 plugin/ 目录)
let vlmPlugins: TesterPlugin[] | null = null;

function getVlmPlugins(): TesterPlugin[] {
  if (vlmPlugins === null) {
    const root = process.env.TESTER_PROJECT_ROOT || process.cwd();
    vlmPlugins = loadPlugins(root).locatorVlms;
  }
  return vlmPlugins;
}

// 视觉定位结果:VLM 给坐标,这里把"坐标命中的真实元素"转成语义选择器(反向沉淀用)。
export interface VlmResolveResult {
  /** 坐标命中的元素推导出的选择器(css;优先 data-testid/id) */
  selector: string;
  /** 使用的 VLM 插件名 */
  plugin: string;
  /** 原始坐标 */
  x: number;
  y: number;
}

// 坐标 → 元素 → 语义选择器(页面上下文执行,支持 open shadowRoot)
function selectorFromPoint({ x, y }: { x: number; y: number }): string | null {
  const hit = (document.elementFromPoint(x, y) as HTMLElement | null) || null;
  if (!hit) return null;
  const id = hit.getAttribute('data-testid') || hit.id;
  if (id) return `#${CSS.escape(id)}`;
  // 有限 class:取前 2 个,避免超长/动态 class
  const cls = Array.from(hit.classList).slice(0, 2).map((c) => `.${CSS.escape(c)}`).join('');
  if (cls) return cls;
  // 文本兜底
  const text = (hit.textContent || '').trim().slice(0, 20);
  if (text) return `text=${text}`;
  return null;
}

// 调 VLM 插件定位目标,成功后返回反哺缓存用的选择器;无法定位返回 null
export async function resolveVlm(page: Page, target: string): Promise<VlmResolveResult | null> {
  const cfg = vlmConfig();
  if (!cfg.enabled) return null; // 开关没开,不降级
  if (!cfg.apiUrl || !cfg.apiKey) return null; // 没填模型地址/key,无法调
  for (const plugin of getVlmPlugins()) {
    try {
      const result = await plugin.locateVlm?.(page, target, cfg);
      if (!result) continue;
      const selector = await page.evaluate(selectorFromPoint, { x: result.x, y: result.y });
      if (!selector) continue; // 坐标没落到元素上,跳过该插件
      // onVlmHit 可自定义反哺选择器;未实现就用坐标推导的
      const custom = await plugin.onVlmHit?.(page, target, result).catch(() => null);
      return { selector: custom || selector, plugin: plugin.name, x: result.x, y: result.y };
    } catch {
      // 单个 VLM 插件失败,继续尝试下一个
      continue;
    }
  }
  return null;
}

// 重置已缓存的 VLM 插件列表(测试间如需刷新)
export function resetVlmPlugins(): void {
  vlmPlugins = null;
}
