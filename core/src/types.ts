export type BrowserName = 'chromium' | 'chrome' | 'firefox' | 'webkit';

// ---------- 接口自动断言 ----------

export interface CapturedApi {
  method: string;
  url: string;
  reqBody?: string;
  status?: number;
  durationMs?: number;
  resBody?: string;
}

// ---------- AI 生成 ----------

export interface GenerateOptions {
  target: string;
  url?: string;
  name?: string;
  feature?: string;
  headed?: boolean;
  maxFixLoops?: number;
}

// 失败原因分类:定位 / 断言 / 网络 / 超时 / 脚本 / 其他
export type FailureCategory = '定位' | '断言' | '网络' | '超时' | '脚本' | '其他';

export interface TestFailure {
  title: string;
  error?: string;
  location?: string;
  stdout?: string;
  stderr?: string;
  /** 失败原因分类(定位/断言/网络/超时/脚本/其他),由 classifyFailure 填充 */
  category?: FailureCategory;
}
