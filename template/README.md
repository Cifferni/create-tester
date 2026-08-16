# 测试项目使用说明

这个项目用 AI 帮你的页面做自动化测试。**你放用例、说需求,AI 负责写测试、跑测试、分析结果**——不需要你写代码、碰文件、敲命令。

---

## 先确认你的角色

| 角色 | 你是谁 | 看哪部分 |
| --- | --- | --- |
| 🧑‍💻 **测试人员** | 写用例、要结果的人 | 「快速开始」→「日常使用」 |
| 🔧 **维护者** | 接 AI、配环境、管 CI 的人 | 底部「给维护者」 |

---

## 快速开始(第一次用,约 5 分钟)

**第 1 步:放用例**
把已有的测试用例丢进 `test-cases/` 文件夹,原样放进去,**不用改任何格式**。

| 格式 | 适用场景 |
| --- | --- |
| Excel(.xlsx / .xls) | 大批量用例管理 |
| XMind(.xmind) | 梳理测试点 / 场景 |
| Markdown / CSV / TXT | 文档、禅道/Jira 导出、自然语言步骤 |

**第 2 步:把这段配置给 AI,让它自己连上**
下面是一段 MCP 配置(通用格式)。打开你的 AI 后,把这整段**复制粘贴给它**就行——AI 会根据它自己的接入方式(MCP 面板 / 配置文件 / 命令)自动适配,你不用懂。

````
请帮我接入以下两个 MCP server(路径换成你看到的实际路径):

1. tester(测试工程工具:读用例/生成/跑测/报告/登录/配置)
   - 类型:stdio
   - 命令:node
   - 参数:["<本工程绝对路径>/mcp/server.cjs"]
   - 工作目录:<本工程绝对路径>

2. playwright(浏览器操作:看页面/点击/输入/断言,官方)
   - 类型:stdio
   - 命令:npx
   - 参数:["@playwright/mcp@latest", "--headless", "--config", "<本工程绝对路径>/mcp/playwright-mcp.json"]

接入后确认:你的工具列表里能看到 tester_*(如 tester_run_tests / tester_failures)和 browser_*(如 browser_snapshot / browser_click)两套工具。
````

> 更省事:如果你的 AI 支持项目级 `.mcp.json`(opencode / Cursor 等),工程里已经配好了,直接打开本工程即可,不用粘贴。**只跑回归(`npm run test`)不需要 MCP。**

**第 3 步:说第一句话**
对 AI 说:

> "把 test-cases/登录.xlsx 转成测试用例跑一遍,失败的给我分析根因"

AI 会自动完成全流程,你只等结果:

```
读用例 → 打开页面看结构 → 生成测试 → 跑测试 → 告诉你哪些过、哪些挂、为什么挂
```

**第 4 步(要登录才需要):报账号**
对 AI 说一句:

> "登录账号是 test01,密码是 123456"

AI 记住后自动登录,**整轮只登一次**。登录要验证码/短信时,第一次跑一下 `npm run login`(弹出浏览器手动登一次),之后自动复用。

---

## 日常使用(每次用)

```
① 放用例(或让 AI 直接写) → ② 对 AI 说需求 → ③ AI 跑测试 → ④ 看结果 / 让 AI 修
```

### 你可以对 AI 说的话(照着说就行)

| 想干嘛 | 怎么说 |
| --- | --- |
| 跑一遍所有用例 | "把 test-cases/ 的用例都跑一遍" |
| 跑某个模块 | "只跑登录相关的用例" |
| 分析失败 | "失败的给我分析根因,是环境问题还是真 bug" |
| 重跑失败 | "把上次失败的重新跑一遍" |
| 改被测地址 | "被测地址改成 http://xxx" |
| 加个测试 | "给订单功能写几个测试,断言接口 /api/order 返回 code=0" |

### 怎么看结果

- **AI 直接告诉你**:哪个用例挂了、为什么挂——不用自己翻日志
- **HTML 报告**:`test-result/report/index.html`,有截图和操作记录,可直接当 bug 证据发给开发

### 不用 AI 也能跑(回归模式)

用例固化之后,可以直接命令行跑,无人值守:

```bash
npm run test                 # 跑全部
npm run test -- --last-failed # 只重跑上次失败的
```

> 全程自动:登录一次 → 跑所有用例 → 出报告。**不需要开 AI / MCP。**

---

## 项目里都有啥(认识一下,不用细看)

```
test-cases/    你放的原始用例(Excel / XMind / 文档)
tests/         固化的可执行测试(AI 生成,别手动改)
tester.config.ts   配置总开关(环境地址/功能开关,有白话注释)
test-result/   所有输出:报告、截图、视频、登录态、缓存
```

> 配置在 `tester.config.ts`,**测试人员不用碰**——地址、账号在对话里说,AI 帮你改。

---

## 常见问题

| 现象 | 怎么办 |
| --- | --- |
| 页面打不开 | 告诉 AI 被测地址,或让开发确认服务已启动、已连内网/VPN |
| AI 说定位不到元素 | 让 AI 重新看页面结构(browser_snapshot / browser_find),别让它瞎猜 |
| 用例挂了,不知道是不是 bug | 让 AI 分析根因:环境问题(没登录、刷新不保持)还是真 bug |
| 想重跑失败的 | 不用开 AI:`npm run test -- --last-failed` |
| 被测地址变了 | 对话里告诉 AI 新地址即可 |
| 特殊组件定位不到(Shadow DOM) | AI 会用穿透定位(clickInShadow / fillInShadow),还不行就让开发加 data-testid |

---

## 适合什么 / 不适合什么

**✅ 适合**
- 有现成用例想做回归:放进来,AI 批量转成可执行用例
- 表单 / 登录 / 列表 / 流程类功能测试
- 不想写代码、不想碰文件的人:说需求,AI 代办
- 需要无人值守回归(CI / 定时):`npm run test` 直接跑

**❌ 不适合(需要人工 / 其他工具)**
- 高度视觉化断言(像素级 UI、Canvas/WebGL、图表精确比对)
- 需要真实设备(真机 App、特殊硬件)——只驱动桌面浏览器
- 强验证码 / 短信 / 外部人机验证——偶尔靠人工登录兜底,不适合全自动
- 选择器极不稳定、页面频繁改版——自愈只能缓解,根治靠开发加 `data-testid`

---

## 给维护者(接入 AI / 配环境 / 管 CI 的人)

**1. MCP 连接**
- **opencode / Cursor**:工程自带 `.mcp.json`,打开工程即读,无需手动
- **其他 AI**:把「快速开始·第 2 步」那段配置说明复制粘贴给 AI,让它按自己的方式接入(面板/命令/config 都行,本质就是那两个 stdio server)
- 兜底:`node <工程>/mcp/server.cjs`(tester)+ `npx @playwright/mcp@latest --config <工程>/mcp/playwright-mcp.json`(playwright)

**2. 配置** — 集中在 `tester.config.ts`(环境地址 / 功能开关 / 重试 / 视觉兜底,每项有白话注释)
- 优先级:**环境变量 > tester.config.ts > 内置默认**
- 关键环境变量:`BASE_URL`(被测地址)、`TESTER_ENV`(环境名)、`TESTER_BROWSER`(浏览器)、`TESTER_ACCOUNT`(多账号)

**3. 多环境跑测试**
```bash
tester run --env test            # 测试环境
tester run --env uat --workers 4 # 预发环境 + 4 并行
tester run --grep @smoke         # 只跑冒烟标签
```
`--env` 的名字对应 `tester.config.ts` 里 `envs` 表;设了 `BASE_URL` 时以它为准。

**4. CI / 定时回归**
- `tester run` 退出码按结果(0=全通过,1=有失败),流水线直接判红
- 模板自带 `ci.example.yml`(GitHub Actions 示例:装依赖 → 装浏览器 → 跑回归 → 传报告),复制为 `.github/workflows/regression.yml` 并配好 Secrets 即可;Jenkins 同理,核心就一句 `npx tester run --workers N`

**5. VLM 视觉兜底(可选,默认关)**
语义定位(找元素)全失败时,把截图发给"能看图的模型"按坐标点,适合 Canvas / 封闭组件。启用 3 步:
1. `tester.config.ts` → `vlm.enabled: true`
2. 填 `model` / `apiUrl` / `apiKey`(或设环境变量 `TESTER_VLM_API_KEY`,避免 key 进仓库)
3. `plugin/` 放视觉插件(模板自带 `vlm.example.cjs`,复制改名 `vlm.cjs`)

**6. 其他**
- AI 工作规范见 `AGENTS.md`(双 server 分工 / 断言纪律 / 定位优先级)
- 常见坑与对策见 `docs/踩坑记录.md`(文本定位风险 / AI 生成局限 / 复杂页面稳定性)
