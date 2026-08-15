// 构建脚本:esbuild 打包
//   core/src 引擎 → core/dist/api.cjs + core/dist/mcp/server.cjs  (由 core/scripts/build.cjs 负责,先构建)
//   bin/create-tester.ts → dist/bin/create-tester.js            (脚手架 CLI,带 shebang)
//   bin/tester.ts        → dist/bin/tester.js                   (手动 CLI)
//   template/            → dist/template/                       (薄模板:配置 + 业务脚本)
// 生成的测试项目依赖 @create-tester/core(npm 依赖版本管理),不再内嵌引擎文件。

const { build } = require('esbuild');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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
  // 0) 先构建 core 引擎包(脚手架/手动 CLI 都要用它)
  const core = spawnSync(process.execPath, [path.join(root, 'core', 'scripts', 'build.cjs')], {
    cwd: root,
    stdio: 'inherit'
  });
  if (core.status !== 0) process.exit(core.status ?? 1);

  // 1) 脚手架 CLI + 手动 CLI
  await buildBin('bin/create-tester.ts', path.join(dist, 'bin', 'create-tester.js'));
  await buildBin('bin/tester.ts', path.join(dist, 'bin', 'tester.js'));

  // 2) 拷薄模板(配置 + 业务脚本;mcp/server.cjs 是 require core 的薄壳)
  fs.mkdirSync(path.join(dist, 'template'), { recursive: true });
  fs.cpSync(path.join(root, 'template'), path.join(dist, 'template'), { recursive: true });
  // npm 打包默认排除 .gitignore,用 _gitignore 命名使其进入发布包(create 时再转回)
  const distGitignore = path.join(dist, 'template', '.gitignore');
  const distGitignoreRenamed = path.join(dist, 'template', '_gitignore');
  if (fs.existsSync(distGitignore) && !fs.existsSync(distGitignoreRenamed)) {
    fs.renameSync(distGitignore, distGitignoreRenamed);
  }
  console.log('[build] core 引擎 + 脚手架 CLI + 薄模板打包完成');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
