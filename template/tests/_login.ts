// 登录 helper:测试人员只需在对话里告诉 AI 账号密码,AI 负责填到对应环境的 .env.<环境> 文件并调整选择器。
// 测试人员不需要改这个文件。
import { type Page } from '@playwright/test';
import { testerConfig } from '../tester.config';
import { loadEnvFile } from '../scripts/_env.cjs';
import path from 'path';

// 当前环境名:TESTER_ENV 显式指定,否则用 tester.config.ts 的 defaultEnv(与 playwright.config.ts 解析一致)
export function currentEnv(): string {
  return process.env.TESTER_ENV || testerConfig.defaultEnv || 'test';
}

// 加载当前环境的 .env.<环境名> 文件(账号密码等敏感信息都放那,gitignore 不进仓库)
// 已在 playwright.config.ts 加载过,这里双保险(独立跑 spec 时也生效)
loadEnvFile(path.join(process.cwd(), `.env.${currentEnv()}`));

// 当前账号:由 TESTER_ACCOUNT 环境变量选择,缺省 default。用于 storageState 文件命名,避免多账号互相覆盖。
export function currentAccount(): string {
  return process.env.TESTER_ACCOUNT || 'default';
}

// 当前账号的账号/密码:从当前环境的 .env 读。
// 缺省账号(default)用 TESTER_USER / TESTER_PASSWORD;
// 其他账号用 TESTER_USER_<账号大写> / TESTER_PASSWORD_<账号大写>(如 admin -> TESTER_USER_ADMIN)。
export function currentCredentials(): { user: string; password: string } {
  const account = currentAccount();
  const suffix = account === 'default' ? '' : `_${account.toUpperCase()}`;
  const user = process.env[`TESTER_USER${suffix}`];
  const password = process.env[`TESTER_PASSWORD${suffix}`];
  if (!user && !password) {
    console.warn(`[login] 未在 .env.${currentEnv()} 里配账号 "${account}" 的密码:需要 TESTER_USER${suffix} / TESTER_PASSWORD${suffix}`);
  }
  return { user: user || '', password: password || '' };
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
