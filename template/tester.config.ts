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
  // 视觉兜底(VLM,可选):配置和 key 都在该环境的 .env.<环境> 文件里(TESTER_VLM_*),不进仓库。
  envs: {
    // 开发:本地+Chrome
    dev: {
      baseURL: 'http://localhost:5173',
      browser: 'chrome',
      login: true
    },
    // 测试(默认环境)
    test: {
      baseURL: 'http://localhost:3000',
      browser: 'chromium',
      login: true
    },
    // 预发
    uat: {
      baseURL: 'http://uat.example.com',
      browser: 'chromium',
      login: true
    },
    // 生产:只读冒烟
    prod: {
      baseURL: 'http://example.com',
      browser: 'chromium',
      login: false
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
