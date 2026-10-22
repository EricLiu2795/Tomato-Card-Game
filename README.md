# 🍅 番茄牌局 · Tomato Card Club

朋友之间的中文在线牌桌：四人掼蛋、三人斗地主，权威服务端、独立私牌、断线重连、语音表情和扔番茄。积分仅记录一局结果，没有货币、下注或付费 API。

## 本地启动

需要 Node.js 22.12+（本次使用 24.19.0）、npm、现代浏览器。无需 Cloudflare 登录或密钥。

```bash
git clone https://github.com/EricLiu2795/Tomato-Card-Game.git
cd Tomato-Card-Game
git switch feat/first-playable
npm ci
npm run build
npm run dev
```

打开 **http://127.0.0.1:5173**。创建房间、复制邀请链接；其余玩家通过不同浏览器配置/设备加入，选择昵称和座位，全部准备后房主开局。单机模拟多位玩家请使用不同浏览器隐私上下文；同一浏览器配置共享同一房间身份，新页面会接管旧连接。

- 前端 Vite：5173。后端 Wrangler：8787，使用本地 Durable Objects 和 `.wrangler/state/` 持久化。
- 开发代理只转发 `/api/`。`wrangler dev` 的调试器与 Local Explorer 是开发者管理工具，仅限可信本机；不要把开发端口公开给不可信网络。多人远程访问需要自行批准并部署 Worker，本次没有执行部署。
- 保持访问主机名一致，不要混用 `localhost` 与 `127.0.0.1`。重连身份由浏览器 HttpOnly Cookie 保存；清除 Cookie 会丢失座位恢复能力。
- 在限制 HOME 写入的沙箱中可运行 `npm ci --cache /tmp/tomato-npm-cache`，并用 `XDG_CONFIG_HOME=/tmp/tomato-config WRANGLER_SEND_METRICS=false npm run dev` 启动。

## 验证

```bash
npm run typecheck
npm run lint
npm test
npm run build
# 另一个终端保持 npm run dev 运行，然后：
npm run test:integration
npm run test:persistence
npm run test:e2e
```

单元测试使用确定性牌序；集成测试连接真实本地 Wrangler；Playwright 使用三个或四个独立浏览器上下文，通过正常界面完成牌局、重连、互动和下一副进贡。

浏览器测试优先使用 `/usr/bin/chromium`（若存在）。其他系统先执行 `npx playwright install chromium` 使用 Playwright 自带浏览器，或设置 `CHROMIUM_PATH=/实际路径/Chromium`。`E2E_BASE_URL`、`TEST_API_URL` 可覆盖前后端测试地址。截图与报告在 `artifacts/`。不要反复每秒执行测试：入口限流是实际功能，频繁重跑可能需要等待一分钟。

## 规则和操作

- 一个人也能玩：大厅选择掼蛋或斗地主，点「单人练习」直接开始。电脑按同一套规则陪练，搭档会配合让牌，支持结算后再来一局；练习刷新后重开，不连接在线房间。
- 「提示」会选中一手合法推荐，再点一次换一手；确认后点击出牌。按钮会检查牌型与压制关系，桌边小抄随阶段更新。非输入区域可用 H 提示、Esc 取消选择，点击卡牌或提示按钮后也可用；Enter 在按钮上保留原生点击行为，在页面空白处可出牌。
- [掼蛋方言、升级、进贡和双贡自由弃牌](docs/GUANDAN_RULES.md)
- [斗地主叫分、牌型和计分](docs/DOUDIZHU_RULES.md)
- 掼蛋使用两副有独立 ID 的 108 张牌。只有本局红桃级牌是逢人配。双贡自由弃牌默认开启，仅在完成实际双贡及还贡后，每位进贡者可弃任意一张牌或跳过；抗贡时不触发。
- 斗地主所有人不叫会安全重新洗牌，3 分立即确定地主。积分按底分、炸弹和春天计算，整局只结算一次。
- 选牌后点击出牌；可排序、不出或按提示完成叫分/进贡。移动端手牌自动分行，横屏可纵向滚动查看；选中的牌有抬升和勾选标记。
- 音效默认关闭，点击声音按钮解锁。10 条语音表情使用本地 Mandarin 神经语音片段，按情绪搭配不同声音、语速和音调；不依赖设备自带的朗读器。设置面板可私下试听。发牌、选牌、出牌、轮到你、炸弹、胜负和番茄有独立音效；静音立即停止，轻声模式用柔和提示音替代语音。
- 番茄模式下点击其他玩家头像；全房同步动画，每位玩家 3 秒冷却。表情/语音共用 1.5 秒冷却。

## 代码布局

```text
client/             React 牌桌、手牌、音效与动画
shared/             纯 TypeScript 牌型/回合状态机、卡牌、协议
server/             Worker 路由、Durable Object 房间、会话与公开投影
tests/              单元、真实 WebSocket 集成与多浏览器测试
public/sounds/      原创音效、授权说明和添加说明
docs/               方言、架构、限制和测试结果
wrangler.jsonc      Worker + SQLite Durable Object + 静态资源配置
```

## 设计参考

本轮改进研究了 [Big Two 的出牌、过牌和提示流程](https://onlinecardgames.io/big-two/)、[Board Game Arena 的 Tichu 搭档与跟牌玩法](https://en.boardgamearena.com/gamepanel?game=tichu)、[BGA 的教程入口](https://en.boardgamearena.com/news?id=572)，以及 [JJ 掼蛋的搭档升级与逢人配规则](https://www.jj.cn/news/320/20120613160600024346.shtml)。借鉴的是清晰的操作、随手可查的规则与搭档协作；本站保留自己的规则方言，插画与界面使用项目原有 SVG 和原创 CSS。

界面以深绿绒布、奶油纸牌和番茄色操作为主，增加电脑练习入口、搭档标识、少牌提示、出牌动效及结算彩纸，并尊重系统减少动态效果设置。`client/practice.ts` 包装现有状态机，`shared/move-assistance.ts` 只从当前手牌与公开牌局生成推荐；在线房间协议不变。

## Cloudflare 部署配置

配置已包含 `Room`、`RateLimiter` 的 SQLite Durable Object 迁移、静态资源绑定、SPA 回退和空房过期变量 `ROOM_TTL_SECONDS`（默认 86400 秒）。`npm run build` 后可用 `npx wrangler deploy --dry-run --outdir artifacts/worker-dry-run` 仅生成部署包。正式部署需要仓库所有者自行确认 Cloudflare 账户、配额和成本并执行 `npx wrangler deploy`；本任务没有部署、创建凭据或开通付费服务。

生产中静态资源和 `/api/` 同源；HTTPS 下会话 Cookie 自动增加 `Secure`。不需要服务端 Secret，也没有任何 Secret 被打包至前端。

详见 [架构与安全边界](docs/ARCHITECTURE.md)、[已知限制](docs/KNOWN_LIMITATIONS.md)、[实测结果](docs/TEST_RESULTS.md)。
