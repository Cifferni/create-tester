# 工作方式(务必遵守)

## 核心纪律(每次开工先过一遍)

1. 页面操作一律用**官方 playwright MCP**(`browser_*`),跑测试/管用例用**tester MCP**。**禁止**:裸 Playwright 脚本、临时 spec/probe 脚本、抓取前端源码(`/src/**`)。
2. 每个用例**必须有业务断言**,禁止"只点不验";断言依据 = 用例文档的"预期",不是页面现状(不符就报告,不改断言迁就)。
3. **禁止 `page.waitForTimeout()`**(硬编码延时),要等就用 `waitForVisible/Clickable/Text/URL`,等状态不等时间。
4. 定位器优先级(强制):`getByTestId` > `getByRole+name` > CSS/class > `getByText`(仅兜底且必须唯一)。
5. **快照 ref 不过期复用**:browser_snapshot 拿到的 target(ref)只在当前页面状态有效;每次页面变化后旧 ref 失效。操作报 "Ref not found" 时,**一律先重新 browser_snapshot 拿新快照**,再基于新 ref 操作,绝不拿旧快照的 ref 硬试。
6. **禁止 browser_run_code_unsafe 手写复杂 CSS**:定位元素用 browser_snapshot/browser_find 拿官方 ref 或可访问名,别手写 `button:has(svg path[d^=...])` 这类脆选择器(图标一变就失效);确实要手写时先重新快照看真实结构。

## 工具速查

### tester MCP(测试工程工具,统一 `tester_` 前缀)

| 工具 | 作用 |
| --- | --- |
| `tester_list_cases` / `tester_convert_case` | 读 `test-cases/` 用例(xlsx/xmind/csv/md/txt → 文本;支持 plugin/ 自定义解析器) |
| `tester_set_base_url` | 改被测地址(写 playwright.config.ts) |
| `tester_login` / `tester_login_status` | 验证码人工登录 / 确认登录态(多账号用 TESTER_ACCOUNT) |
| `tester_list_specs` | 列 `tests/` spec |
| `tester_run_tests` / `tester_retry_failed` | 后台跑全部 / 只重跑失败的;支持 `grep` 按标签/标题筛选;跑前 esbuild 语法预检 |
| `tester_status` / `tester_failures` / `tester_wait_result` | 结果总览 / 失败详情(含**错误分类**定位/断言/网络/超时/脚本/其他 + stdout/stderr)/ 一次调用等结果(server 端轮询) |
| `tester_generate_spec` | 用例 → spec 骨架(含 apiRecorder + 业务断言模板) |
| `tester_env_reset` | 还原环境(跑会改数据的回归前调) |

### 官方 playwright MCP(browser_* 页面操作)

`browser_snapshot`(看结构)、`browser_find`(搜文本定位)、`browser_click`/`browser_type`/`browser_navigate`/`browser_expect`(操作与断言)、`browser_network_requests`(抓接口)、`browser_route`(mock 请求)。

## 流程

`tester_convert_case` 读用例 → `browser_snapshot`/`browser_find` 看结构 → `tester_generate_spec` 生成骨架、补选择器 → `tester_run_tests` 后台 → **`tester_wait_result` 一次等结果**(或 `tester_status`/`tester_failures` 轮询,先看错误分类再定位根因)→ 改后用 `tester_retry_failed` 单点验证。

> **禁止用终端 sleep/Start-Sleep 等待测试结果**——等结果一律用 `tester_wait_result`(server 端内部轮询,不弹终端)。

## 零负担(测试人员只聊天,不碰文件)

- 被测地址:测试人员说 → 调 `tester_set_base_url`。
- 登录:账号密码测试人员在对话里说,填进 `tests/_login.ts`;验证码用 `tester_login`+`tester_login_status`。
- 多账号隔离:在 `_login.ts` 的 `TEST_ACCOUNTS` 加账号,跑 `TESTER_ACCOUNT=<key> npm run test`(各账号登录态独立文件)。
- **禁止要求测试人员改 `.env`/配置文件/建文件。**

## 写用例(断言纪律 + 能力清单)

- 每个用例必须有业务断言(接口 `expectApi` 的 code/字段/状态码,或页面 `toHaveURL`/`toHaveText`/`toHaveClass`);字段断言按数据形态选:`equals`/`notEquals`/`contains`(子串)/`containsValue`(数组)/`notEmpty`/`matches`(正则)/`between`(区间),别只会 equals。
- **断言依据 = 用例文档"预期",不是页面现状**;页面不符时报告(可能是 bug),不改断言迁就。
- 改数据类用例:造数据 + 自我清理;判断增删用计数对比,别靠名字唯一。长流程用 `apiRecorder(page, { include: ['/api/xxx'] })` 只抓要断言的接口。
- 数据驱动:参数放同目录 `data.csv`(表头如 `用户名,密码,期望`),spec 顶层 `readDataRows` + `for...of` 生成多条用例,别在单个 test 硬编码。
- 定位不稳:给 `selfHeal(page, ['testid', '可见文本', 'css'])` 多候选,自动选命中者。
- 接口 mock/篡改:造数据/模拟异常用 `mockRoute(page, '/api/x', { body })` / `tamperResponse(page, '/api/x', handler)`;**真回归验证真实后端时不用 mock**(否则假绿)。

## 等待:等状态,禁止 waitForTimeout

元素/文案/URL 就绪前 Playwright 会自动等,一般不用写等待。确实要等时:
- `waitForVisible(locator)` — 元素可见
- `waitForClickable(locator)` — 可点击(按钮灰着/loading 结束)
- `waitForText(page, '文案')` — 文本出现
- `waitForURL(page, /regex/)` — 跳转

硬编码延时在慢机器/网络抖动下必崩、快机器上白等,一律不写。

## 省时间 / 省 token

- 探查用 `browser_snapshot`/`browser_find`(大页面先对容器 `target` 精准看),禁止临时 spec。
- 改完 `tester_retry_failed` 单点,不全量重跑;先探查确认再改,别靠反复跑试错。
- 选择性执行:用例加 tag(如 `test('标题', { tag: ['@smoke'] }, ...)`),只跑某组时 `tester_run_tests {grep: '@smoke'}` 或 `npm run test -- --grep @smoke`。
- 环境:需要干净环境的用例**先构造**(`tester_env_reset`/清理数据),构造不了才 `test.skip`+说明;只动测试数据、可还原、拿不准就 skip。
- 环境限制(持久化不保持等)不算 bug,`test.skip`+说明即可。
- 看结果可选 `tester view`(只读 Web 面板,浏览器打开自动刷新)。

## 插件(可选,维护者加)

工程根目录放 `plugin/*.cjs`,可扩展三类:用例解析器(`parseCase(file)`) / 报告器(`onSummary(summary)`) / 录制器(`init()`)。单个插件坏不影响整体;不需要插件就不建目录。
