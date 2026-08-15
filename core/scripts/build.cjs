// core 构建脚本:esbuild 打包
//   src/index.ts  → dist/api.cjs + dist/api.d.cts   (spec 断言 API,测试项目 import { apiRecorder } from '@create-tester/core')
//   src/mcp.ts    → dist/mcp/server.cjs             (MCP 工具服务器,独立可执行)
// 类型声明:用 tsc 单独生成(esbuild 不做类型检查)

const { build } = require('esbuild');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

fs.rmSync(dist, { recursive: true, force: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external'
};

(async () => {
  // spec 断言 API(不依赖 MCP 运行时,测试代码只 import 这一份)
  await build({ ...common, entryPoints: [path.join(root, 'src', 'index.ts')], outfile: path.join(dist, 'index.cjs') });

  // MCP 工具服务器(引擎整体内联,独立可执行)
  await build({
    ...common,
    entryPoints: [path.join(root, 'src', 'mcp.ts')],
    outfile: path.join(dist, 'mcp', 'server.cjs'),
    banner: { js: '#!/usr/bin/env node' }
  });

  // 类型声明(供 TS spec import 时得到类型)
  execSync('npx tsc --emitDeclarationOnly --declaration --outDir dist', { cwd: root, stdio: 'inherit' });
  console.log('[core] api.cjs + mcp/server.cjs + 类型声明打包完成');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
