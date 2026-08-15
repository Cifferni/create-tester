// 登录 helper:测试人员只需在对话里告诉 AI 账号密码,AI 负责填到下面并调整选择器。
// 测试人员不需要改这个文件。
import { type Page } from '@playwright/test';

// ── 测试账号(AI 按测试人员对话内容填写) ──
export const TEST_USER = 'test01';
export const TEST_PASSWORD = '123456';

// ── 登录流程(AI 用 snapshot 看登录页结构后,把下面的选择器/跳转路径调整成实际值) ──
const LOGIN_URL = '/login';
const AFTER_LOGIN = '/home';

// 每个用例开头调用:已登录就秒过,发现未登录自动重登
export async function ensureLoggedIn(page: Page): Promise<void> {
  await page.goto('/');
  if (new URL(page.url()).pathname.includes(LOGIN_URL)) {
    await page.getByTestId('username').fill(TEST_USER);
    await page.getByTestId('password').fill(TEST_PASSWORD);
    await page.getByTestId('login-submit').click();
    await page.waitForURL((u) => u.pathname.includes(AFTER_LOGIN));
  }
}
