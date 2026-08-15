# 测试项目使用说明

这个项目帮你的页面做自动化测试。**常规场景你不需要写代码、不需要碰文件**——放用例、说需求,AI 自动完成;复杂场景(验证码/环境清理/特殊组件)可能需要少量代码,AI 会引导你。

## 〇、怎么打开 MCP(让 AI 能连上)

- **最省事**:用支持项目级 MCP 的 AI(Claude Code / Cursor / opencode 等)**直接打开本工程** → AI 自动连接 MCP,**你什么都不用做**。
- **如果 AI 说没连上 / 工具列表是空的**:
  1. 在工程根目录(命令窗口)跑一次 `npm run mcp`
  2. 它会启动 MCP 并在窗口里打印一行"连接配置"(一段 JSON)
  3. 把这段 JSON 按 AI 工具的说明贴给它(或让维护者处理)
- **怎么确认连上了**:AI 的工具体列表里能看到两套工具——`tester` 的测试工程工具(`run_tests` / `failures` / `status` / `convert_case` 等)和 `playwright` 的页面操作工具(`browser_snapshot` / `browser_click` 等)。
- 只跑回归(`npm run test`)不需要 MCP。

## 一、你只需要做三件事

### 1. 放用例
把已有的测试用例丢进 `test-cases/` 文件夹。支持:

- **Excel**(.xlsx / .xls)— 大批量用例管理
- **XMind**(.xmind)— 梳理测试点/场景
- **Markdown / CSV / TXT** — 文档、禅道/Jira 导出、自然语言步骤

**不用改任何格式**,原样放进去就行。

### 2. 对 AI 说需求
用支持本工程的 AI(Claude Code / Cursor / opencode 等)**打开这个工程,直接聊天即可**——AI 会自动连接本工程,你不需要启动任何东西。说一句人话,例如:

> "把 test-cases/登录.xlsx 转成测试用例跑一遍,失败的给我分析根因"
> "给订单功能写几个测试,断言接口 /api/order 返回 code=0"

AI 会自动:读用例 → 打开页面看结构 → 生成测试 → 跑测试 → 告诉你哪些过、哪些挂、为什么挂。

### 3. 需要登录就报一下账号
如果被测页面要登录,在对话里顺带说一句:

> "登录账号是 test01,密码是 123456"

**不需要你建 .env、改配置文件**,AI 会记住并自动登录,**整轮只登录一次**。
- 一般登录:全自动。
- 登录需要**验证码/短信**时:第一次跑一下 `npm run login`(会打开浏览器,你手动登录一次),之后自动复用,不用再输验证码。

## 二、怎么看结果 / 回归

- **失败原因**:AI 会直接告诉你"哪个用例挂了、为什么",不用自己看日志。
- **HTML 报告**:打开 `test-result/report/index.html`,有截图和操作记录,可直接当 bug 证据发给开发。
- **回归(不需要开 AI / MCP)**:直接跑 `npm run test`,就会把 `tests/` 里已经固化的用例全部跑一遍,报告照常生成。想重跑上次失败的:`npm run test -- --last-failed`。

## 三、常见问题

| 现象 | 怎么办 |
| --- | --- |
| 页面打不开 | 告诉 AI 被测地址(或让开发确认服务已启动、已连内网/VPN) |
| AI 说定位不到元素 | 让 AI 用官方页面探查工具(browser_snapshot / browser_find)重新看结构,别让它瞎猜 |
| 用例挂了但不知道是不是 bug | 让 AI 分析根因:是环境问题(比如刷新不保持、没登录)还是真 bug |
| 想重跑失败的用例 | 不开 AI 也行:`npm run test -- --last-failed`;或让 AI"把上次失败的重新跑一遍" |
| 被测地址变了 | 对话里告诉 AI 新地址即可 |

## 适合什么 / 不适合什么

**适合**
- 有现成用例(Excel/XMind/Markdown)想做**回归**:放进来,AI 批量转成可执行用例,跑完看结果
- 表单/登录/列表/流程类**功能测试**:选择器稳定、接口可断言,AI 自动化收益最大
- 测试人员**不想写代码、不想碰文件**:说需求,AI 代办
- 需要**无人值守回归**(CI/定时):`npm run test` 直接跑已固化的用例

**不适合(需要人工/其他工具)**
- 高度视觉化的断言(像素级 UI、Canvas/WebGL、图表精确比对):AI 的 DOM 快照看不到像素
- 需要真实设备(真机 App、特殊硬件):本工具只驱动桌面浏览器
- 强验证码/短信/外部人机验证:偶尔靠人工登录兜底,不适合全自动
- 选择器极不稳定、页面频繁改版:自愈只能缓解,根治靠开发加 `data-testid`
- 大量视觉回归对比:建议配专门的截图对比工具

## 给维护者(接入 AI 的人)

- **打开工程即连,无需手动启动**:工程根目录自带 `.mcp.json`(配了 playwright 官方 MCP + tester 两套 server),支持项目级 MCP 的 AI(Claude Code / Cursor / opencode 等)**打开本工程就会自动连接**,测试人员直接聊天即可,不用手动开 server。
- 如果 AI 不认项目级 `.mcp.json`(如 Codex 走 config.toml):在 AI 工具里配置两个 stdio server——`node D:/my-test/mcp/server.cjs`(tester)和 `npx @playwright/mcp@latest --config D:/my-test/mcp/playwright-mcp.json`(官方页面操作)。
- 工程完全自包含;AI 工作规范见 `AGENTS.md`。
- 被测地址/浏览器可用环境变量 `BASE_URL`、`TESTER_BROWSER` 配置。
- 常见坑与对策见 **`docs/踩坑记录.md`**(文本定位风险 / AI 生成局限 / 复杂页面稳定性)。
