# 测试项目

基于 [tester-runtime](https://www.npmjs.com/package/tester-runtime) 的页面测试 + 接口返回校验项目。

## 快速开始

```bash
npm run capture          # 抓包助手(半自动探索,替代 DevTools/Fiddler)
npm run run              # 全自动跑 cases/ 下的用例,生成 reports/run-*.html 报告
npm run run:headed       # 带界面执行(配合用例里的 暂停 关键字人工介入)
npm run judge            # 对抓包记录跑规则 + 生成 AI 初判提示
```

## 结构

```
cases/*.yaml   用例(写用例的地方)
config.ts      被测地址 + 浏览器 + 判断规则 + AI 配置
reports/       运行报告(自动生成)
data/          抓包记录、截图(自动生成)
```
