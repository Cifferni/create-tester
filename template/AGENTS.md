# 工作方式(务必遵守)

## 核心纪律(硬性,先过一遍)

1. 页面操作用**官方 playwright MCP**(`browser_*`),跑测试/管用例用**tester MCP**。禁止裸 Playwright 脚本、临时 spec、抓前端源码(`/src/**`)。
2. 每个用例**必须有业务断言**,禁止只点不验;断言依据=用例文档"预期",不是页面现状(不符就报告,不改断言迁就)。
3. **禁止 `waitForTimeout`/终端 sleep**:要等就用 `waitForVisible/Clickable/Text/URL`(等状态不等时间);等测试结果用 `tester_wait_result`(server 端轮询,不弹终端)。
4. 定位优先级:`getByTestId` > `getByRole+name` > CSS/class > `getByText`(仅兜底且唯一)。
5. 快照 ref 过期即失效:操作报 "Ref not found" 一律**先重新 `browser_snapshot`**,再基于新 ref 操作,别拿旧 ref 硬试。
6. 禁止 `browser_run_code_unsafe` 手写复杂 CSS(如 `svg path[d^=...]` 脆选择器):定位用 `browser_snapshot`/`browser_find` 拿 ref 或可访问名。

## 工具(两套 MCP)

**tester**(测试工程,前缀 `tester_`):
`tester_convert_case`(用例→文本)、`tester_generate_spec`(用例→骨架)、`tester_run_tests`(跑测,支持 grep/语法预检)、`tester_wait_result`(等结果,一次调用)、`tester_status`/`tester_failures`(总览/失败详情含错误分类)、`tester_retry_failed`(重跑失败)、`tester_list_cases`/`tester_list_specs`(列文件)、`tester_set_base_url`(改地址)、`tester_login`/`tester_login_status`(人工登录)、`tester_env_reset`(还原环境)。

**playwright**(官方,页面操作):
`browser_snapshot`(看结构)、`browser_find`(搜文本)、`browser_click`/`browser_type`/`browser_navigate`/`browser_expect`(操作断言)、`browser_network_requests`(抓接口)、`browser_route`(mock)。

## 流程

`tester_convert_case` 读用例 → `browser_snapshot`/`browser_find` 看结构 → `tester_generate_spec` 生成骨架 → `tester_run_tests` 后台 → `tester_wait_result` 等结果(先看错误分类定位根因)→ `tester_retry_failed` 单点验证。

## 测试人员零负担

被测地址/登录态由 `tester_set_base_url`/`tester_login` 处理,账号密码填 `tests/_login.ts`(多账号 `TESTER_ACCOUNT` 切换);**禁止让测试人员改 `.env`/配置/建文件**。

## 写用例要点

- 接口断言 `expectApi`(code/字段/状态码),页面断言 `toHaveURL`/`toHaveText`/`toHaveClass`;字段断言按形态选 equals/contains/containsValue/notEmpty/matches/between。
- 数据驱动:`data.csv` 表头 + `readDataRows` 顶层 `for...of`,别硬编码。
- 定位不稳:`selfHeal(page, ['testid','文本','css'])` 多候选。
- 接口 mock:`mockRoute`/`tamperResponse`;真回归验证真实后端不用 mock(否则假绿)。
- 改数据用例:造数据+自清理,判断增删用计数对比,别靠名字唯一。

## 省时间 / 省 token

- 探查用 `browser_snapshot`/`browser_find`(大页面先对容器 target 精准看),禁止临时 spec。
- 改完 `tester_retry_failed` 单点;先探查再改,别反复跑试错。
- 选择性执行:`tag` + `tester_run_tests {grep:'@smoke'}` 或 `npm run test -- --grep @smoke`。
- 环境:先构造(`tester_env_reset`/清理),构造不了才 `test.skip`+说明;环境限制不算 bug,skip 即可。
- 看结果可选 `tester view`(只读 Web 面板)。

## 插件(可选)

`plugin/*.cjs` 可扩展:用例解析器(`parseCase`)、报告器(`onSummary`)、录制器(`init`);单插件坏不影响整体,不需要就不建。
