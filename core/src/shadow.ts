// Shadow DOM 适配:中后台组件库(如封装的自定义元素)常把内部结构放进 open shadowRoot,
// 普通 CSS/文本定位器看不到内部。这里提供"递归穿透 shadowRoot"的定位辅助:
//   findInShadow / clickInShadow / fillInShadow / hasTextInShadow
// 用 page.evaluate 在页面里递归遍历 shadowRoot,找到匹配元素后返回句柄,再由 Playwright 操作。
// 注意:只能穿透 open shadowRoot(closed shadowRoot 无法从外部访问,需被测应用开放)。

import { type Page, type ElementHandle } from '@playwright/test';

// 判断候选是否 CSS 形态(含 . # [ )——穿透查找时按 CSS 匹配,否则按文本匹配
function looksLikeCss(c: string): boolean {
  return /[#.\[\]]/.test(c) && !/[^\w\u4e00-\u9fa5-#.\[\]()>+~ :*="']/.test(c);
}

// 递归遍历 open shadowRoot,找匹配的文本或 CSS 选择器,返回首个元素(页面上下文里执行)。
function findInShadowJs(): (target: string) => Element | null {
  // 该函数会被 page.evaluate 序列化执行,不能引用外部闭包变量
  return function (target: string): Element | null {
    const isCss = /[#.\[\]]/.test(target) && !/[^\w\u4e00-\u9fa5-#.\[\]()>+~ :*="']/.test(target);
    const walk = (root: Document | ShadowRoot | Element, depth: number): Element | null => {
      if (depth > 40) return null;
      // 文本匹配:在 shadow 内部用 TreeWalker 找"含目标文本的元素"
      if (!isCss) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          const text = (node.textContent || '').trim();
          if (text === target || text.includes(target)) {
            const parent = node.parentElement;
            if (parent) return parent;
          }
        }
      }
      const elements = (root as ShadowRoot | Document).querySelectorAll
        ? Array.from((root as ShadowRoot | Document).querySelectorAll('*'))
        : Array.from(root.querySelectorAll('*'));
      for (const el of elements) {
        if (isCss) {
          try {
            if (el.matches(target)) return el;
          } catch {
            // 非法选择器忽略
          }
        }
        if (el.shadowRoot) {
          const hit = walk(el.shadowRoot, depth + 1);
          if (hit) return hit;
        }
      }
      return null;
    };
    return walk(document, 0);
  };
}

// 在页面(含 open shadowRoot)中查找首个匹配候选的元素,返回句柄;找不到返回 null
export async function findInShadow(page: Page, target: string, opts: { timeout?: number } = {}): Promise<ElementHandle<Element> | null> {
  const deadline = Date.now() + (opts.timeout ?? 5000);
  // 反复查找:元素可能是异步渲染出来的(等 shadow 内容出现)
  while (Date.now() < deadline) {
    const handle = await page.evaluateHandle(findInShadowJs(), target).catch(() => null);
    const el = handle ? (handle as ElementHandle<Element>).asElement() : null;
    if (el) return el;
    if (handle) await handle.dispose().catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

// 点击 shadow DOM 内的元素(按文本或 CSS 找),找不到抛错
export async function clickInShadow(page: Page, target: string, opts: { timeout?: number } = {}): Promise<void> {
  const el = await findInShadow(page, target, opts);
  if (!el) throw new Error(`Shadow DOM 内未找到元素:${target}(可确认组件是否用 open shadowRoot,或用 browser_snapshot 看结构)`);
  await el.click();
}

// 向 shadow DOM 内的输入框填值(按文本标签或 CSS 找元素,再在元素内/后代找 input)
export async function fillInShadow(page: Page, target: string, value: string, opts: { timeout?: number } = {}): Promise<void> {
  const el = await findInShadow(page, target, opts);
  if (!el) throw new Error(`Shadow DOM 内未找到元素:${target}`);
  // 元素本身是 input/textarea 直接用;否则在元素后代找输入框(shadow 内 input 也用递归穿透)
  const tag = await el.evaluate((n) => n.tagName.toLowerCase()).catch(() => '');
  if (tag === 'input' || tag === 'textarea') {
    await el.fill(value);
    return;
  }
  const inner = await page.evaluateHandle(
    (root) => {
      const queue: (Node | ShadowRoot)[] = [root];
      while (queue.length) {
        const node = queue.shift()!;
        const children = (node as Element).children || (node as ShadowRoot).children;
        for (const child of Array.from(children as HTMLCollection)) {
          const tag = child.tagName.toLowerCase();
          if (tag === 'input' || tag === 'textarea' || child.getAttribute('contenteditable') === 'true') {
            return child;
          }
          queue.push(child);
          if (child.shadowRoot) queue.push(child.shadowRoot);
        }
      }
      return null;
    },
    el
  );
  const inputEl = inner.asElement();
  if (!inputEl) {
    await inner.dispose().catch(() => {});
    throw new Error(`Shadow DOM 元素 ${target} 内未找到可输入控件`);
  }
  await inputEl.fill(value);
  await inner.dispose().catch(() => {});
}

// 判断某文本是否出现在页面(含 open shadowRoot)里
export async function hasTextInShadow(page: Page, text: string, opts: { timeout?: number } = {}): Promise<boolean> {
  return (await findInShadow(page, text, opts)) !== null;
}

// 便捷封装:同 selfHeal 一样按候选列表找第一个命中的 shadow 元素(供 DSL/AI 兜底使用)
export async function selfHealShadow(page: Page, candidates: string[]): Promise<ElementHandle<Element> | null> {
  for (const c of candidates) {
    const el = await findInShadow(page, c, { timeout: 2000 });
    if (el) return el;
  }
  return null;
}
