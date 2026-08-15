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
| `run_tests` | 后台跑 Playwright 测试,立即返回"运行中";跑完用 `status`/`failures` 轮询(不做同步等待) |
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
