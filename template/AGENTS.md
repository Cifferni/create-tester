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
| `snapshot` | 打开被测页面,返回可交互结构(定位元素用,替代一切手写选择器) |
| `list_specs` | 列出 `tests/` 下的 spec |
| `run_tests` | 后台跑 Playwright 测试,立即返回"运行中";跑完用 `failures` 轮询 |
| `failures` | 读报告返回失败详情;报告未生成 = 还在跑,稍后轮询 |

## 流程

1. `convert_case` 读懂用例
2. `snapshot` 看页面结构(不碰源码、不写选择器)
3. 写 `tests/*.spec.ts`
4. `run_tests` 后台启动
5. `failures` 轮询拿失败
6. 分析根因,必要时改 spec 重跑
