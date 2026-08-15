// 包入口:供测试代码 import 的 API(接口自动断言)+ 供 mcp/ 等工程内代码使用的引擎能力
//   import { apiRecorder, expectApi } from 'create-tester';

export { apiRecorder, expectApi } from './api';
export type { ApiAssertion, FieldAssertion } from './api';
export type { CapturedApi, BrowserName, TestFailure } from './types';

// 引擎能力(供工程内 mcp/server.cjs 等代码复用)
export { readCaseFile } from './cases';
export { launchBrowser } from './browser';
export { playwrightConfig } from './config';
export { getPageSnapshot } from './pagesnapshot';
export { startPlaywrightTest, runPlaywrightTest, parseJsonReport } from './playwright';
