// 用例文件解析:把测试人员的既有用例(Markdown / Excel / XMind / CSV / TXT)转成 AI 可读的结构化文本。
// 只输出文本给下游(MCP convert_case),不解析执行。

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

export function readCaseFile(file: string): string {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case '.xlsx':
    case '.xls':
      return parseExcel(file);
    case '.xmind':
      return parseXmind(file);
    case '.csv':
      return parseCsv(file);
    case '.md':
    case '.markdown':
      return parseMarkdown(file);
    default:
      return fs.readFileSync(file, 'utf8');
  }
}

// ---------- Markdown ----------

function parseMarkdown(file: string): string {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // markdown 表格:收集连续的行,转成 "a | b" 规整文本
    if (/^\|.*\|/.test(trimmed)) {
      const table: string[] = [];
      while (i < lines.length && /^\|.*\|/.test(lines[i].trim())) {
        table.push(lines[i].trim());
        i++;
      }
      // 跳过表头分隔行(|---|)
      const rows = table.filter((r) => !/^\|[\s\-:|]+\|$/.test(r));
      out.push(...rows.map((r) => r.replace(/^\||\|$/g, '').trim()));
      out.push('');
      continue;
    }

    // 去掉 ``` 代码块围栏,只保留内容
    if (/^```/.test(trimmed)) {
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        out.push(lines[i]);
        i++;
      }
      i++;
      continue;
    }

    out.push(line);
    i++;
  }
  return out.join('\n');
}

// ---------- Excel ----------

function parseExcel(file: string): string {
  // 动态加载,避免在非 Excel 场景强制依赖
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx') as typeof import('xlsx');
  const wb = XLSX.readFile(file, { cellDates: false });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false });
    parts.push(`【工作表:${sheetName}】`);
    for (const row of rows) {
      if (!row || !row.length) continue;
      const cells = row.map((c) => String(c ?? '').replace(/\s+/g, ' ').trim());
      if (cells.every((c) => c === '')) continue;
      parts.push(cells.join(' | '));
    }
  }
  return parts.join('\n');
}

// ---------- CSV ----------

function parseCsv(file: string): string {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines.map(parseCsvLine).join('\n');
}

function parseCsvLine(line: string): string {
  const cells: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === ',' || ch === '\t') {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells.join(' | ');
}

// ---------- XMind ----------
// 新版(.xmind)是 zip,内含 content.json(2020+)或 content.xml(旧版)

function parseXmind(file: string): string {
  const entries = readZipEntries(fs.readFileSync(file));
  const jsonKey =
    [...entries.keys()].find((k) => k === 'content.json' || k.endsWith('/content.json'));
  if (jsonKey) {
    return xmindJsonToText(entries.get(jsonKey)!.toString('utf8'));
  }
  const xmlKey =
    [...entries.keys()].find((k) => k === 'content.xml' || k.endsWith('/content.xml'));
  if (xmlKey) {
    return xmindXmlToText(entries.get(xmlKey)!.toString('utf8'));
  }
  return '(无法解析 XMind 文件:未找到 content.json / content.xml)';
}

interface XmindTopic {
  title?: string;
  children?: { attached?: XmindTopic[] };
  notes?: { plain?: { content?: string } };
}

function xmindJsonToText(json: string): string {
  let sheets: unknown;
  try {
    sheets = JSON.parse(json);
  } catch {
    return '(XMind content.json 解析失败)';
  }
  const list = (Array.isArray(sheets) ? sheets : [sheets]) as Array<{ title?: string; rootTopic?: XmindTopic }>;
  const parts: string[] = [];
  for (const sheet of list) {
    if (sheet.title) parts.push(`【画布:${sheet.title}】`);
    if (sheet.rootTopic) walkXmindTopic(sheet.rootTopic, parts, 0);
  }
  return parts.join('\n');
}

function walkXmindTopic(topic: XmindTopic, out: string[], depth: number): void {
  const indent = '  '.repeat(depth);
  if (topic.title) out.push(`${indent}- ${topic.title}`);
  const note = topic.notes?.plain?.content;
  if (note) out.push(`${indent}  备注:${note.replace(/\s+/g, ' ').trim()}`);
  for (const child of topic.children?.attached || []) {
    walkXmindTopic(child, out, depth + 1);
  }
}

interface XmlNode {
  name: string;
  text: string;
  children: XmlNode[];
}

// 极简 XML 解析,只关心标签层级与文本(够用即可,不追求完整标准)
function xmlToNodes(xml: string): XmlNode[] {
  const nodes: XmlNode[] = [];
  const stack: XmlNode[] = [];
  const tagRe = /<([/!]?)([\w:-]+)([^>]*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml)) !== null) {
    if (m.index > last) {
      const text = xml.slice(last, m.index).replace(/\s+/g, ' ').trim();
      if (text && stack.length) stack[stack.length - 1].text += text;
    }
    const closing = m[1] === '/';
    const name = m[2];
    if (m[1] === '!') {
      last = tagRe.lastIndex;
      continue;
    }
    if (closing) {
      stack.pop();
    } else {
      const node: XmlNode = { name, text: '', children: [] };
      if (stack.length) stack[stack.length - 1].children.push(node);
      else nodes.push(node);
      stack.push(node);
    }
    last = tagRe.lastIndex;
  }
  return nodes;
}

function xmindXmlToText(xml: string): string {
  const roots = xmlToNodes(xml);
  const parts: string[] = [];
  const walk = (node: XmlNode, depth: number): void => {
    const indent = '  '.repeat(depth);
    if (node.name === 'title' && node.text) {
      parts.push(`${indent}- ${node.text}`);
    }
    for (const child of node.children) {
      if (child.name === 'topic') walk(child, depth + 1);
      else walk(child, depth);
    }
  };
  for (const root of roots) walk(root, 0);
  return parts.join('\n');
}

// ---------- ZIP(读 .xmind 的 content.*)----------

function readZipEntries(buf: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  const eocdIdx = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdIdx < 0) return entries;
  const entryCount = buf.readUInt16LE(eocdIdx + 10);
  const cdOffset = buf.readUInt32LE(eocdIdx + 16);
  let pos = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    // 读本地文件头,拿到数据起始位置
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(dataStart, dataStart + compSize);
    if (method === 0) {
      entries.set(name, Buffer.from(raw));
    } else if (method === 8) {
      try {
        entries.set(name, zlib.inflateRawSync(raw));
      } catch {
        entries.set(name, raw);
      }
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
