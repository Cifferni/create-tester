// 登录 setup:跑测试前登录一次,把登录态存到 test-result/auth-<account>.json,所有用例复用(Playwright 官方 storageState 模式)
// 多账号隔离:TESTER_ACCOUNT 环境变量选账号(缺省 default),各账号登录态存独立文件,互不覆盖。
// 无验证码:自动登录,整轮只登一次
// 有验证码/短信:自动登录失败时,先跑 `npm run login`,之后自动复用
import { test as setup } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { ensureLoggedIn, currentAccount, authFileName } from './_login';

const AUTH_FILE = path.join(process.cwd(), authFileName());

setup(`登录并保存登录态(账号:${currentAccount()})`, async ({ page }) => {
  // 已有登录态:先验证是否还有效(访问首页没被弹回登录页就算有效)
  if (fs.existsSync(AUTH_FILE)) {
    await page.goto('/');
    if (!page.url().includes('/login')) return; // 有效,直接复用
  }
  // 没有或已失效:重新登录(若需验证码/短信会自动失败,提示先跑 npm run login)
  await ensureLoggedIn(page);
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  await page.context().storageState({ path: AUTH_FILE });
});
