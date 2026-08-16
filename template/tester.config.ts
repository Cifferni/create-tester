// ═══════════════════════════════════════════════════
// tester 配置(总开关面板)
// 常规配置(地址/浏览器/登录/VLM)都在这,按环境分组。
// 优先级:环境变量/.env.<环境> > 本文件 > 内置默认。
// ═══════════════════════════════════════════════════

export const testerConfig = {
  // 每个环境一段完整配置,切环境自动带上:
  //   baseURL   被测地址
  //   browser   浏览器(chromium/chrome/firefox/webkit),不写用全局 browser
  //   login     是否登录
  //   vlm       视觉兜底配置(enabled/model/apiUrl/timeout),apiKey 走 .env.<环境> 的 TESTER_VLM_API_KEY
  envs: {
    // 开发:本地+Chrome
    dev: {
      baseURL: 'http://localhost:5173',
      browser: 'chrome',
      login: true,
      vlm: { enabled: false, model: 'glm-4v', apiUrl: 'https://你的模型服务地址/v1/chat/completions', timeout: 8 }
    },
    // 测试(默认环境)
    test: {
      baseURL: 'http://localhost:3000',
      browser: 'chromium',
      login: true,
      vlm: { enabled: false, model: 'glm-4v', apiUrl: 'https://你的模型服务地址/v1/chat/completions', timeout: 8 }
    },
    // 预发
    uat: {
      baseURL: 'http://uat.example.com',
      browser: 'chromium',
      login: true,
      vlm: { enabled: false, model: 'glm-4v', apiUrl: 'https://你的模型服务地址/v1/chat/completions', timeout: 8 }
    },
    // 生产:只读冒烟
    prod: {
      baseURL: 'http://example.com',
      browser: 'chromium',
      login: false,
      vlm: { enabled: false, model: 'glm-4v', apiUrl: 'https://你的模型服务地址/v1/chat/completions', timeout: 8 }
    }
  },

  // 默认环境:不指定时跑哪个
  defaultEnv: 'test',

  // 全局默认浏览器(环境没单独配 browser 时用);TESTER_BROWSER 可覆盖
  browser: 'chromium',

  // ── 内置功能开关 ──
  switches: {
    // 选择器缓存:记住定位过的选择器,下次复用(页面常变时可关);TESTER_LOCATOR_CACHE=0 关
    locatorCache: true,
    // 跨用例变量:setVar/getVar 支持"创建→查询→编辑"长链路;TESTER_VARS=0 关
    vars: true
  },

  // ── 失败自动重试:定位/网络/超时等偶发失败自动重跑(断言失败不重试) ──
  retry: {
    maxRounds: 2,
    retryable: ['定位', '网络', '超时']
  },

  // 测试后自动恢复数据:跑完自动执行 mcp/env-reset.cjs 还原环境;TESTER_AUTO_RESET=0 关
  autoReset: {
    enabled: false,
    onFailureOnly: false
  }
};
