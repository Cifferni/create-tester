// AI 生成 TS 后轻量语法校验 + 纪律扫描:
//  1. 语法校验:用 esbuild 只做语法检查(不类型检查、不产出文件),避免把无法运行的 spec 交给测试人员。
//  2. 纪律扫描:用正则扫 spec 源码里的违规模式(硬编码延时/终端 sleep/脆选择器),把"提示词纪律"变成"代码强制"。

import path from 'path';
import fs from 'fs';
import { build, type BuildFailure } from 'esbuild';

export interface SyntaxError {
  file: string;
  line: number;
  column: number;
  text: string;
}

export interface SyntaxCheckResult {
  ok: boolean;
  errors: SyntaxError[];
}

// 纪律问题:致命(拦)或警告(提示)。致命的会阻止运行,警告的允许跑。
export interface DisciplineIssue {
  file: string;
  line: number;
  text: string;
  /** true=致命(停止运行);false=警告(允许跑,给提示) */
  fatal: boolean;
}

// 纪律扫描规则:命中的违规在 run_tests/retry_failed 跑前拦下,让"禁 waitForTimeout/终端 sleep"从提示词变成代码强制。
const DISCIPLINE_RULES: Array<{ re: RegExp; fatal: boolean; hint: string }> = [
  {
    re: /page\.waitForTimeout\(/,
    fatal: true,
    hint: '禁止 page.waitForTimeout(硬编码延时):改用 waitForVisible/waitForClickable/waitForText/waitForURL,等状态不等时间。'
  },
  {
    re: /Start-Sleep|start-sleep/,
    fatal: true,
    hint: '禁止终端 Start-Sleep 等待测试:等测试结果用 tester_wait_result(server 端轮询,不弹终端)。'
  },
  {
    re: /svg\s+path\[d\^=/,
    fatal: false,
    hint: '脆选择器:靠 SVG path 的 d 属性定位,图标一变就失效。建议用 data-testid / getByRole / browser_snapshot 的可访问名。'
  },
  {
    re: /\.n-message\b/,
    fatal: false,
    hint: '可能用了具体 UI 库的 class(如 n-message)做断言,换库会失效。优先用语义断言(toHaveText 匹配业务文案)。'
  }
];

// 扫描一个 TS 文件的纪律违规,返回问题列表(空=干净)
export function scanDiscipline(file: string): DisciplineIssue[] {
  const issues: DisciplineIssue[] = [];
  let src: string;
  try {
    src = fs.readFileSync(file, 'utf8');
  } catch {
    return issues;
  }
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of DISCIPLINE_RULES) {
      if (rule.re.test(line)) {
        issues.push({
          file: path.basename(file),
          line: i + 1,
          text: `第 ${i + 1} 行:${line.trim().slice(0, 80)} — ${rule.hint}`,
          fatal: rule.fatal
        });
      }
    }
  }
  return issues;
}

// 语法校验一个 TS 文件。不真正编译产物(输出到 nul/dev/null 丢弃),只验 AST 能解析。
// esbuild 对"能解析" = 语法合法(类型错误检测不到,那是 tsc 的活,这里保证能跑)。
export async function checkTsSyntax(file: string): Promise<SyntaxCheckResult> {
  try {
    await build({
      entryPoints: [file],
      outfile: path.join(process.cwd(), 'nul').replace(/\\/g, '/'),
      bundle: false,
      write: false,
      platform: 'neutral',
      logLevel: 'silent'
    });
    return { ok: true, errors: [] };
  } catch (e) {
    const err = e as BuildFailure;
    const errors: SyntaxError[] = (err.errors || []).map((x) => ({
      file: x.location?.file ? path.basename(x.location.file) : file,
      line: x.location?.line ?? 0,
      column: x.location?.column ?? 0,
      text: x.text
    }));
    return { ok: false, errors };
  }
}

// 校验并格式化为给 AI 看的文本:语法 OK 返回空串,有问题返回 "文件:行:列 错误"
export async function formatSyntaxErrors(file: string): Promise<string> {
  const r = await checkTsSyntax(file);
  if (r.ok) return '';
  return r.errors.map((e) => `${e.file}:${e.line}:${e.column} ${e.text}`).join('\n');
}

// 语法 + 纪律合并校验。返回 { fatal: 语法错或致命纪律问题, warnings: 纪律警告 }
// 有 fatal 就停止运行;warnings 只提示不影响跑。
export async function checkSpecQuality(file: string): Promise<{
  fatal: string[];
  warnings: string[];
}> {
  const r = await checkTsSyntax(file);
  const fatal: string[] = r.errors.map((e) => `${e.file}:${e.line}:${e.column} ${e.text}`);
  const discipline = scanDiscipline(file);
  for (const d of discipline) {
    if (d.fatal) fatal.push(`${d.file}:${d.line} ${d.text}`);
  }
  const warnings = discipline.filter((d) => !d.fatal).map((d) => `${d.file}:${d.line} ${d.text}`);
  return { fatal, warnings };
}
