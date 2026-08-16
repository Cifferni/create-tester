// 轻量 .env 加载器(无第三方依赖):把项目根目录的 .env / .env.<环境> 读进 process.env。
// 优先级:已存在的环境变量 > .env.<环境> > .env(不覆盖已设的,保证 shell/CI 注入优先)。
// 用法(在 playwright.config.ts / login.cjs / test.cjs 顶部调用):
//   const { loadEnvFile } = require('./scripts/_env.cjs');   // CJS
//   loadEnvFile(path.join(__dirname, '.env'));                // 只加载通用 .env
//   loadEnvFile(path.join(__dirname, '.env.test'));           // 加载指定环境文件
//   // 或 TS: import { loadEnvFile } from './scripts/_env.cjs';
const fs = require('fs');
const path = require('path');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue; // 空行/注释
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // 去掉首尾引号
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!key) continue;
    // 不覆盖已存在的环境变量(显式设置的优先于 .env)
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// 加载项目根目录的 .env 与当前环境的 .env.<环境名>。
// 环境名来自 TESTER_ENV 或 tester.config.ts 的 defaultEnv(缺省 test)。
// 顺序:.env 先(通用值),.env.<环境> 后(环境值覆盖)——但都不覆盖已显式设置的变量。
function loadProjectEnv(root) {
  loadEnvFile(path.join(root, '.env'));
  let env = process.env.TESTER_ENV;
  if (!env) {
    try {
      // 读 tester.config.ts 的 defaultEnv(与 playwright.config.ts 一致)
      const jiti = require('jiti')(__filename, { interopDefault: true });
      const mod = jiti(path.join(root, 'tester.config.ts'));
      const cfg = (mod && (mod.testerConfig || mod.default || mod)) || {};
      env = cfg.defaultEnv || 'test';
    } catch {
      env = 'test';
    }
  }
  loadEnvFile(path.join(root, `.env.${env}`));
  return env;
}

module.exports = { loadEnvFile, loadProjectEnv };
