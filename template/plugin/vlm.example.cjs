// VLM 视觉定位插件示例(type:'locatorVlm')。
// 作用:语义定位(selfHeal 多候选)全部失败时,自动降级用视觉模型按坐标定位,成功后反哺选择器缓存。
// 使用:
//   1) 本文件复制为 plugin/vlm.cjs
//   2) tester.config.ts 对应环境的 vlm 块填 enabled/model/apiUrl;.env.<环境> 里填 TESTER_VLM_API_KEY
// 说明:开关/模型/地址/超时在 tester.config.ts 配,key 走 .env.<环境> 的 TESTER_VLM_API_KEY,这里的代码直接用就行,不需要再改。

// 兼容 OpenAI 风格的视觉模型接口(通义/GLM/GPT 等大多支持):
//   发截图 + 问"目标在页面什么坐标",模型返回 JSON,里面有个坐标文本。
async function locateVlm(page, target, cfg) {
  // 1) 截当前页面
  const buf = await page.screenshot({ type: 'png' });
  const base64 = buf.toString('base64');
  // 2) 发给视觉模型,让它返回目标坐标
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs); // 插件自己也限时,配合内核兜底
  let res;
  try {
    res = await fetch(cfg.apiUrl, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: `请在这张页面截图里找到"${target}",返回它在图片中的像素坐标,格式严格为 JSON:{"x":数字,"y":数字}` },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } }
            ]
          }
        ],
        temperature: 0
      })
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res || !res.ok) return null;
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  // 3) 从模型回答里抠出 {x, y}
  const m = text.match(/\{\s*"x"\s*:\s*(\d+)\s*,\s*"y"\s*:\s*(\d+)\s*\}/);
  if (!m) return null;
  return { x: Number(m[1]), y: Number(m[2]) };
}

module.exports = {
  name: 'vlm-openai-compatible',
  type: 'locatorVlm',
  locateVlm
};
