// 人工登录一次(验证码/短信场景):node scripts/login.cjs
// 打开带界面浏览器,测试人员手动登录(输验证码/收短信),登录态自动存到 test-result/auth.json,之后所有用例复用
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const baseURL = process.env.BASE_URL || 'http://localhost:3000';
fs.mkdirSync(path.join(process.cwd(), 'test-result'), { recursive: true });

console.log(`打开 ${baseURL},请在浏览器里手动登录(输验证码/收短信)。`);
console.log('登录成功后**关掉浏览器**,登录态会自动保存,之后所有用例复用、不用再登录。');

const child = spawn(
  'npx',
  ['playwright', 'codegen', baseURL, '--save-storage=test-result/auth.json'],
  { stdio: 'inherit', shell: true, windowsHide: true }
);
child.on('close', (code) => {
  console.log('登录态已保存到 test-result/auth.json。');
  process.exit(code ?? 1);
});
