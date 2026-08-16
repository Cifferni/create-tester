// DSL 层(轻量中间表示):用例 → 步骤DSL(JSON)→ Playwright 代码。
// 定位:给 AI 生成 spec 一个"稳定的中间契约"——用例逻辑(步骤 DSL)与执行实现(Playwright)解耦,
// 后期要支持多框架/纯接口执行,只加"DSL → X"的新渲染器,不用动用例侧。
// 当前提供:结构化用例文本 → DSL 步骤;DSL 步骤 → Playwright spec 骨架(renderSteps 生成操作代码)。

export type StepAction =
  | 'goto'
  | 'click'
  | 'fill'
  | 'select'
  | 'wait'
  | 'assert_text'
  | 'assert_url'
  | 'assert_element'
  | 'api'
  | 'comment';

export interface DslStep {
  action: StepAction;
  /** 定位目标:data-testid / 文本 / css;assert/click 等用 */
  target?: string;
  /** 输入值(fill/select 用) */
  value?: string;
  /** 等待/断言的期望:文案、URL 正则、接口关键字 */
  expect?: string;
  /** 动作类型 (click/fill/select 等解析时细化) */
  kind?: string;
}

export interface CaseDsl {
  title: string;
  preconditions: string[];
  steps: DslStep[];
  expected: string[];
}

// 从 convert_case 输出的结构化文本(【前置:...】/【操作:...】/【预期:...】)解析成 DSL。
export function parseCaseToDsl(text: string, title = '用例'): CaseDsl {
  const preconditions: string[] = [];
  const steps: DslStep[] = [];
  const expected: string[] = [];
  let opText = '';
  let expectText = '';
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (/前置[:：]/.test(t)) preconditions.push(t.replace(/^.*前置[:：]\s*/, '').trim());
    else if (/操作[:：]/.test(t)) opText = t.replace(/^.*操作[:：]\s*/, '').trim();
    else if (/预期[:：]/.test(t)) expectText = t.replace(/^.*预期[:：]\s*/, '').trim();
  }
  if (opText) steps.push(...parseActionLine(opText));
  if (expectText) expected.push(expectText);
  return { title, preconditions, steps, expected };
}

// 把一行"操作"解析成多个步骤(按分号/句号/换行分隔子句;识别常见动作词)。
function parseActionLine(op: string): DslStep[] {
  const clauses = op
    .split(/[;；。]|\n|(?=\d{1,2}[.、\)])/)
    .map((s) => s.replace(/^\d{1,2}[.、\)]\s*/, '').trim())
    .filter(Boolean);
  const steps: DslStep[] = [];
  for (const c of clauses) {
    if (/^(打开|进入|访问|前往)/.test(c)) {
      const url = c.replace(/^(打开|进入|访问|前往)/, '').replace(/^['"]|['"]$/g, '').trim();
      steps.push({ action: 'goto', target: url || '/' });
    } else if (/^点击/.test(c)) {
      const target = c.replace(/^点击/, '').trim();
      steps.push({ action: 'click', target, kind: 'click' });
    } else if (/^(输入|填写|填入|填)/.test(c)) {
      const p = parseFill(c);
      steps.push({ action: 'fill', target: p.target, value: p.value, kind: 'fill' });
    } else if (/^选择/.test(c)) {
      steps.push({ action: 'select', target: c.replace(/^选择/, '').trim(), kind: 'select' });
    } else if (/^(等待|等)/.test(c)) {
      steps.push({ action: 'wait', expect: c.replace(/^(等待|等)/, '').trim(), kind: 'wait' });
    } else if (/^(断言|验证|校验|确认|检查)/.test(c)) {
      steps.push({ action: 'assert_text', expect: c.replace(/^(断言|验证|校验|确认|检查)/, '').trim(), kind: 'assert' });
    } else if (c) {
      steps.push({ action: 'comment', expect: c });
    }
  }
  return steps;
}

// 解析"输入"子句,支持:
//   输入"值"到"目标"  / 输入"值"到目标
//   输入"目标"为"值"   / 输入目标为"值"
function parseFill(c: string): { target: string; value: string } {
  const q = /["'「『]([^"'」』]+)["'」』]/g;
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = q.exec(c))) parts.push(m[1]);
  const rest = c.replace(/["'「『]([^"'」』]+)["'」』]/g, '').replace(/^(输入|填写|填入|填)\s*/, '').trim();
  const toMatch = rest.match(/^(到|至|在)\s*(.+)$/);
  const asMatch = rest.match(/^(为|是|=|:[:：]?)\s*(.+)$/);
  if (parts.length >= 2) {
    return { value: parts[0], target: parts[1] };
  }
  if (toMatch) {
    return { value: parts[0] || '', target: toMatch[2].trim() };
  }
  if (asMatch) {
    return { value: asMatch[2].trim(), target: parts[0] || '' };
  }
  if (parts.length === 1) {
    return { target: parts[0], value: '' };
  }
  return { target: rest, value: '' };
}

// DSL → Playwright 代码:渲染每个步骤的操作代码片段(骨架内嵌)。
export function dslToCode(dsl: CaseDsl): string {
  const lines: string[] = [];
  for (const s of dsl.steps) {
    switch (s.action) {
      case 'goto':
        lines.push(`  await page.goto('${s.target || '/'}');`);
        break;
      case 'click':
        lines.push(`  await selfHeal(page, ['${s.target}']).then((el) => el.click()); // 点击:${s.target}(可给 selfHeal 加文本/role 候选)`);
        break;
      case 'fill':
        lines.push(`  await selfHeal(page, ['${s.target}']).then((el) => el.fill('${s.value || ''}')); // 输入:${s.value} 到 ${s.target}`);
        break;
      case 'select':
        lines.push(`  await selfHeal(page, ['${s.target}']).then((el) => el.selectOption('${s.value || ''}'));`);
        break;
      case 'wait':
        lines.push(`  await waitForText(page, '${s.expect || ''}'); // 等待:${s.expect}`);
        break;
      case 'assert_text':
        lines.push(`  await expect(page.getByText('${s.expect || ''}')).toBeVisible(); // 断言:${s.expect}`);
        break;
      case 'assert_url':
        lines.push(`  await expect(page).toHaveURL(/${s.expect || '.*'}/);`);
        break;
      case 'comment':
        lines.push(`  // ${s.expect || ''}`);
        break;
      default:
        break;
    }
  }
  return lines.join('\n');
}

// 从用例"预期"生成断言代码:URL 命中 → toHaveURL;文案 → toHaveText;接口关键字 → expectApi 占位。
export function dslToAssertions(dsl: CaseDsl): string {
  if (!dsl.expected.length) return '  // ⚠ 用例没有"预期"列,请补充业务断言(禁止只点不验)';
  const lines: string[] = [];
  for (const exp of dsl.expected) {
    const e = exp.trim();
    if (!e) continue;
    if (/^(http|https|\/)/.test(e)) {
      lines.push(`  await expect(page).toHaveURL(/${escapeRegExp(e)}/); // 预期跳转:${e}`);
    } else if (/\/api\//.test(e)) {
      lines.push(`  // 预期接口:${e}(用 apiRecorder 捕获后断言,如 expectApi(api, '${e}').code('0'))`);
    } else {
      lines.push(`  await expect(page.getByText('${e}')).toBeVisible(); // 预期文案:${e}`);
    }
  }
  return lines.join('\n');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
