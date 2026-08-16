// 全局防护(异常兜底):登录失效检测 / 弹窗拦截 / 遮罩处理,降低 Flaky。
// 骨架生成时在 test 内注入 installPageGuard(page),测试人员无需手写这些兜底。
//   1. 弹窗拦截:page.on('dialog') 自动 accept(弹窗不再卡死/误断用例);
//   2. 遮罩处理:点击前可等待 loading 遮罩消失(waitMaskGone);
//   3. 登录失效检测:isLoggedOut 判断当前是否被踢回登录页(URL 含 login / 出现登录按钮),
//     配合 ensureLoggedIn(工程 _login.ts)自动重登。
// 所有防护都是"代码层确定性逻辑",不交由 LLM 决策。

import { type Page, type Locator } from '@playwright/test';

export interface PageGuardOptions {
  /** 登录页 URL 关键字(命中即认为已登出),缺省 login */
  loginUrlKeyword?: string;
  /** 登录按钮/表单的定位候选(出现即认为在登录页),缺省给常用文案 */
  loginButtonCandidates?: string[];
  /** 点击前等待的遮罩选择器列表,缺省覆盖主流中后台 loading 遮罩 */
  maskSelectors?: string[];
}

const DEFAULT_LOGIN_CANDIDATES = ['登录', '登 录', '登录/注册', '用户名', '手机号', '账号密码'];
const DEFAULT_MASK_SELECTORS = [
  '.el-loading-mask',
  '.el-overlay',
  '.ant-spin-spinning',
  '.ant-modal-mask',
  '.loading-mask',
  '.n-loading-mask',
  '.ant-modal-wrap'
];

// 注入页面防护:自动 accept 弹窗 + 返回清理函数。测试人员无脑调用一次即可。
export function installPageGuard(page: Page, opts: PageGuardOptions = {}): () => void {
  const handler = (dialog: { type(): string; accept(): Promise<void>; dismiss(): Promise<void> }): void => {
    void dialog.accept();
  };
  page.on('dialog', handler);
  return () => {
    page.off('dialog', handler);
  };
}

// 判断当前是否已登出(被踢回登录页):URL 含 login,或页面出现登录相关元素。
export async function isLoggedOut(page: Page, opts: PageGuardOptions = {}): Promise<boolean> {
  const keyword = opts.loginUrlKeyword || 'login';
  if (page.url().toLowerCase().includes(keyword.toLowerCase())) return true;
  const candidates = opts.loginButtonCandidates || DEFAULT_LOGIN_CANDIDATES;
  for (const c of candidates) {
    const looksCss = /[#.\[\]]/.test(c);
    const loc: Locator = looksCss ? page.locator(c) : page.getByText(c, { exact: false }).first();
    try {
      if ((await loc.count()) > 0) return true;
    } catch {
      // 忽略定位异常
    }
  }
  return false;
}

// 等待遮罩消失(如 loading 遮罩挡住点击)。等的是"状态消失",不是固定时长。
export async function waitMaskGone(page: Page, opts: PageGuardOptions = {}, timeout = 15000): Promise<void> {
  const selectors = opts.maskSelectors || DEFAULT_MASK_SELECTORS;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    let anyVisible = false;
    for (const sel of selectors) {
      try {
        const n = await page.locator(sel).count();
        if (n > 0) {
          anyVisible = true;
          break;
        }
      } catch {
        // 忽略
      }
    }
    if (!anyVisible) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  // 超时:遮罩仍在,不抛错(可能只是页面自带常驻遮罩,交给用例自身逻辑),返回即可
}

// 防护 + 断言原子操作:先等遮罩消失再执行 click/fill,降低"遮罩挡住元素"导致的 Flaky。
export async function shieldedClick(page: Page, locator: Locator, opts: PageGuardOptions = {}): Promise<void> {
  await waitMaskGone(page, opts);
  await locator.click();
}

export async function shieldedFill(page: Page, locator: Locator, value: string, opts: PageGuardOptions = {}): Promise<void> {
  await waitMaskGone(page, opts);
  await locator.fill(value);
}
