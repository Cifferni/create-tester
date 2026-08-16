// 环境清理脚本(项目自定义):还原被测环境,保证回归可复跑。
// 两种调用方式:
//   - 手动:AI 调 tester_env_reset 工具
//   - 自动:tester.config.ts 的 autoReset.enabled=true 后,每轮测试结束自动执行
// 默认不做事。测试会改数据时,让 AI 按被测应用实现,例如:
//   - 调用后端清理接口(删掉测试产生的数据)
//   - 还原被改的配置/状态
// 例(用应用的后端 API):
//   (async () => {
//     const res = await fetch('http://localhost:5173/api/test-cleanup', { method: 'POST' });
//     console.log('[env-reset]', res.ok ? '已清理' : '清理失败:' + res.status);
//   })();
console.log('[env-reset] 未实现清理逻辑:本测试工程还没写环境还原。若用例会改被测数据,建议在此调用应用的清理接口。');
