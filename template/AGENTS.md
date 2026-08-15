# 工作方式(务必遵守)

## 必用 MCP 工具,禁止另起炉灶

全部测试能力由 MCP server 提供(`node mcp/server.cjs`)。**禁止**:裸 Playwright 脚本、临时 spec/probe 脚本、抓取前端源码(`/src/**`)。

## 工具速查

| 工具 | 作用 |
| --- | --- |
| `list_cases` / `convert_case` | 读 `test-cases/` 用例(xlsx/xmind/csv/md/txt → 文本) |
| `snapshot` / `inspect` | 看页面结构 / 按选择器查 DOM(只读) |
| `set_base_url` | 改被测地址 |
| `login` / `login_status` | 验证码人工登录 / 确认登录态 |
| `list_specs` | 列 `tests/` spec |
| `run_tests` / `retry_failed` | 后台跑全部 / 只重跑失败的 |
| `status` / `failures` | 结果总览 / 失败详情(含 stdout/stderr) |
| `generate_spec` | 用例 → spec 骨架 |
| `verify_locators` | 跑前预检 spec 选择器(命中/未命中,避免空跑) |
| `env_reset` | 还原环境(跑会改数据的回归前调) |

## 流程

`convert_case` 读用例 → `snapshot`/`inspect` 看结构 → `generate_spec` 生成骨架、补选择器 → `run_tests` 后台 → `status`/`failures` 轮询 → 分析根因,改后用 `retry_failed` 单点验证。

## 零负担(测试人员只聊天,不碰文件)

- 被测地址:测试人员说 → 调 `set_base_url`。
- 登录:账号密码测试人员在对话里说,填进 `tests/_login.ts`;验证码用 `login`+`login_status`。
- **禁止要求测试人员改 `.env`/配置文件/建文件。**

## 测出 bug:每个用例必须有业务断言

- 点完必须验结果(接口 `expectApi` 的 code/字段/状态码,或页面 `toHaveURL`/`toHaveText`/`toHaveClass`),禁止"只点不验"。
- **断言依据 = test-cases/ 用例文档的"预期",不是页面现状**。页面和预期不符时,报告"页面与用例预期不符"(可能是 bug),**不要改断言去迁就页面**。
- 改数据类用例:造数据 + 自我清理;判断新增/删除用计数对比,别靠名字唯一。长流程用 `apiRecorder(page, { include: ['/api/xxx'] })` 只抓要断言的接口。

## 省时间 / 省 token

- 探查用 `snapshot`/`inspect`(大页面先 `scope` 精准看),禁止临时 spec。
- 改完 `retry_failed` 单点,不全量重跑;先探查确认再改,别靠反复跑试错。
- 环境:需要干净环境的用例**先构造**(`env_reset`/清理数据),构造不了才 `test.skip`+说明;构造时**只动测试数据、可还原、拿不准就 skip**,绝不瞎搞真实数据。
- 环境限制(持久化不保持等)不算 bug,`test.skip`+说明即可。
