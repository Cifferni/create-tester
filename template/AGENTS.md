# 工作方式(务必遵守)

## 核心纪律(硬性,先过一遍)

1. 页面操作用**官方 playwright MCP**(`browser_*`),跑测试/管用例用**tester MCP**。禁止裸 Playwright 脚本、临时 spec、抓前端源码(`/src/**`)。
2. 每个用例**必须有业务断言**,禁止只点不验;断言依据=用例文档"预期",不是页面现状(不符就报告,不改断言迁就)。
3. **禁止 `waitForTimeout`/终端 sleep**:要等就用 `waitForVisible/Clickable/Text/URL`;等测试结果用 `tester_run_and_wait`(同步+自动重试)或 `tester_wait_result`。**这些违规会被 tester_run_tests 的纪律预检代码拦截,无需自觉遵守。**
4. 定位优先级:`getByTestId` > `getByRole+name` > CSS/class > `getByText`(仅兜底且唯一)。
5. 快照 ref 过期即失效:操作报 "Ref not found" 一律**先重新 `browser_snapshot`**,再基于新 ref 操作,别拿旧 ref 硬试。
6. 禁止 `browser_run_code_unsafe` 手写复杂 CSS(如 `svg path[d^=...]` 脆选择器):定位用 `browser_snapshot`/`browser_find` 拿 ref 或可访问名。

## 工具(两套 MCP)

**tester**(测试工程,前缀 `tester_`):
`tester_convert_case`(用例→文本)、`tester_generate_spec`(用例→**DSL 自动生成**操作+断言的 spec,AI 只核对选择器)、`tester_run_tests`(后台跑测,支持 grep/语法+纪律预检)、`tester_run_and_wait`(同步跑+等结果,定位/网络/超时自动重试)、`tester_wait_result`(等结果,一次调用)、`tester_status`/`tester_failures`(总览/失败详情含错误分类)、`tester_retry_failed`(重跑失败)、`tester_list_cases`/`tester_list_specs`(列文件)、`tester_set_base_url`(改地址)、`tester_login`/`tester_login_status`(人工登录)、`tester_env_reset`(还原环境)、`tester_cache_stats`(选择器缓存命中率)、`tester_vars`(跨用例变量)、`tester_api_request`(纯接口造数据)、`tester_export_doc`(导出用例文档)、`tester_config`(查看当前生效配置/开关)。

**playwright**(官方,页面操作):
`browser_snapshot`(看结构)、`browser_find`(搜文本)、`browser_click`/`browser_type`/`browser_navigate`/`browser_expect`(操作断言)、`browser_network_requests`(抓接口)、`browser_route`(mock)。

## 流程

`tester_convert_case` 读用例 → `browser_snapshot`/`browser_find` 看结构 → `tester_generate_spec`(DSL 自动生成操作+断言,核对 selfHeal 选择器)→ `tester_run_tests` 后台(或 `tester_run_and_wait` 同步+自动重试)→ `tester_wait_result`/`tester_status` 等结果(先看错误分类定位根因)→ 改后用 `tester_retry_failed` 单点验证。

## 测试人员零负担

被测地址/登录态由 `tester_set_base_url`/`tester_login` 处理,账号密码填 `tests/_login.ts`(多账号 `TESTER_ACCOUNT` 切换);**禁止让测试人员改 `.env`/配置/建文件**。

## 写用例要点

- 接口断言 `expectApi`(code/字段/状态码),页面断言 `toHaveURL`/`toHaveText`/`toHaveClass`;字段断言按形态选 equals/contains/containsValue/notEmpty/matches/between。
- 长链路传参:用例A用 `extractField(api,'/order/create','data.orderId')` 提取 + `setVar('orderId', ...)`,用例B用 `getVar('orderId')` 消费(创建→查询→编辑);跑测前自动清空上一轮变量。
- 条件分支:DSL 支持「若变量xx则点击yy」,生成 `if (await getVar('xx')) { ... }`;页面弹窗由骨架自动注入 `installPageGuard`(自动 accept),点击被遮罩挡住时先 `waitMaskGone(page)`。
- 数据驱动:`data.csv` 表头 + `readDataRows` 顶层 `for...of`,别硬编码。
- 定位不稳:`selfHeal(page, ['testid','文本','css'])` 多候选。命中后自动写入选择器缓存(`test-result/locator-cache.json`),下次同页直接读缓存不重复探测;可用 `tester_cache_stats` 看命中率,命中率低=选择器质量差或页面常变。
- Shadow DOM 组件定位失败:用 `clickInShadow(page,'文案')`/`fillInShadow(page,'标签','值')` 穿透 shadowRoot(仅 open shadowRoot,中后台组件库常见)。
- 视觉降级(可选):工程 plugin/ 放 `type:'locatorVlm'` 插件后,语义定位(selfHeal 多候选)全失败会自动降级视觉按坐标定位,成功后反哺选择器缓存;`tester_cache_stats` 可看降级次数。
- 接口 mock:`mockRoute`/`tamperResponse`;真回归验证真实后端不用 mock(否则假绿)。
- 改数据用例:造数据+自清理,判断增删用计数对比,别靠名字唯一。

## 省时间 / 省 token

- 探查用 `browser_snapshot`/`browser_find`(大页面先对容器 target 精准看),禁止临时 spec。
- 改完 `tester_retry_failed` 单点;先探查再改,别反复跑试错。
- 选择性执行:`tag` + `tester_run_tests {grep:'@smoke'}` 或 `npm run test -- --grep @smoke`。
- 环境:先构造(`tester_env_reset`/清理),构造不了才 `test.skip`+说明;环境限制不算 bug,skip 即可。
- 看结果可选 `tester view`(只读 Web 面板)。

## 插件(可选)

`plugin/*.cjs` 可扩展:用例解析器(`parseCase`)、报告器(`onSummary`)、录制器(`init`);单插件坏不影响整体,不需要就不建。
