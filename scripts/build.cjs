// 构建脚本:用 esbuild 把源码打成自包含 JS
//   bin/tester.ts        → dist/bin/tester.js        (引擎 CLI,带 shebang)
//   bin/create-tester.ts → dist/bin/create-tester.js (脚手架 CLI,带 shebang)
//   src/index.ts         → dist/index.js             (接口断言 API,供 spec import)
// 依赖(node_modules)保持 external,运行时由使用方提供。
// template/ → dist/template/(create-tester 建项目 + tester init 都读它)

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
  await buildBin('bin/tester.ts', path.join(dist, 'bin', 'tester.js'));
  await buildBin('bin/create-tester.ts', path.join(dist, 'bin', 'create-tester.js'));
  await build({ ...common, entryPoints: ['src/index.ts'], outfile: path.join(dist, 'index.js') });

  fs.mkdirSync(dist, { recursive: true });
  fs.cpSync(path.join(root, 'template'), path.join(dist, 'template'), { recursive: true });
  // npm 打包默认排除 .gitignore,用 _gitignore 命名使其进入发布包(init / create 时再转回)
  const distGitignore = path.join(dist, 'template', '.gitignore');
  const distGitignoreRenamed = path.join(dist, 'template', '_gitignore');
  if (fs.existsSync(distGitignore) && !fs.existsSync(distGitignoreRenamed)) {
    fs.renameSync(distGitignore, distGitignoreRenamed);
  }
  console.log('[build] esbuild 打包完成,template/ 已拷入 dist/');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
