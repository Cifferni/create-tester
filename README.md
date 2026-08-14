# create-tester

创建 tester 测试项目的**脚手架 CLI**(只负责建项目,类似 create-vue)。交互式:输入名称、方向键选主浏览器、空格多选额外浏览器。

生成的测试项目会把引擎 [**tester-runtime**](https://github.com/Cifferni/tester-runtime) 作为依赖安装,项目干净(只有 `cases/`、`playwright.config.ts`、脚本)。

## 用法

```bash
npm create tester@latest          # 交互式创建
# 或
npx create-tester@latest my-test  # 直接指定名字
```

生成后:

```bash
cd my-test && npm install     # 自动装引擎 tester-runtime + 自动下载浏览器
npm run mcp                   # 启动 MCP server,在 AI harness(Codex/opencode 等)里接入
npm run test                  # 跑回归(playwright test)
```

在 AI harness 里配置 MCP(启动命令 `npx tester-runtime mcp`,注意是包名 `tester-runtime`,npm 上有个无关的同名包 `tester`)后,直接对 AI 说:"把 cases/登录.xlsx 转成测试用例跑一遍"——AI 会通过 MCP 读取用例、打开页面、写 spec、跑测试、分析失败。

## 命令行选项

```
-b, --browser <name>       主浏览器:chromium/chrome/firefox/webkit
--extra-browsers <names>   额外浏览器,逗号分隔
--no-install               不自动执行 npm install
--force                    目录已存在且非空时强制覆盖
```

## 生成的测试项目

```
my-test/
├── cases/*.yaml    用例(写用例的地方,支持 xlsx/xmind/md/csv/txt)
├── playwright.config.ts  被测地址 + 浏览器 + 报告配置(Playwright 原生)
├── package.json    脚本 + 依赖 tester-runtime
└── result/         所有输出:report/(HTML 报告)、test-results.json、output/(截图/trace)
```

## 开发

```bash
npm install
npm run typecheck
```

## License

[MIT](LICENSE)
