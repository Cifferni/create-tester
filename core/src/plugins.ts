// 插件体系(依赖 DSL 层):让用户/社区扩展三类能力,不必改核心代码。
//   - 用例解析器:把自定义用例格式 → 结构化文本(接 convert_case)
//   - 报告器:每轮测试结束后收到总结,做自定义处理(通知/归档/统计)
//   - 录制器:预留接口(供接入自定义录制/探针)
// 约定:工程根目录可选放 plugin/ 目录,每个 .cjs 导出 register(api) 或直接导出对象。
//   例 plugin/notify.cjs:
//     module.exports = { name: 'notify', type: 'reporter', onSummary(summary) { ... } };

import type { TestSummary } from './playwright';

export interface TesterPlugin {
  name: string;
  /** 插件类型:reporter(报告器)/caseParser(用例解析器)/recorder(录制器) */
  type: 'reporter' | 'caseParser' | 'recorder';
  /** 报告器:每轮测试结束后收到总结 */
  onSummary?(summary: TestSummary): void | Promise<void>;
  /** 用例解析器:自定义扩展名(不含点,如 'feature')→ 文本;返回 null 表示不处理 */
  parseCase?(file: string): string | null;
  /** 录制器:预留,自定义录制钩子 */
  init?(): void;
}

export interface PluginRegistry {
  reporters: TesterPlugin[];
  caseParsers: TesterPlugin[];
  recorders: TesterPlugin[];
}

// 从工程根目录加载插件(plugin/ 下所有 .cjs,容错:单个插件坏不影响整体)。
export function loadPlugins(projectRoot: string): PluginRegistry {
  const registry: PluginRegistry = { reporters: [], caseParsers: [], recorders: [] };
  const { existsSync, readdirSync } = require('fs');
  const { join } = require('path');
  const dir = join(projectRoot, 'plugin');
  if (!existsSync(dir)) return registry;
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.cjs') && !entry.endsWith('.js')) continue;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(join(dir, entry));
      const plugin: TesterPlugin | undefined = mod?.default || mod;
      if (!plugin || typeof plugin !== 'object' || !plugin.type) continue;
      if (plugin.type === 'reporter' && plugin.onSummary) registry.reporters.push(plugin);
      if (plugin.type === 'caseParser' && plugin.parseCase) registry.caseParsers.push(plugin);
      if (plugin.type === 'recorder') registry.recorders.push(plugin);
    } catch (e) {
      // 单个插件加载失败不影响整体
      console.error(`[plugin] 加载失败 ${entry}:${(e as Error).message}`);
    }
  }
  return registry;
}
