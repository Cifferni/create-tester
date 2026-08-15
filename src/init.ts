// 初始化规范:tester init 把 template/ 拷到当前项目(幂等,已存在不覆盖)
// template/ 在编译后位于 dist/template(由 scripts/build.cjs 拷贝)

import fs from 'fs';
import path from 'path';

const TEMPLATES_DIR = path.join(__dirname, '..', 'template');

export function initProject(): void {
  if (!fs.existsSync(TEMPLATES_DIR)) {
    console.warn(`[tester] 模板目录不存在:${TEMPLATES_DIR}`);
    return;
  }
  copyTree(TEMPLATES_DIR, process.cwd());
}

function copyTree(src: string, dest: string): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    // 发布包里 _gitignore 转回 .gitignore(npm 会排除 .gitignore 文件)
    const name = entry.name === '_gitignore' ? '.gitignore' : entry.name;
    const d = path.join(dest, name);
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyTree(s, d);
    } else if (fs.existsSync(d)) {
      console.log(`[tester] 已存在,跳过:${d}`);
    } else {
      fs.copyFileSync(s, d);
      console.log(`[tester] 已生成:${d}`);
    }
  }
}
