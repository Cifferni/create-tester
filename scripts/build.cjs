// 构建脚本:esbuild 打包
//   bin/create-tester.ts        → dist/bin/create-tester.js     (脚手架 CLI,带 shebang)
//   src/mcp.ts                  → dist/template/mcp/server.cjs  (工程内 MCP server,引擎整体内联,依赖 external)
//   src/index.ts                → dist/template/mcp/api.cjs     (工程内断言 API,spec 直接 import)
//   template/ 其余              → dist/template/(create 建项目时拷给用户)
// 生成的测试项目完全自包含:引擎代码在 mcp/,不依赖 create-tester 包。

const { build } = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');

fs.rmSync(dist, { recursive: true, force: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external'
};

async function buildBin(entry, outfile) {
  await build({ ...common, entryPoints: [entry], outfile, banner: { js: '#!/usr/bin/env node' } });
}

(async () => {
  // 脚手架 CLI + 手动 CLI(create-tester 自带,项目内自包含不依赖)
  await buildBin('bin/create-tester.ts', path.join(dist, 'bin', 'create-tester.js'));
  await buildBin('bin/tester.ts', path.join(dist, 'bin', 'tester.js'));

  // 工程内 MCP server(引擎整体内联进一个自包含文件)
  await build({ ...common, entryPoints: ['src/mcp.ts'], outfile: path.join(dist, 'template', 'mcp', 'server.cjs'), banner: { js: '#!/usr/bin/env node' } });

  // 工程内断言 API(spec: import { apiRecorder } from '../mcp/api.cjs')
  await build({ ...common, entryPoints: ['src/index.ts'], outfile: path.join(dist, 'template', 'mcp', 'api.cjs') });

  fs.mkdirSync(path.join(dist, 'template'), { recursive: true });
  fs.cpSync(path.join(root, 'template'), path.join(dist, 'template'), { recursive: true });
  // npm 打包默认排除 .gitignore,用 _gitignore 命名使其进入发布包(create 时再转回)
  const distGitignore = path.join(dist, 'template', '.gitignore');
  const distGitignoreRenamed = path.join(dist, 'template', '_gitignore');
  if (fs.existsSync(distGitignore) && !fs.existsSync(distGitignoreRenamed)) {
    fs.renameSync(distGitignore, distGitignoreRenamed);
  }
  console.log('[build] 脚手架 + mcp/ 引擎(server.cjs/api.cjs)打包完成,template/ 已拷入 dist/');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
