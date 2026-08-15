// 轻量 Web 查看面板(只读):本地起一个静态页,展示 test-result/test-results.json 的测试结果。
// 定位:给测试人员一个不用开编辑器就能看结果的页面;只读,不做编辑,保持轻量零依赖。

import fs from 'fs';
import path from 'path';
import http from 'http';
import { summarizeJsonReport } from './playwright';

export interface WebViewOptions {
  /** 工程根目录,缺省 process.cwd() */
  projectRoot?: string;
  /** 监听端口,缺省 8321 */
  port?: number;
}

// 启动只读结果页,返回 { url, close }。页面定时刷新 test-result/test-results.json。
export function startWebView(opts: WebViewOptions = {}): Promise<{ url: string; close: () => void }> {
  const root = opts.projectRoot || process.cwd();
  const port = opts.port || 8321;
  const reportFile = path.join(root, 'test-result', 'test-results.json');

  const server = http.createServer((req, res) => {
    const url = (req.url || '').split('?')[0];
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderHtml());
      return;
    }
    if (url === '/data') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(readReportJson());
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  function readReportJson(): string {
    try {
      if (!fs.existsSync(reportFile)) {
        return JSON.stringify({ error: '报告不存在(test-result/test-results.json),先跑一次测试' });
      }
      const raw = fs.readFileSync(reportFile, 'utf8');
      const s = summarizeJsonReport(raw);
      return JSON.stringify(s || { error: '报告解析失败' });
    } catch (e) {
      return JSON.stringify({ error: String((e as Error).message) });
    }
  }

  return new Promise((resolve) => {
    server.listen(port, () => {
      resolve({
        url: `http://localhost:${port}/`,
        close: () => server.close()
      });
    });
  });
}

// 只读结果页:单文件 HTML,内嵌样式/脚本,自动轮询 /data。
function renderHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>测试结果</title>
<style>
  body{font-family:-apple-system,Segoe UI,Microsoft YaHei,sans-serif;margin:24px;color:#1f2328;background:#f6f8fa}
  h1{font-size:20px}.bar{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}
  .stat{background:#fff;border:1px solid #d0d7de;border-radius:8px;padding:10px 18px;min-width:90px}
  .stat b{display:block;font-size:24px}.pass b{color:#1a7f37}.fail b{color:#cf222e}
  .skip b{color:#57606a}.warn b{color:#9a6700}
  .card{background:#fff;border:1px solid #d0d7de;border-radius:8px;padding:14px 18px;margin:10px 0}
  .case{margin:6px 0}.case.failed{border-left:4px solid #cf222e;padding-left:10px}
  .case.passed{border-left:4px solid #1a7f37;padding-left:10px}
  .tag{display:inline-block;font-size:12px;padding:1px 8px;border-radius:10px;margin-left:8px;color:#fff}
  .tag.failed{background:#cf222e}.tag.passed{background:#1a7f37}
  pre{background:#0d1117;color:#c9d1d9;padding:12px;border-radius:8px;overflow:auto;font-size:12px;max-height:300px}
  .error{margin-top:8px;color:#57606a;font-size:13px}
  .refresh{color:#57606a;font-size:12px;margin-bottom:8px}
</style>
</head>
<body>
  <h1>测试结果</h1>
  <div class="refresh" id="refresh"></div>
  <div class="bar" id="stats"></div>
  <div id="list"></div>
<script>
async function load() {
  try {
    const r = await fetch('/data');
    const d = await r.json();
    render(d);
  } catch { document.getElementById('refresh').textContent = '面板未就绪(等测试跑出报告)'; }
}
function render(d) {
  document.getElementById('refresh').textContent = '刷新时间 ' + new Date().toLocaleTimeString();
  if (d.error) {
    document.getElementById('stats').innerHTML = '<div class="error">' + d.error + '</div>';
    document.getElementById('list').innerHTML = '';
    return;
  }
  document.getElementById('stats').innerHTML =
    '<div class="stat pass"><b>' + (d.passed||0) + '</b>通过</div>' +
    '<div class="stat fail"><b>' + (d.failed||0) + '</b>失败</div>' +
    '<div class="stat skip"><b>' + (d.skipped||0) + '</b>跳过</div>' +
    '<div class="stat"><b>' + (d.total||0) + '</b>共</div>' +
    '<div class="stat"><b>' + Math.round((d.durationMs||0)/1000) + 's</b>耗时</div>';
  const list = document.getElementById('list');
  list.innerHTML = '';
  const failures = d.failures || [];
  if (!failures.length) {
    list.innerHTML = '<div class="card">全部通过</div>';
    return;
  }
  for (const f of failures) {
    const el = document.createElement('div');
    el.className = 'case failed';
    el.innerHTML = '<strong>' + (f.title||'(未命名)') + '</strong>' +
      '<span class="tag failed">' + (f.category||'其他') + '</span>' +
      (f.error && f.error !== '(无错误信息)' ? '<pre>' + escapeHtml(f.error) + '</pre>' : '') +
      (f.stdout ? '<pre>' + escapeHtml(f.stdout) + '</pre>' : '');
    list.appendChild(el);
  }
}
function escapeHtml(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
load(); setInterval(load, 3000);
</script>
</body>
</html>`;
}
