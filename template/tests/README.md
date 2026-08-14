# tests/ — 可执行用例(Playwright spec)

- 这里的 `*.spec.ts` 由 **AI harness 通过 MCP 生成**(或 **`npx playwright codegen`** 录制)
- 测试人员**不需要手写元素选择器**:说人话让 AI 生成,或点一遍让 codegen 录制
- **按功能模块组织**:`tests/login/`、`tests/order/`… 回归时 `npx playwright test tests/login/` 只跑该功能
- 执行:`npm run test`(即 `playwright test`)

## 定位策略(优先级从高到低)

| 优先级 | 方式 | 例子 |
| --- | --- | --- |
| 1 | `data-testid`(开发埋点,最稳定) | `page.getByTestId('login-submit')` |
| 2 | 语义定位(role / 文本 / label) | `page.getByRole('button', { name: '登录' })` |
| 3 | CSS / XPath(兜底) | `page.locator('#loginBtn')` |

## 接口自动断言(tester 的差异化能力)

页面操作触发的请求/响应会被自动捕获,用 URL 关键字直接断言,不用手写 `waitForResponse`:

```ts
import { test, expect } from '@playwright/test';
import { apiRecorder, expectApi } from 'tester-runtime';

test('登录后 /api/login 返回业务码 0', async ({ page }) => {
  const api = apiRecorder(page);
  await page.goto('/login');
  await page.getByTestId('username').fill('test01');
  await page.getByTestId('password').fill('123456');
  await page.getByTestId('login-submit').click();

  await expectApi(api, '/api/login').code('0');
  await expectApi(api, '/api/login').field('data.token').notEmpty();
  await expect(page.getByText('欢迎您')).toBeVisible();
});
```
