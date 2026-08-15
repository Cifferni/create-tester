// 页面结构提取:把当前页面转成紧凑、语义化的快照,作为 AI 定位的输入。
// 用 Playwright 的 ARIA 快照(可访问名),比原始 HTML 小得多且贴近测试语言。

import { type Page } from '@playwright/test';

interface ElLike {
  tagName: string;
  textContent: string | null;
  id: string;
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
}

// 提取页面可交互结构给 AI 定位用
export async function getPageSnapshot(page: Page, maxChars = 8000): Promise<string> {
  try {
    const snap = await page.locator('body').ariaSnapshot();
    const text = typeof snap === 'string' ? snap : JSON.stringify(snap);
    return text.length > maxChars ? text.slice(0, maxChars) + '\n...(已截断)' : text;
  } catch {
    // 兜底:手动收集可交互元素
    const list = await page
      .locator('button, a, input, select, textarea, [role], [data-testid]')
      .evaluateAll((els) =>
        els.slice(0, 120).map((el) => {
          const e = el as unknown as ElLike;
          const tag = e.tagName.toLowerCase();
          const role = e.getAttribute('role') || (tag === 'input' ? e.getAttribute('type') || 'input' : tag);
          const name =
            e.getAttribute('aria-label') ||
            e.getAttribute('data-testid') ||
            e.getAttribute('placeholder') ||
            e.textContent?.trim().slice(0, 40) ||
            '';
          const disabled = e.hasAttribute('disabled') ? ' [disabled]' : '';
          const id = e.id ? ` #${e.id}` : '';
          return `[${role}${disabled}] "${name}"${id}`;
        })
      );
    return list.join('\n').slice(0, maxChars);
  }
}
