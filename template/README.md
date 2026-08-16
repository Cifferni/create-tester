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

**第 3 步:告诉 AI 被测地址(和账号密码)**
对 AI 说:

> "被测地址是 http://xxx.xx"
> (要登录,再补一句)"登录账号是 test01,密码是 123456"

AI 会把地址写进 `tester.config.ts`、账号密码写进当前环境的 `.env.<环境>` 文件(如 `.env.test`,敏感信息不进仓库),再自动登录,**整轮只登一次**。登录要验证码/短信时,第一次跑一下 `npm run login`(弹出浏览器手动登一次),之后自动复用。

> 不想开 AI、想自己动手改文件?直接看下面「配置被测地址和账号密码」的「方式二」。

**第 4 步:说第一句话**
对 AI 说:

> "把 test-cases/登录.xlsx 转成测试用例跑一遍,失败的给我分析根因"

AI 会自动完成全流程,你只等结果:

```
读用例 → 打开页面看结构 → 生成测试 → 跑测试 → 告诉你哪些过、哪些挂、为什么挂
```

---

## 配置被测地址和账号密码(两种方式,任选其一)

跑起来就靠两样东西:**被测地址**(打哪个页面)和**账号密码**(要登录时)。两种方式任选:

### 方式一:告诉 AI(推荐,最简单)

对着 AI 说两句就行,它会自己把地址写进 `tester.config.ts`、账号密码写进 `.env.<环境>`,你**不用碰任何文件**:

> "被测地址是 http://xxx.xx"
> "登录账号是 test01,密码是 123456"

### 方式二:自己改文件(不想开 AI 时)

> 账号密码这类敏感信息都放在 `.env.<环境>` 文件里,已被 gitignore 排除,不会进仓库。

**① 被测地址** — 打开 `tester.config.ts`,找到你要跑的环境(默认是 `test`),把 `baseURL` 改成你的地址:

```ts
envs: {
  test: { baseURL: 'http://你的被测地址', browser: 'chromium', login: true, ... }
}
```

**② 账号密码** — 打开当前环境的 `.env.<环境>` 文件(默认环境 `test` 就是 `.env.test`;**没有就新建一个同名文件**),填上账号密码:

```
TESTER_USER=你的账号
TESTER_PASSWORD=你的密码
```

多个账号(如 `admin`)就追加 `TESTER_USER_ADMIN` / `TESTER_PASSWORD_ADMIN`,跑的时候设 `TESTER_ACCOUNT=admin` 切到它。

改完直接跑(`npm run test`)即可,不用改代码。哪个环境对应哪个文件:`tester.config.ts` 里 `envs` 的表名 + `.env.` 前缀,如环境 `uat` 就是 `.env.uat`。

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
npm run test                 # 跑全部(多个环境时会弹出菜单让你选,回车用默认环境)
npm run test -- --last-failed # 只重跑上次失败的
TESTER_ENV=uat npm run test  # 跳过菜单,直接跑指定环境
```

> 全程自动:登录一次 → 跑所有用例 → 出报告。**不需要开 AI / MCP。**
> 环境切换不用记变量:直接 `npm run test` 会列出 `tester.config.ts` 里配置的环境,按数字选即可;`npm run login` 同理(登录哪个环境,登录态就存到哪份文件,测试跑哪个环境用哪份)。

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

**2. 配置** — 地址/浏览器/登录集中在 `tester.config.ts`,按环境分组(每个环境一段完整配置:地址/浏览器/登录,每项有白话注释)
- 优先级:**环境变量 > 当前环境的配置(tester.config.ts) > 内置默认**
- **每个环境一个 `.env.<环境>` 文件**(`.env.test` / `.env.uat` / `.env.prod` …),放该环境的敏感配置(账号密码、VLM 密钥),已被 gitignore 排除(不进仓库)。脚手架创建工程时自动生成,你只填值。
  - 缺省账号:`TESTER_USER` / `TESTER_PASSWORD`
  - 多账号:`TESTER_USER_<账号大写>` / `TESTER_PASSWORD_<账号大写>`(如 admin → `TESTER_USER_ADMIN`),跑时设 `TESTER_ACCOUNT=admin` 切换
  - VLM 视觉兜底(可选):`TESTER_VLM_ENABLED` / `TESTER_VLM_MODEL` / `TESTER_VLM_API_URL` / `TESTER_VLM_API_KEY` / `TESTER_VLM_TIMEOUT`
- 临时覆盖(不改文件):`BASE_URL` / `TESTER_ENV` / `TESTER_BROWSER` / `TESTER_LOGIN`

**3. 多环境跑测试**
```bash
npm run test                   # 交互式:方向键选环境(回车用默认环境)
tester run --env test          # 直接指定环境跑
tester run --env uat --workers 4 # 预发环境 + 4 并行
tester run --grep @smoke       # 只跑冒烟标签
```
`--env` 的名字对应 `tester.config.ts` 里 `envs` 表;设了 `BASE_URL` 时以它为准。

**3.5 升级到新引擎**
```bash
npx create-tester@latest upgrade
```
- **补齐新模板文件**(缺失才补):`tester.config.ts` / `plugin/vlm.example.cjs` / `ci.example.yml`
- **绝不覆盖**:你改过的任何文件(`_login.ts`、`auth.setup.ts`、`playwright.config.ts`、specs、`env-reset.cjs`、`.env.<环境>` 等)原样保留
- 升级后重启 AI 会话即可

**4. CI / 定时回归**
- `tester run` 退出码按结果(0=全通过,1=有失败),流水线直接判红
- 模板自带 `ci.example.yml`(GitHub Actions 示例:装依赖 → 装浏览器 → 跑回归 → 传报告),复制为 `.github/workflows/regression.yml` 并配好 Secrets 即可;Jenkins 同理,核心就一句 `npx tester run --workers N`
- CI 里环境变量直接用 Secrets 注入,不落盘

**5. VLM 视觉兜底(可选,默认关)**
语义定位(找元素)全失败时,把截图发给"能看图的模型"按坐标点,适合 Canvas / 封闭组件。配置和密钥都在该环境的 `.env.<环境>` 里(不进仓库),启用 3 步:
1. `.env.<环境>` 里 `TESTER_VLM_ENABLED=1`,并填 `TESTER_VLM_MODEL` / `TESTER_VLM_API_URL` / `TESTER_VLM_API_KEY`(超时可加 `TESTER_VLM_TIMEOUT`,默认 8 秒)
2. `plugin/` 放视觉插件(模板自带 `vlm.example.cjs`,复制改名 `vlm.cjs`)
3. 重启测试进程(AI 会话或 `npm run test`)使环境文件生效

**6. 其他**
- AI 工作规范见 `AGENTS.md`(双 server 分工 / 断言纪律 / 定位优先级)
- 常见坑与对策见 `docs/踩坑记录.md`(文本定位风险 / AI 生成局限 / 复杂页面稳定性)
