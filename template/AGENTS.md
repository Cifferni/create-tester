# 工作方式(务必遵守)

## 两套 MCP server,按职责分工

页面操作看页面/元素一律用**官方 playwright MCP**(`browser_*`),跑测试/管用例用**tester MCP**。**禁止**:裸 Playwright 脚本、临时 spec/probe 脚本、抓取前端源码(`/src/**`)。

- 看页面结构/定位元素:`browser_snapshot` / `browser_find`(官方,支持 iframe/shadowDom/遮挡)
- 点击/输入/导航/断言:官方 `browser_click` / `browser_type` / `browser_navigate` / `browser_expect` 等

## 工具速查

### tester MCP(测试工程工具)

| 工具 | 作用 |
| --- | --- |
| `tester_list_cases` / `tester_convert_case` | 读 `test-cases/` 用例(xlsx/xmind/csv/md/txt → 文本) |
| `tester_set_base_url` | 改被测地址(写 playwright.config.ts) |
| `tester_login` / `tester_login_status` | 验证码人工登录 / 确认登录态 |
| `tester_list_specs` | 列 `tests/` spec |
| `tester_run_tests` / `tester_retry_failed` | 后台跑全部 / 只重跑失败的;都支持 `grep` 按标签/标题筛选(如 {grep: '@smoke'}) |
| `tester_status` / `tester_failures` | 结果总览 / 失败详情(含 stdout/stderr) |
| `tester_generate_spec` | 用例 → spec 骨架 |
| `tester_env_reset` | 还原环境(跑会改数据的回归前调) |

### 官方 playwright MCP(browser_* 页面操作)

`browser_snapshot`(看结构)、`browser_find`(搜文本定位)、`browser_click`/`browser_type`/`browser_navigate`/`browser_expect`(操作与断言)、`browser_network_requests`(抓接口)。

## 流程

`tester_convert_case` 读用例 → `browser_snapshot`/`browser_find` 看结构 → `tester_generate_spec` 生成骨架、补选择器 → `tester_run_tests` 后台 → `tester_status`/`tester_failures` 轮询 → 分析根因,改后用 `tester_retry_failed` 单点验证。

## 零负担(测试人员只聊天,不碰文件)

- 被测地址:测试人员说 → 调 `tester_set_base_url`。
- 登录:账号密码测试人员在对话里说,填进 `tests/_login.ts`;验证码用 `tester_login`+`tester_login_status`。
- 多账号隔离:要跑第二个账号,在 `_login.ts` 的 `TEST_ACCOUNTS` 加一个账号,并跑 `TESTER_ACCOUNT=<key> npm run test`(各账号登录态独立文件,互不覆盖)。
- **禁止要求测试人员改 `.env`/配置文件/建文件。**

## 插件(可选,维护者加)

工程根目录放 `plugin/*.cjs`,可扩展三类:用例解析器(`parseCase(file)`) / 报告器(`onSummary(summary)`,每轮结束触发) / 录制器(`init()`)。单个插件坏不影响整体,不需要插件就不用建这个目录。

## 测出 bug:每个用例必须有业务断言

- 点完必须验结果(接口 `expectApi` 的 code/字段/状态码,或页面 `toHaveURL`/`toHaveText`/`toHaveClass`),禁止"只点不验"。
- 接口字段断言支持:`equals`/`notEquals`/`contains`(子串)/`containsValue`(数组含元素)/`notEmpty`/`isEmpty`/`matches`(正则)/`notMatches`/`between`(区间),按数据形态选用,别只会 equals。
- **断言依据 = test-cases/ 用例文档的"预期",不是页面现状**。页面和预期不符时,报告"页面与用例预期不符"(可能是 bug),**不要改断言去迁就页面**。
- 改数据类用例:造数据 + 自我清理;判断新增/删除用计数对比,别靠名字唯一。长流程用 `apiRecorder(page, { include: ['/api/xxx'] })` 只抓要断言的接口。
- 数据驱动(多组参数):把参数放同目录 `data.csv`(第一行表头,如 `用户名,密码,期望`),spec 顶层用 `readDataRows` 读 + `for...of` 循环生成多条用例,别在单个 test 里硬编码参数。
- 定位不稳(文案/结构常变):给 `selfHeal(page, ['testid', '可见文本', 'css'])` 传多个候选,自动选第一个命中的;别死磕单一选择器。
- 接口 mock/篡改:造数据、模拟异常响应用 `mockRoute(page, '**/api/x', { body })` / `tamperResponse(page, '**/api/x', handler)`;**真回归要验证真实后端时不用 mock**(页面+接口都对不上会是假绿)。

## 定位器优先级(强制,从上到下)

1. `getByTestId`(`data-testid`)——元素上有 testid 必须用它
2. `getByRole` + 可访问名(`button { name: '保存' }`)——语义定位,改文案可能失效,慎用 name
3. CSS/class(`locator`)——`[data-*]` 属性、class 等
4. `getByText`——仅当上面都不存在、且该文本页面唯一时才用

禁止用文本定位唯一性不足的元素;改文案导致大面积失效 = 用例没写好。

## 等待:等状态,禁止 waitForTimeout

- **禁止 `page.waitForTimeout()`(硬编码延时)**。元素/文案/URL 就绪前 Playwright 会自动等待;确实要等时用智能等待(等状态不等时间):
  - `waitForVisible(locator)` — 等元素可见
  - `waitForClickable(locator)` — 等元素可点击(按钮灰着/loading 结束)
  - `waitForText(page, '文案')` — 等文本出现
  - `waitForURL(page, /regex/)` — 等跳转
- 硬编码延时在慢机器/网络抖动下必崩、快机器上白等,一律不写。

## 省时间 / 省 token

- 探查用 `browser_snapshot`/`browser_find`(大页面先对容器 `target` 精准看),禁止临时 spec。
- 改完 `tester_retry_failed` 单点,不全量重跑;先探查确认再改,别靠反复跑试错。
- 选择性执行:给用例加 tag(如 `test('标题', { tag: ['@smoke'] }, ...)`),要只跑某组时 `tester_run_tests {grep: '@smoke'}` 或 `npm run test -- --grep @smoke`。
- 环境:需要干净环境的用例**先构造**(`tester_env_reset`/清理数据),构造不了才 `test.skip`+说明;构造时**只动测试数据、可还原、拿不准就 skip**,绝不瞎搞真实数据。
- 环境限制(持久化不保持等)不算 bug,`test.skip`+说明即可。
