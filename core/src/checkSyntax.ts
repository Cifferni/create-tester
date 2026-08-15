// AI 生成 TS 后轻量语法校验:用 esbuild 只做语法检查(不类型检查、不产出文件),
// 编译异常直接返回可读的错误信息(行/列/原因),避免把无法运行的 spec 交给测试人员。
// 用法:语法有问题抛错(带文件名+位置),正常返回空。

import path from 'path';
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
