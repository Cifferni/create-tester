# 本工程的工作方式(务必遵守)

## 必用 MCP 工具,禁止另起炉灶

本工程的全部测试能力由 MCP server 提供(启动:`node mcp/server.cjs`,代码在本工程 `mcp/server.cjs`)。AI 必须通过 MCP 工具工作,**禁止**:

- 编写/执行裸 Playwright 脚本(`require('playwright')` / `chromium.launch(...)` / `page.goto(...)`)
- 编写临时脚本(probe / client)去调 MCP
- 抓取/下载前端源码(Vite 源码,如 `localhost:5173` 下的 `/src/**`)

## 工具速查

| 工具 | 作用 |
| --- | --- |
| `list_cases` | 列出 `test-cases/` 下的用例文件 |
| `convert_case` | 用例文件(xlsx/xmind/csv/md/txt)→ 结构化文本 |
| `snapshot` | 打开被测页面,返回可交互结构(定位元素用;纯图标按钮会补充 class/title 提示) |
| `inspect` | 只读探查页面 DOM:按 CSS 选择器返回 outerHTML/属性/文本(不改数据) |
| `list_specs` | 列出 `tests/` 下的 spec |
| `run_tests` | 后台跑 Playwright 测试,立即返回"运行中";跑完用 `status`/`failures` 轮询(不做同步等待);传 `{workers:N}` 可并行提速(需用例隔离) |
| `status` | 读报告返回通过/失败/跳过/耗时总览 |
| `failures` | 读报告返回全貌 {total,passed,skipped,failed} + 失败详情(含 stdout/stderr 日志) |
| `retry_failed` | 只重跑上次失败的 spec(改完用例后用它收敛,不全量重跑) |
| `generate_spec` | 根据 test-cases/ 用例生成 spec 骨架(含 apiRecorder 模板),再补选择器 |

## 流程

1. `convert_case` 读懂用例
2. `snapshot` 看页面结构(不碰源码、不写选择器)
3. `generate_spec` 生成骨架,补选择器到 `tests/*.spec.ts`
4. `run_tests` 后台启动
5. `status` / `failures` 轮询拿结果
6. 分析根因,改 spec 后用 `retry_failed` 只重跑失败的

## 登录(测试人员零负担)

- **测试人员只在对话里说"账号 xxx、密码 xxx"即可,禁止要求测试人员改 `.env`/配置文件/建文件。**
- 先 `snapshot` 看登录页结构,把账号密码和登录选择器填进 `tests/_login.ts`。
- 登录态由 `tests/auth.setup.ts` 在跑测试前自动登录一次并存到 `result/auth.json`,**整轮只登录一次**,所有用例复用(config 已接 storageState)。
- **验证码/短信(自动编排,只差人输一下)**:发现登录失败/出现验证码时,`login` 工具后台打开浏览器 → 提示测试人员在弹窗里完成登录 → `login_status` 轮询到 `result/auth.json` 生成 → 自动重跑。不需要测试人员输命令,只需在弹窗里输验证码。
- `ensureLoggedIn(page)` 做兜底:会话中途被踢回登录页时自动重登;发现未登录不要当成 bug 报。

## 业务断言(测出 bug 的关键,务必遵守)

- **每个用例必须有业务结果断言,禁止"只点不验"。** 点完按钮 → 断言接口 `expectApi`(code/字段/状态码)或页面结果(`toHaveURL`/`toHaveText`/`toHaveClass`/`toBeVisible` 等)。
- **接口断言最硬**:页面操作触发的接口用 `expectApi(api, '/api/xxx').code('0')` / `.field('data.token').notEmpty()` / `.status(200)`。
- **改数据类用例**:造数据 + 用后清理;判断新增/删除用计数对比(namesBefore/namesAfter),不要靠名字唯一。
- 断言找不到接口会等最多 15 秒;状态码 ≥400 默认直接失败。

## 性能与纪律(务必遵守,否则一次任务跑 30 分钟)

- **探查一律用 `snapshot` / `inspect`,禁止写临时 spec / probe 脚本。** 一次调用尽量覆盖多个问题(传多个选择器、`inspect` 批量)。
- **纯图标按钮**:看 `snapshot` 补充区(有 `class`/`svg` path 特征)或用 `inspect` 拿 outerHTML 里的 `<svg><path d=...>`。
- **改完 spec 用 `retry_failed` 单点验证,不要全量重跑。** 全量只留到最后确认一次。
- **先探查、再改**:定位/断言失败时,先用 `snapshot`/`inspect` 确认页面真实结构,不要靠反复全量跑试错。
- **环境限制 vs 真 bug**:若失败是环境所致(如持久化依赖外部存储、刷新不保持),先在报告里注明原因并 `test.skip`,不要反复改。
- **环境数据敏感**:用例尽量"造数据 + 自我清理";判断"新增/删除"用计数对比(namesBefore/namesAfter),不要靠名字唯一。`run_tests` 传 `{workers:N}` 提速前,先确认用例彼此隔离。
