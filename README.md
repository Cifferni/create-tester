# create-tester

**tester 一体化包**:脚手架(`npm create tester`)+ 引擎(`tester` CLI / 接口断言 API / MCP 工具服务器)。

面向测试工程师的 **AI 驱动页面测试**。测试人员不写代码、不碰元素选择器:把既有用例丢进 `cases/`,AI harness(Codex / opencode / Claude 等)通过 MCP 读取用例、看页面、写 spec、跑测试、判失败。执行、报告、重试、trace 全部交给 Playwright。

## 用法

```bash
npm create tester@latest          # 交互式创建测试项目
# 或
npx create-tester@latest my-test  # 直接指定名字
```

生成后:

```bash
cd my-test && npm install     # 自动装引擎(本包)+ 自动下载浏览器
npm run test                  # 跑回归(playwright test)
```

在测试工程根目录跑 `tester mcp`,会自动打印两种可粘贴的 MCP 配置(通用 `.mcp.json` + Codex `config.toml`)。工程自带 `AGENTS.md`(AI 工作规范:必用 MCP 工具、禁止写裸脚本)。

## 命令行

```
create-tester                 # 脚手架:建测试项目
tester init                   # 初始化目录规范(幂等)
tester run                    # 运行测试(透传 playwright test)
tester mcp                    # 启动 MCP stdio server,打印可粘贴配置
tester install-browsers       # 安装 Playwright 浏览器(postinstall 自动调用)
```

## 接口自动断言(核心差异化)

spec 直接 import,页面操作触发的接口自动捕获,按 URL 关键字断言,不用手写 `waitForResponse`:

```ts
import { apiRecorder, expectApi } from 'create-tester';

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
| `list_cases` | 列出 `cases/` 下的用例文件 |
| `convert_case` | 用例文件(xlsx/xmind/csv/md/txt)→ 结构化文本 |
| `snapshot` | 打开被测页面,返回可交互结构快照(供定位元素) |
| `list_specs` | 列出 `tests/` 下已生成的 spec |
| `run_tests` | 跑 Playwright 测试:后台运行立即返回"运行中",用 `failures` 轮询;`wait:true` 同步等结果 |
| `failures` | 读报告,返回失败用例详情(报告未生成 = 仍在跑) |

## 生成的测试项目

```
my-test/
├── cases/            用例(支持 xlsx/xmind/md/csv/txt)
├── tests/<功能>/*.spec.ts  可执行用例(AI 生成 或 codegen 录制)
├── playwright.config.ts  被测地址 + 浏览器 + 报告配置
├── mcp/server.cjs    工程内自带的 MCP server 代码(可改)
├── AGENTS.md          给 AI 的工作规范(必用 MCP 工具)
└── result/           所有输出:report/(HTML 报告)、test-results.json、output/(截图/trace)
```

## 配置(无配置文件,环境变量)

| 环境变量 | 说明 |
| --- | --- |
| `BASE_URL` | 被测页面地址(默认 `http://localhost:3000`) |
| `TESTER_BROWSER` | 浏览器:chromium / chrome / firefox / webkit |

## 开发

```bash
npm install
npm run typecheck     # 类型检查
npm run build         # 编译 TS → dist/(发布前需要)
```

发布后 node 直接能跑,运行时不需要 `typescript`/`tsx`。

> 注:旧包 `tester-runtime` 已并入本包(0.4.0 起)。历史项目仍可用已发布的 tester-runtime,新项目统一用 create-tester。

## License

[MIT](LICENSE)
