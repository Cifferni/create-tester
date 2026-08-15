// 人工登录一次(验证码/短信场景):node scripts/login.cjs
// 打开带界面浏览器,测试人员手动登录(输验证码/收短信),登录态自动存到 test-result/auth-<account>.json,之后所有用例复用。
// 多账号:TESTER_ACCOUNT 环境变量选账号(缺省 default),各账号登录态独立文件。
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const baseURL = process.env.BASE_URL || 'http://localhost:3000';
const account = process.env.TESTER_ACCOUNT || 'default';
const authFile = `test-result/auth-${account}.json`;
fs.mkdirSync(path.join(process.cwd(), 'test-result'), { recursive: true });

console.log(`打开 ${baseURL},请在浏览器里手动登录(输验证码/收短信)。`);
console.log(`登录成功后**关掉浏览器**,登录态会自动保存(${authFile}),之后所有用例复用、不用再登录。`);

const child = spawn(
  'npx',
  ['playwright', 'codegen', baseURL, `--save-storage=${authFile}`],
  { stdio: 'inherit', shell: true, windowsHide: true }
);
child.on('close', (code) => {
  console.log(`登录态已保存到 ${authFile}。`);
  process.exit(code ?? 1);
});
