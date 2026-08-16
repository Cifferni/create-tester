// 登录 helper:测试人员只需在对话里告诉 AI 账号密码,AI 负责填到下面并调整选择器。
// 测试人员不需要改这个文件。
import { type Page } from '@playwright/test';
import { testerConfig } from '../tester.config';

// ── 测试账号(AI 按测试人员对话内容填写;支持多账号,用 key 区分) ──
// 默认账号是 default;要隔离多账号,加新 key 并让用例通过 TESTER_ACCOUNT 环境变量切换。
export const TEST_ACCOUNTS: Record<string, { user: string; password: string }> = {
  default: { user: 'test01', password: '123456' },
  // admin: { user: 'admin01', password: 'admin@123' },   // 例:第二个账号
};

// 当前账号:由 TESTER_ACCOUNT 环境变量选择,缺省 default。用于 storageState 文件命名,避免多账号互相覆盖。
export function currentAccount(): string {
  const name = process.env.TESTER_ACCOUNT || 'default';
  return TEST_ACCOUNTS[name] ? name : 'default';
}

export function currentCredentials(): { user: string; password: string } {
  return TEST_ACCOUNTS[currentAccount()];
}

// 当前环境名:TESTER_ENV 显式指定,否则用 tester.config.ts 的 defaultEnv(与 playwright.config.ts 解析一致)
export function currentEnv(): string {
  return process.env.TESTER_ENV || testerConfig.defaultEnv || 'test';
}

// 当前环境的登录态文件名(test-result/auth-<env>-<account>.json),环境/账号互不覆盖:
// 不同环境的登录态不能混用(测一半切环境会把另一套登录态当自己人的),所以文件名带上环境名。
export function authFileName(): string {
  return `test-result/auth-${currentEnv()}-${currentAccount()}.json`;
}

// ── 登录流程(AI 用 browser_snapshot 看登录页结构后,把下面的选择器/跳转路径调整成实际值) ──
const LOGIN_URL = '/login';
const AFTER_LOGIN = '/home';

// 每个用例开头调用:已登录就秒过,发现未登录自动重登
export async function ensureLoggedIn(page: Page): Promise<void> {
  const { user, password } = currentCredentials();
  await page.goto('/');
  if (new URL(page.url()).pathname.includes(LOGIN_URL)) {
    await page.getByTestId('username').fill(user);
    await page.getByTestId('password').fill(password);
    await page.getByTestId('login-submit').click();
    await page.waitForURL((u) => u.pathname.includes(AFTER_LOGIN));
  }
}
