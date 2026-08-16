// @create-tester/core 包入口:供测试代码 import 的 API(接口自动断言)+ 供 CLI/引擎复用的能力
//   import { apiRecorder, expectApi } from '@create-tester/core';

export { apiRecorder, expectApi, extractField, waitForVisible, waitForClickable, waitForText, waitForURL, selfHeal, mockRoute, tamperResponse } from './api';
export type { ApiAssertion, FieldAssertion, SelfHealOptions, MockResponse, MockOptions } from './api';
export { setVar, getVar, getVarOrFail, listVars, resetVars } from './variables';
export { installPageGuard, isLoggedOut, waitMaskGone, shieldedClick, shieldedFill } from './guard';
export type { PageGuardOptions } from './guard';
export { findInShadow, clickInShadow, fillInShadow, hasTextInShadow, selfHealShadow } from './shadow';
export { locatorCacheKey, locatorCacheStats, readLocatorCache, getCachedSelector, recordVlmUse } from './selectorCache';
export type { LocatorCacheEntry, LocatorCacheData, LocatorCacheStats, LocatorMethod } from './selectorCache';
export { resolveVlm, resetVlmPlugins } from './vlm';
export type { VlmResolveResult } from './vlm';
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
export { playwrightConfig, testerConfig, effectiveTesterConfig, locatorCacheEnabled, varsEnabled, vlmConfig, loginEnabled, clearConfigCache } from './config';
export type { PWConfig, TesterConfig } from './config';
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
