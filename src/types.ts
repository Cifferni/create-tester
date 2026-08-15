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

export interface TestFailure {
  title: string;
  error?: string;
  location?: string;
}
