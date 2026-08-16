// @create-tester/core 包入口:供测试代码 import 的 API(接口自动断言)+ 供 CLI/引擎复用的能力
//   import { apiRecorder, expectApi } from '@create-tester/core';

export { apiRecorder, expectApi, waitForVisible, waitForClickable, waitForText, waitForURL, selfHeal, mockRoute, tamperResponse } from './api';
export type { ApiAssertion, FieldAssertion, SelfHealOptions, MockResponse, MockOptions } from './api';
export type { CapturedApi, BrowserName, TestFailure, FailureCategory } from './types';

// 引擎能力(供 CLI/mcp 等复用)
export { readCaseFile, readDataRows } from './cases';
export type { DataTable } from './cases';
export { parseCaseToDsl, dslToCode, dslToAssertions } from './dsl';
export type { CaseDsl, DslStep, StepAction } from './dsl';
export { loadPlugins } from './plugins';
export type { TesterPlugin, PluginRegistry } from './plugins';
export { startWebView } from './webview';
export type { WebViewOptions } from './webview';
export { checkTsSyntax, formatSyntaxErrors, checkSpecQuality, scanDiscipline } from './checkSyntax';
export { launchBrowser, closeBrowser } from './browser';
export { playwrightConfig } from './config';
export { getPageSnapshot } from './pagesnapshot';
export {
  startPlaywrightTest,
  runPlaywrightTest,
  runPlaywrightTestPassthrough,
  runWithRetry,
  parseJsonReport,
  summarizeJsonReport,
  failedSpecFiles,
  classifyFailure
} from './playwright';
export type { JsonTest, TestSummary } from './playwright';
