# 架构与安全边界

## 一条权威命令流

浏览器只发送命令 `{ id, expectedRevision, action }`。Worker 按八位随机房间码路由到唯一的 Room Durable Object；每个房间显式串行处理 HTTP、WebSocket、关闭回调与过期闹钟。纯规则模块负责牌型、轮次、所有权、出完顺序和阶段转换。接受操作前执行实体牌守恒校验，防止重复、丢牌或篡改牌面。

所有游戏变化先作用于克隆状态；校验通过后，在同一 Durable Object storage transaction 中写入房间状态、命令回执和过期闹钟。事务成功后才替换内存状态、确认命令并发送快照。拒绝的游戏命令不会部分交换贡牌、弃牌或重复计分。

## 身份与重连

创建/加入时服务器生成 256 bit 加密随机 token，只存其 SHA-256。浏览器通过房间专属 HttpOnly、SameSite=Strict、路径限定 Cookie 持有原 token；HTTPS 使用 Secure。昵称不是身份凭据。Cookie 不在 localStorage、URL、日志、快照或前端状态中。

同一身份只保留一个有效 WebSocket，连接拥有随机 connectionId；新连接持久化成功后才关闭旧连接。每条消息把 socket 附件中的 playerId/connectionId 与持久化记录匹配，忽略客户端伪造的 seat/playerId。跨源 WebSocket/浏览器写请求被拒绝。房间码是邀请入口，不是身份凭据。

`acceptWebSocket`、`serializeAttachment`、`webSocketMessage` 使用 [Cloudflare Hibernation API](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)。构造器用 `blockConcurrencyWhile` 恢复状态；真实连接从 `getWebSockets()` 重建。`ping`/`pong` 可由自动响应处理。客户端断线退避重连并收到同座位个性化快照。

## 私牌投影

`server/state.ts` 使用明确允许列表：公开玩家字段、当前出牌、名次、公开历史和本连接自己的手牌。禁止序列化完整 Player 或 GameState。斗地主叫分前底牌不可见；叫分后底牌按规则公开。进贡的公开贡牌可见，尚未完成交换的还牌不公开；私有选择 ID 只暴露为已提交状态。

其他手牌、tokenHash、connectionId、随机信息、底层状态和去重回执都没有客户端接口。没有测试牌序、调试发牌、强制获胜接口或 window 状态钩子。客户端所用规则函数只能看到它已合法收到的数据。服务器不记录帧、牌或凭据。

Wrangler 自带开发调试器属于本机开发者权限边界，不是应用接口。只通过 Vite 的 `/api/` 代理访问游戏；生产静态包没有该调试工具。服务器运维者能够访问其服务器存储，这不是端到端加密应用。

## 去重、限流与资源上限

- 每位玩家+命令 ID 持久化回执及规范化命令指纹；相同命令重试返回原回执，改变内容复用 ID 被拒绝。回执在房间生命周期中不淘汰。状态版本不一致会拒绝并发送自己的最新快照。
- 串行队列+版本比较确保并发同版本游戏命令最多提交一个。社交事件不改变游戏版本；事件自己仍有回执和冷却。
- 入口按来源 IP 经独立 Durable Object 限流：创建 8/分钟、加入 24/分钟、连接 60/分钟。没有 CF-Connecting-IP 的本地请求共享一个开发配额。
- 每位玩家最多 20 条消息/秒（错误消息也计入）；语音/表情 1.5 秒冷却，番茄 3 秒。过大帧、未知动作、无效牌/目标会拒绝。
- 请求体在进入房间队列前限制为 2048 字节并设置 5 秒读取上限。命令限制 4096 字符，最多选择 27 张牌。
- 持久化保留最近 200 条公开动作，快照最多 100 条；累计 100,000 个接受命令后需要新建房间，以限制永久去重记录的规模。无变化的准备/换座不会消耗回执。
- 无连接房间达到 `ROOM_TTL_SECONDS` 后删除房间、回执和牌。在线房间继续保留。浏览器清除 Cookie 后不能靠昵称夺回座位。

## 卡牌区域

牌具有 deck/suit/rank 唯一 ID。掼蛋：四手牌 + 已出牌 + 房规弃牌 = 108 张。斗地主叫分时：三手牌 + 底牌 = 54；确定地主后：三手牌 + 已出牌 = 54（公开底牌只是引用）。历史、当前一手和贡牌字段都是卡牌引用，不重复计算为持有区域。

标准掼蛋逻辑位于 `shared/guandan.ts`；双贡自由弃牌独立位于 `shared/house-rule.ts`。原子交换、弃牌/跳过完成标记、队伍级数和结算都持久化。

## 互动和素材

`shared/soundboard.ts` 是唯一事件注册表；服务端只认可已注册 ID。房间广播 sender、target、eventId，客户端渲染气泡/番茄并按本地声音和 reduced-motion 设置播放。社交事件不会改变牌局胜负或手牌。语音为普通浏览器 TTS 或明确配置的授权本地音频，不下载访谈片段，也不克隆声音。
