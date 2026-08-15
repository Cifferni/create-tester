// 包入口:供测试代码 import 的 API(接口自动断言)
//   import { apiRecorder, expectApi } from 'create-tester';

export { apiRecorder, expectApi } from './api';
export type { ApiAssertion, FieldAssertion } from './api';
export type { CapturedApi, BrowserName, TestFailure } from './types';
