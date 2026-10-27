# daikin-notify

大金空气传感器超标时，经 Cloudflare Worker 中转，把通知推到微信。

## 一键部署

点下面的按钮，在你自己的 Cloudflare 账号上部署一个属于你自己的中转（代码从本仓库拉取，部署到你自己的账号，与任何人无关）：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/aliporcins/daikin-notify)

## 部署后：填三个 Secret

部署完成后，到你自己的 Cloudflare 面板 → Workers → daikin-notify → Settings → Variables，添加以下三个 Secret（Secret 只存在你自己的账号里，不会进代码）：

| Secret 名 | 填什么 |
|---|---|
| `PUSH_PROVIDER` | `serverchan` 或 `pushplus`（二选一，用哪个推送服务就填哪个） |
| `PUSH_KEY` | 自己的 ServerChan SendKey，或自己的 PushPlus Token |
| `RELAY_TOKEN` | 自己定的一串中继口令（设备端填同一串；不要与任何其他密码复用） |

## 设备端：填自己的 Worker 地址

在大金传感器的设置页 → 微信通知卡：

1. Worker 地址填自己的 Worker 地址，格式为 `http://你的 Worker 域名/notify`。**必须是 `http://` 开头，不能是 `https://`**（固件没有 TLS，只认 `http://`；填 `https://` 会被固件直接清空）。
2. 中继口令填与上面 `RELAY_TOKEN` 一致的那串口令。
3. 点保存，确认总开关已开，再点测试发送，微信收到测试消息即表示整条链路已通。

## 接口契约

- 设备 → Worker：`POST /notify`，请求头 `X-Relay-Token` 携带中继口令，请求体为 JSON（字段一律小写、数值一律整数，如 `{"device": "daikin_xxx", "kind": "alert", "metric": "hcho", "value": 120, "unit": "ug/m3", "threshold": 80}`）。
- 响应：`200` 成功；`401` 口令错；`400` 请求体非法；`413` 请求体过大（超过 2 KB）；`405` 非 POST 请求。
- 推送文案与单位换算全在 Worker 侧完成；推送密钥只从 Secret 取，绝不进代码、不进固件、不进日志。

## 警告：各人部署各人的

**不要把自己的 Worker 地址与中继口令告诉别人。** 每个人的中转应该自己部署、自己填自己的密钥：别人的超标提醒如果走到你的中转，会推到你的微信、占用你的推送额度；中继口令一旦散出去就等于公开，无法单独收回某一个人的权限。
