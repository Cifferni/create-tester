# create-tester

**tester 一体化包**:脚手架(`npm create tester`)+ 引擎(`tester` CLI / 接口断言 API / MCP 工具服务器)。

面向测试工程师的 **AI 驱动页面测试**。**常规回归场景**:放用例、说需求、报账号/地址,AI 通过 MCP 全自动完成(读用例、看页面、写 spec、跑测试、判失败根因),测试人员不写代码、不碰选择器。**复杂场景(验证码、环境清理、自定义组件)可能需要少量代码**,底层仍是 Playwright,AI 负责编排与回归闭环。

## 定位 / 和市面上的区别

市面上做"AI 能碰浏览器"的多,**做"让测试人员不用懂浏览器"的少,咱们是后者**:

| 维度 | @playwright/mcp | Mabl / Testim | **create-tester** |
| --- | --- | --- | --- |
| 用例解析(xlsx/xmind 零重写) | ❌ | 部分 | ✅ `convert_case` |
| 浏览器控制(snapshot/inspect) | ✅ | ✅ | ✅ |
| 回归资产(`tests/*.spec.ts`) | ❌ | 部分 | ✅ |
| 失败根因 + stdout/stderr 透出 | ❌ | 有但贵 | ✅ 轻量 |
| 登录/验证码编排 | ❌ | 部分 | ✅ |
| 环境可复跑 | ❌ | ✅ | ✅ `env_reset` |
| 接口自动断言(免 waitForResponse) | ❌ | ❌ | ✅ `expectApi` |
| 测试人员零负担(只聊天) | ❌(面向开发者) | 中 | ✅ |
| 成本 | 免费 | 订阅制 | 免费 |

**一句话**:@playwright/mcp 给 AI 一双浏览器的手,我们给测试工程师一个 AI 测试工位——用例解析 → 生成 → 回归 → 根因 → 环境还原,全闭环、自包含、免费。

## 测试人员体验(三步走)

1. **放用例**:把已有用例(Excel / XMind / Markdown / CSV / TXT)丢进 `test-cases/`,零重写
2. **说需求**:用支持项目级 MCP 的 AI(Claude Code / Cursor / opencode)打开工程,直接说"把 test-cases/登录.xlsx 转成测试用例跑一遍,失败的给我分析根因"
3. **报账号/地址**:对话里说"账号 xxx、密码 xxx"、"被测地址是 http://xxx:5173",AI 自动处理,测试人员不碰任何文件

验证码登录首次跑一次 `npm run login` 手动登录,之后自动复用;回归 `npm run test` 不需要 AI/MCP。

## 安装 / 快速开始

```bash
# 方式一:npm create(推荐,无需全局安装,交互式)
npm create tester@latest

# 方式二:npx(直接指定项目名)
npx create-tester@latest my-test

# 方式三:全局安装后直接用 create-tester 命令
npm i -g create-tester
create-tester my-test
```

生成后:

```bash
cd my-test && npm install     # 自动装依赖 + 自动下载浏览器
npm run test                  # 跑回归(playwright test,不用开 AI)
```

生成的工程**完全自包含**:MCP server 与引擎代码在工程 `mcp/` 里,不依赖 create-tester 包;脚手架自动生成 `.mcp.json`,支持项目级 MCP 的 AI 打开工程即自动连接。

## 命令行

```
create-tester                 # 脚手架:建测试项目
create-tester upgrade         # 升级当前工程到最新引擎(在工程根目录跑)
tester init                   # 初始化目录规范(幂等)
tester run                    # 运行测试(透传 playwright test)
tester mcp                    # 启动 MCP stdio server,打印可粘贴配置
tester diag                   # 诊断环境(依赖/配置/目录/MCP 握手)
tester install-browsers       # 安装 Playwright 浏览器(postinstall 自动调用)
```

> 所有命令支持 `--help`(如 `create-tester --help`、`tester mcp --help`)、`--version`。

## 升级

- **脚手架本身**:全局装的可 `npm i -g create-tester@latest`;用 `npm create`/`npx` 的每次都自动用最新版,不用手动升。
- **已建的测试工程**(引擎自包含在 `mcp/`,是建项目那刻的快照):在工程根目录跑
  ```bash
  npx create-tester@latest upgrade
  ```
  会用最新引擎更新 `mcp/server.cjs`、`mcp/api.cjs`;**不覆盖你改过的文件**(`_login.ts`、`auth.setup.ts`、`playwright.config.ts`、specs、`env-reset.cjs`)。升级后重启 AI 会话即可。

## 登录(Playwright 官方模式 + 验证码编排)

- `tests/auth.setup.ts` 跑测试前登录一次存 `test-result/auth.json`,**整轮只登录一次**,所有用例复用 storageState
- 账号密码:测试人员在对话里说,AI 填进 `tests/_login.ts`,测试人员不碰文件
- **验证码/短信**:`login` 工具后台弹浏览器人工登录一次 → `login_status` 轮询 `auth.json` 生成 → 自动继续;或首次 `npm run login`

## 接口自动断言(核心差异化)

spec 直接 import 工程内的 `mcp/api.cjs`,页面操作触发的接口自动捕获,按 URL 关键字断言,不用手写 `waitForResponse`:

```ts
import { apiRecorder, expectApi } from '../mcp/api.cjs';

test('登录成功', async ({ page }) => {
  const api = apiRecorder(page);
  await page.getByTestId('username').fill('test01');
  await page.getByTestId('login-submit').click();

  await expectApi(api, '/api/login').code('0');           // 业务码
  await expectApi(api, '/api/login').field('data.token').notEmpty(); // 字段
  await expectApi(api, '/api/login').status(200);         // 状态码
});
```

## MCP 工具

| 工具 | 说明 |
| --- | --- |
| `list_cases` | 列出 `test-cases/` 下的用例文件 |
| `convert_case` | 用例文件(xlsx/xmind/csv/md/txt)→ 结构化文本 |
| `snapshot` | 打开被测页面,返回可交互结构快照(纯图标按钮补充 class/title/svg 特征) |
| `inspect` | 只读探查 DOM:按选择器返回 outerHTML/属性(不改数据) |
| `set_base_url` | 测试人员对话里说被测地址,AI 改 config(不用测试人员碰文件) |
| `login` | 后台弹浏览器人工登录(验证码场景),配合 `login_status` |
| `login_status` | 检查人工登录是否完成(auth.json 是否生成) |
| `list_specs` | 列出 `tests/` 下已生成的 spec |
| `run_tests` | 后台跑测试,立即返回"运行中",用 `status`/`failures` 轮询;传 `{workers:N}` 并行提速(需用例隔离) |
| `status` | 读报告,返回通过/失败/跳过/耗时总览 |
| `failures` | 读报告,返回全貌 + 失败详情(含 stdout/stderr 日志) |
| `retry_failed` | 只重跑上次失败的 spec(收敛失败循环) |
| `generate_spec` | 按 test-cases/ 用例生成 spec 骨架(含 apiRecorder + 业务断言模板) |
| `verify_locators` | 跑前预检 spec 选择器(命中/未命中,避免空跑) |
| `env_reset` | 执行工程 `mcp/env-reset.cjs` 还原环境(跑会改数据的回归前调用) |

## 生成的测试项目

```
my-test/
├── test-cases/       用例(支持 xlsx/xmind/md/csv/txt,输入源)
├── tests/            可执行用例
│   ├── _login.ts     登录 helper(AI 填账号密码,测试人员不碰)
│   ├── auth.setup.ts 登录 setup:登录一次存 test-result/auth.json
│   └── <功能>/*.spec.ts
├── mcp/              引擎(自包含)
│   ├── server.cjs    MCP server(引擎内联,可改)
│   ├── api.cjs       接口断言 API(spec import '../mcp/api.cjs')
│   └── env-reset.cjs 环境清理钩子(项目按应用实现)
├── scripts/login.cjs 人工登录(验证码场景)
├── playwright.config.ts  被测地址 + 浏览器 + 报告 + storageState 配置
├── .mcp.json         支持项目级 MCP 的 AI 打开工程即连
├── AGENTS.md          给 AI 的工作规范(必用 MCP 工具/断言纪律/性能纪律)
├── README.md          测试人员使用引导
└── test-result/      所有输出:report/(HTML 报告)、test-results.json、auth.json、output/(截图/trace)
```

## 配置(无配置文件,环境变量)

| 环境变量 | 说明 |
| --- | --- |
| `BASE_URL` | 被测页面地址(默认 `http://localhost:3000`;对话里说地址 AI 会用 set_base_url 改) |
| `TESTER_BROWSER` | 浏览器:chromium / chrome / firefox / webkit |

## 开发

```bash
npm install
npm run typecheck     # 类型检查
npm run build         # esbuild 打包 → dist/(发布前需要)
```

发布后 node 直接能跑,运行时不需要 `typescript`/`tsx`。

> 注:旧包 `tester-runtime` 已并入本包(0.4.0 起)。历史项目仍可用已发布的 tester-runtime,新项目统一用 create-tester。

## License

[MIT](LICENSE)
