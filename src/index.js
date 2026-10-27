// daikin-notify: 大金空气传感器 → 微信通知中继 Worker（Cloudflare Workers）
// 契约：POST /notify，头 X-Relay-Token 比对 Secret RELAY_TOKEN；体为 JSON（整数值，不含中文文案）。
// 推送密钥只从 Worker Secret（PUSH_KEY）取，绝不进代码、不进固件、不进日志。
// 转发格式按 ServerChan / PushPlus 公开文档实现；PUSH_KEY 未配置时回 502，不伪造成功。

const KINDS = ["alert", "recovered", "repeat", "test"];
const METRICS = ["co2", "hcho", "tvoc"];
const CN = { co2: "二氧化碳", hcho: "甲醛", tvoc: "TVOC" };

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function fmtValue(metric, v) {
  if (metric === "co2") return `${v} ppm`;
  return `${(v / 1000).toFixed(2)} mg/m³`;
}

function titleFor(kind, metric, value, threshold) {
  const name = CN[metric] || metric;
  const val = fmtValue(metric, value);
  const thr = fmtValue(metric, threshold);
  if (kind === "alert") return `${name}超标 ${val}（阈值 ${thr}）`;
  if (kind === "recovered") return `${name}已回落 ${val}`;
  if (kind === "repeat") return `${name}仍超标 ${val}（持续提醒）`;
  return "微信通知测试";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/notify") {
      return json({ ok: false, error: "not_found" }, 404);
    }
    if (request.method !== "POST") {
      return json({ ok: false, error: "method" }, 405);
    }
    let text;
    try {
      text = await request.text();
    } catch {
      return json({ ok: false, error: "bad_body" }, 400);
    }
    if (text.length > 2048) {
      return json({ ok: false, error: "too_large" }, 413);
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ ok: false, error: "bad_json" }, 400);
    }
    const { device, kind, metric, value, threshold, unit } = body || {};
    if (
      typeof device !== "string" || !device ||
      !KINDS.includes(kind) ||
      !METRICS.includes(metric) ||
      !Number.isInteger(value) ||
      !Number.isInteger(threshold) ||
      (unit !== "ppm" && unit !== "ug/m3")
    ) {
      return json({ ok: false, error: "bad_fields" }, 400);
    }
    if (!safeEqual(request.headers.get("X-Relay-Token") || "", env.RELAY_TOKEN || "")) {
      return json({ ok: false, error: "auth" }, 401);
    }
    const provider = env.PUSH_PROVIDER || "";
    const key = env.PUSH_KEY || "";
    if ((provider !== "serverchan" && provider !== "pushplus") || !key) {
      return json({ ok: false, error: "push_not_configured" }, 502);
    }
    const now = new Date(Date.now() + 8 * 3600 * 1000);
    const tsText = now.toISOString().replace("T", " ").slice(0, 19) + "（UTC+8）";
    const title = titleFor(kind, metric, value, threshold);
    const kindNote =
      kind === "test" ? "这是设置页测试发送，用于验证整条链路。" :
      kind === "recovered" ? "已连续两次采样低于阈值，确认回落。" :
      kind === "repeat" ? "持续超标，每 60 分钟提醒一次。" : "首次越阈提醒。";
    const content =
      `设备：${device}\n指标：${CN[metric]}\n当前：${fmtValue(metric, value)}\n阈值：${fmtValue(metric, threshold)}\n时间：${tsText}\n${kindNote}`;
    try {
      let ok = false;
      if (provider === "serverchan") {
        const form = new URLSearchParams({ title, desp: content });
        const r = await fetch(`https://sctapi.ftqq.com/${encodeURIComponent(key)}.send`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form.toString(),
        });
        ok = r.ok;
      } else {
        const r = await fetch("https://www.pushplus.plus/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: key, title, content, template: "txt" }),
        });
        ok = r.ok;
      }
      if (!ok) {
        console.log("forward failed provider=" + provider);
        return json({ ok: false, error: "forward_failed" }, 502);
      }
    } catch (e) {
      console.log("forward error provider=" + provider);
      return json({ ok: false, error: "forward_failed" }, 502);
    }
    return json({ ok: true }, 200);
  },
};
