# create-tester

创建 tester 测试项目的**脚手架 CLI**(只负责建项目,类似 create-vue)。交互式:输入名称、方向键选主浏览器、空格多选额外浏览器。

生成的测试项目会把引擎 [**tester-runtime**](https://github.com/Cifferni/tester-runtime) 作为依赖安装,项目干净(只有 `cases/`、`tester.config.ts`、脚本)。

## 用法

```bash
npm create tester@latest          # 交互式创建
# 或
npx create-tester@latest my-test  # 直接指定名字
```

生成后:

```bash
cd my-test && npm install     # 自动装引擎 tester-runtime + 自动下载浏览器
npm run run                   # 全自动跑用例 → reports/run-*.html
npm run capture               # 抓包助手(半自动)
```

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
├── cases/*.yaml    用例(写用例的地方)
├── tester.config.ts  被测地址 + 浏览器 + 判断规则 + AI 配置
├── package.json    脚本 + 依赖 tester-runtime
├── reports/        运行报告(自动生成)
└── data/           抓包记录、截图(自动生成)
```

## 开发

```bash
npm install
npm run typecheck
```

## License

[MIT](LICENSE)
