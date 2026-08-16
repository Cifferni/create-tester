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
  },
  {
    re: /:nth-child\(|:nth-of-type\(/,
    fatal: false,
    hint: '脆选择器:靠 nth-child 位置定位,列表增删一行就全错位。建议用 data-testid / 文本 / role。'
  },
  {
    re: /classList\.contains\(|classList\.value/,
    fatal: false,
    hint: '脆断言:直接用 classList 判断样式,改动类名就失效。建议用 toHaveText 业务文案或 toHaveClass(但别依赖 UI 库具体类)。'
  },
  {
    re: /\.click\(\).*\/\/|selfHeal\(page, \[[^\]]*getByText|page\.getByText\([^)]*\)\.first\(\).*click/,
    fatal: false,
    hint: '可能把 getByText 当首选定位:文本定位仅兜底且要求唯一。优先 data-testid / getByRole+name。'
  }
];

// ── 断言强制:「每个用例必须有业务断言」从提示词变成代码强制 ──
// 扫描每个 test('...', async) 块,块内没有任何断言调用(expect/expectApi/toHave*)
// 即"只点不验",致命拦跑。test.beforeEach/afterEach 不算用例,不检查。

// 断言调用特征:expectApi / expect( 及 Playwright 的 toHave* 断言
const ASSERT_RE = /expectApi\(|\bexpect\(|\.toHaveURL\(|\.toHaveText\(|\.toHaveClass\(|\.toBeVisible\(|\.toBeHidden\(|\.toHaveValue\(|\.toContainText\(|\.toBeEnabled\(|\.toBeChecked\(|\.toHaveCount\(|\.toHaveAttribute\(/;

// 按 test(...) 块切分源码,返回 { title, startLine, endLine, body } 列表。
// 只匹配真正的用例:test(' 或 test(" 开头(排除 test.beforeEach 等)。
function extractTestBlocks(src: string): Array<{ title: string; startLine: number; bodyLines: number; hasAssertion: boolean }> {
  const lines = src.split(/\r?\n/);
  const blocks: Array<{ title: string; startLine: number; bodyLines: number; hasAssertion: boolean }> = [];
  // 找 test('...' 开头的行(排除 test.beforeEach/test.afterEach/test.describe)
  const testStart = /^\s*test(?:\.skip|\.only)?\s*\(\s*['"`]/;
  let current: { title: string; startLine: number; hasAssertion: boolean; lastLine: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isStart = testStart.test(line) && !/test\.(beforeEach|afterEach|beforeAll|afterAll|describe)\.?/.test(line);
    if (isStart) {
      if (current) {
        blocks.push({ title: current.title, startLine: current.startLine, bodyLines: current.lastLine - current.startLine, hasAssertion: current.hasAssertion });
      }
      const titleMatch = line.match(/test(?:\.skip|\.only)?\s*\(\s*['"`]([^'"`]+)['"`]/);
      current = { title: titleMatch?.[1] ?? '(未命名)', startLine: i + 1, hasAssertion: false, lastLine: i };
      continue;
    }
    if (current) {
      current.lastLine = i;
      if (!current.hasAssertion && ASSERT_RE.test(line)) current.hasAssertion = true;
    }
  }
  if (current) {
    blocks.push({ title: current.title, startLine: current.startLine, bodyLines: current.lastLine - current.startLine, hasAssertion: current.hasAssertion });
  }
  return blocks;
}

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
  // 断言强制:每个 test 块必须有业务断言,否则"只点不验",致命
  const blocks = extractTestBlocks(src);
  for (const b of blocks) {
    if (b.bodyLines < 2) continue; // 空块/骨架残留忽略
    if (!b.hasAssertion) {
      issues.push({
        file: path.basename(file),
        line: b.startLine,
        text: `第 ${b.startLine} 行「${b.title}」没有业务断言(只点不验):块内未发现 expect/expectApi/toHave* 断言。断言依据=用例文档"预期",不是页面现状。`,
        fatal: true
      });
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
  // 临时 spec 检查:tester_generate_spec 生成的 spec 带 @tester-generated 标记;
  // 没有标记的 .spec 是手写/临时的,警告提示(不拦,可能是录制的合法用例)。
  if (/\.spec\.(ts|js|mjs|tsx|jsx)$/i.test(file)) {
    let src = '';
    try {
      src = fs.readFileSync(file, 'utf8');
    } catch {
      src = '';
    }
    if (src && !/@tester-generated/.test(src)) {
      warnings.push(`${path.basename(file)}:1 未带 @tester-generated 标记(可能是手写/临时 spec)——确认是有意保留的用例,否则让 AI 用 tester_generate_spec 从用例生成。`);
    }
  }
  return { fatal, warnings };
}
