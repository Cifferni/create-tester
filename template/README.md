# 测试项目

**AI 驱动页面测试项目**(由 [create-tester](https://www.npmjs.com/package/create-tester) 脚手架创建)。引擎代码就放在本工程的 `mcp/` 里,**完全自包含,不依赖 create-tester 包**。tester 不内置 AI,而是以 **MCP 工具服务器** 形式存在:AI harness(Codex / opencode / Claude 等)通过 MCP 读取用例、看页面、写 spec、跑测试、判失败。测试人员只管说人话、放用例。

## 工作方式

1. **测试人员**:把已有用例(Excel / XMind / Markdown / CSV / TXT)丢进 `test-cases/`,不需要写任何代码
2. **AI harness**:通过 MCP 调用 tester 的工具——
   - `list_cases` / `convert_case` 读懂用例
   - `snapshot` 打开页面看结构,定位元素
   - 在 `tests/<功能>/` 下写 `*.spec.ts`
   - `run_tests` 执行,`failures` 拿失败详情判断根因

## MCP 配置

MCP server 就是本工程 `mcp/server.cjs`,在 AI harness(Codex / opencode / Claude Code 等)的 MCP 配置里加一个 stdio server:

```json
{
  "mcpServers": {
    "tester": {
      "command": "node",
      "args": ["D:/my-test/mcp/server.cjs"],
      "cwd": "D:/my-test"
    }
  }
}
```

> `args` 里的路径换成你的工程根目录;`cwd` 指向工程根目录(工具按它读 `test-cases/`、`tests/`、`result/`)。也可以在工程根目录直接跑 `node mcp/server.cjs` 手动验证。

配好后,直接对 AI 说:"把 test-cases/登录.xlsx 转成测试用例跑一遍,失败的给我分析根因。"

## 命令行

```bash
npm run test         # 跑回归(playwright test,支持并行/重试/trace)
npm run mcp          # 启动工程内 MCP server(供 AI harness 连接)
node mcp/server.cjs  # 同上,手动启动(想改工具行为就改 mcp/server.cjs)
```

## 结构

```
test-cases/         测试人员的既有用例(输入源,MCP convert_case 读取)
tests/<功能>/*.spec.ts  可执行用例,按功能模块组织(AI 生成 或 playwright codegen 录制)
playwright.config.ts  Playwright 配置(被测地址/浏览器,一般用环境变量)
mcp/server.cjs       工程内 MCP server 代码(引擎已内联,可改;node mcp/server.cjs 启动)
mcp/api.cjs          接口断言 API(spec 里 import { apiRecorder } from '../mcp/api.cjs')
AGENTS.md            给 AI 的工作规范(必用 MCP 工具、禁止写裸脚本)
result/             所有输出:report/(HTML 报告)、test-results.json、output/(截图/trace)
```

## 配置(环境变量)

| 环境变量 | 说明 |
| --- | --- |
| `BASE_URL` | 被测页面地址(默认 `http://localhost:3000`) |
| `TESTER_BROWSER` | 浏览器:chromium / chrome / firefox / webkit |
