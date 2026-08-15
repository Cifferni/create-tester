// 页面结构提取:把当前页面转成紧凑、语义化的快照,作为 AI 定位的输入。
// 用 Playwright 的 ARIA 快照(可访问名),比原始 HTML 小得多且贴近测试语言。
// 纯图标按钮(img/svg 无 label)在 ARIA 里只有空的 button:,所以再补充一层 DOM 探查:
// 把"没有文字/没有 label 的可交互元素"用 class/title/alt 标出来,让 AI 有东西可定位。

import { type Page } from '@playwright/test';

interface ElLike {
  tagName: string;
  textContent: string | null;
  id: string;
  className: string;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
  querySelector(sel: string): { getAttribute(name: string): string | null } | null;
}

// 提取页面可交互结构给 AI 定位用
export async function getPageSnapshot(page: Page, maxChars = 8000): Promise<string> {
  let primary = '';
  try {
    const snap = await page.locator('body').ariaSnapshot();
    primary = typeof snap === 'string' ? snap : JSON.stringify(snap);
  } catch {
    primary = '';
  }
  const parts = [primary];

  // DOM 补充:收集没有可访问名的可交互元素,用 class/title/alt 描述
  try {
    const extra = await page
      .locator('button, a, input, select, textarea, img, [role], [data-testid]')
      .evaluateAll((els) =>
        els
          .slice(0, 200)
          .map((el) => {
            const e = el as unknown as ElLike;
            const tag = e.tagName.toLowerCase();
            const label =
              e.getAttribute('aria-label') ||
              e.getAttribute('data-testid') ||
              e.getAttribute('placeholder') ||
              e.getAttribute('title') ||
              e.getAttribute('alt') ||
              e.textContent?.trim() ||
              '';
            if (label) return null; // 有名字的不重复列
            const cls = (e.className || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
            const role = e.getAttribute('role') || tag;
            const title = e.getAttribute('title') ? ` title="${e.getAttribute('title')}"` : '';
            const alt = e.getAttribute('alt') ? ` alt="${e.getAttribute('alt')}"` : '';
            const disabled = e.hasAttribute('disabled') ? ' [disabled]' : '';
            // 纯图标按钮:补第一个 svg path 的 d 特征,便于区分不同图标
            const svg = e.querySelector('svg path')?.getAttribute('d')?.slice(0, 24) || '';
            const svgHint = svg ? ` svg="${svg}"` : '';
            return `[${role}${disabled}]${cls ? ` class="${cls}"` : ''}${title}${alt}${svgHint}`;
          })
          .filter(Boolean)
      );
    if (extra.length) {
      parts.push('\n--- 补充:无文字/无 label 的元素(可用 class/title/alt 定位) ---');
      parts.push(extra.join('\n'));
    }
  } catch {
    // 忽略补充失败
  }

  const text = parts.filter(Boolean).join('\n');
  return text.length > maxChars ? text.slice(0, maxChars) + '\n...(已截断)' : text;
}
