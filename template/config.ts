// ============================================================
// tester 测试项目配置(带注释,编辑器有自动补全)
// 改完保存后重新运行 npm run run 生效
// ============================================================

const config = {
  // 被测页面地址(运行用例/抓包助手时打开的第一个页面)
  url: 'http://localhost:3000',

  // 使用的浏览器:chromium(自动下载,推荐)/ chrome(用系统已装Chrome)/ firefox / webkit
  browser: 'chromium',

  // 查看抓包结果的本地端口,浏览器打开 http://localhost:8080 查看
  viewerPort: 8080,

  // ---------- 可疑判断规则 ----------
  rules: {
    // 视为异常响应的 HTTP 状态码(匹配即标红)
    badStatus: [400, 401, 403, 404, 500, 502, 503],

    // 响应体长度小于该值时,认为"返回几乎为空"
    emptyBodyLength: 5,

    // 期望的业务返回码(注意:HTTP 200 不代表业务成功,很多系统用 code 字段)
    expectedBusinessCode: '0',

    // 响应耗时超过该毫秒数,标记"响应慢"
    slowMs: 3000,

    // 必填字段检查:按 URL 关键字匹配接口,检查响应 JSON 里这些字段不能为空/null
    // 格式: { "接口URL关键字": ["字段路径", ...] }
    // 例: "/api/login": ["code", "data.token"]  表示 URL 含 /api/login 时,
    //     响应体必须有 code 和 data.token 两个字段且有值
    requiredFields: {
      '/api/login': ['code', 'data.token']
    }
  },

  // ---------- 在线 AI 调用(可选) ----------
  ai: {
    // 是否启用:false 时报告里给出提示词,复制粘贴到 AI 对话即可
    enabled: false,

    // 兼容 OpenAI 的接口地址,如 https://api.openai.com/v1
    baseUrl: '',

    // 你的 API Key(注意别提交到代码仓库)
    apiKey: '',

    // 模型名,如 gpt-4o-mini
    model: ''
  }
};

export { config };
