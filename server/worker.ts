import { DurableObject } from "cloudflare:workers";
import { createGuandan, applyGuandan } from "../shared/guandan";
import { createDoudizhu, applyDoudizhu } from "../shared/doudizhu";
import { REACTIONS } from "../shared/soundboard";
import { assertCardConservation } from "../shared/invariants";
import type {
  Command,
  GameAction,
  ReactionEvent,
  ServerMessage,
} from "../shared/types";
import { snapshot, type Player, type RoomState } from "./state";
import {
  cookieName,
  hash,
  json,
  nickname,
  parseCommand,
  randomToken,
  readCookie,
  readJson,
} from "./validation";
interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  LIMITER: DurableObjectNamespace<RateLimiter>;
  ASSETS: Fetcher;
  ROOM_TTL_SECONDS: string;
}
interface Attachment {
  playerId: string;
  connectionId: string;
}
interface Receipt {
  fingerprint: string;
  revision: number;
}
const ROOM_CODE = /^[A-HJ-NP-Z2-9]{8}$/;
function originAllowed(request: Request): boolean {
  const origin = request.headers.get("Origin");
  // Non-browser HTTP clients still require the session cookie. WebSockets always require Origin.
  if (!origin)
    return request.headers.get("Upgrade")?.toLowerCase() !== "websocket";
  return origin === new URL(request.url).origin;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (!originAllowed(request)) return json({ error: "来源不允许" }, 403);
    if (url.pathname === "/api/health") return json({ ok: true });
    const create = url.pathname === "/api/rooms" && request.method === "POST";
    const match = url.pathname.match(
      /^\/api\/rooms\/([A-HJ-NP-Z2-9]{8})\/(join|ws)$/,
    );
    if (!create && !match) return json({ error: "接口不存在" }, 404);
    if (
      request.method === "POST" &&
      Number(request.headers.get("Content-Length") ?? 0) > 2048
    )
      return json({ error: "请求过大" }, 413);
    const ip = request.headers.get("CF-Connecting-IP") ?? "local";
    const key = await hash(ip);
    const limited = await env.LIMITER.getByName(key).fetch(
      new Request("https://limiter/check", {
        method: "POST",
        body: JSON.stringify({ kind: create ? "create" : match?.[2] }),
      }),
    );
    if (!limited.ok) return limited;
    // Buffer a small, time-bounded body before entering the room's serialized queue.
    let forwarded = request;
    if (request.method === "POST") {
      try {
        forwarded = new Request(request, {
          body: JSON.stringify(await readJson(request)),
        });
      } catch (error) {
        return json(
          {
            error:
              error instanceof SyntaxError
                ? "请求格式错误"
                : error instanceof Error
                  ? error.message
                  : "请求失败",
          },
          400,
        );
      }
    }
    if (create) {
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const code = Array.from(
        crypto.getRandomValues(new Uint8Array(8)),
        (n) => alphabet[n % 32],
      ).join("");
      return env.ROOMS.getByName(code).fetch(
        new Request(new URL(`/api/rooms/${code}/create`, url), forwarded),
      );
    }
    return env.ROOMS.getByName(match![1]).fetch(forwarded);
  },
} satisfies ExportedHandler<Env>;

/** Persistent per-IP ingress window, independent of evictable Worker memory. */
export class RateLimiter extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as { kind: string };
    const now = Date.now();
    const limit = body.kind === "create" ? 8 : body.kind === "join" ? 24 : 60;
    const allowed = await this.ctx.storage.transaction(async (txn) => {
      const times = ((await txn.get<number[]>(body.kind)) ?? []).filter(
        (t) => now - t < 60000,
      );
      if (times.length >= limit) return false;
      times.push(now);
      await txn.put(body.kind, times);
      return true;
    });
    await this.ctx.storage.setAlarm(now + 120000);
    return allowed
      ? json({ ok: true })
      : json({ error: "操作太频繁，请稍后再试" }, 429, { "Retry-After": "60" });
  }
  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}

/** One room, one authoritative serialized command stream. No RPC/debug state methods. */
export class Room extends DurableObject<Env> {
  private room: RoomState | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<RoomState>("room")) ?? null;
    });
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }
  private connected(): Set<string> {
    return new Set(
      this.ctx
        .getWebSockets()
        .filter((ws) => {
          const a = ws.deserializeAttachment() as Attachment;
          return (
            ws.readyState === 1 &&
            this.room?.players.some(
              (p) => p.id === a.playerId && p.connectionId === a.connectionId,
            )
          );
        })
        .map((ws) => (ws.deserializeAttachment() as Attachment).playerId),
    );
  }
  private async commit(
    next: RoomState,
    receipt?: { key: string; value: Receipt },
  ) {
    await this.ctx.storage.transaction(async (txn) => {
      await txn.put("room", next);
      if (receipt) await txn.put(receipt.key, receipt.value);
      await txn.setAlarm(next.lastActive + this.ttl());
    });
    this.room = next;
  }
  private ttl() {
    return Math.max(60, Number(this.env.ROOM_TTL_SECONDS) || 86400) * 1000;
  }
  private send(ws: WebSocket, value: ServerMessage) {
    try {
      ws.send(JSON.stringify(value));
    } catch {
      /* Close/error handler marks presence; never log payloads. */
    }
  }
  private broadcast() {
    if (!this.room) return;
    const connected = this.connected();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment;
      if (
        connected.has(a.playerId) &&
        this.room.players.some(
          (p) => p.id === a.playerId && p.connectionId === a.connectionId,
        )
      )
        this.send(ws, snapshot(this.room, a.playerId, connected));
    }
  }
  private async identity(request: Request): Promise<Player | undefined> {
    if (!this.room) return;
    const token = readCookie(request, this.room.code);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return;
    const tokenHash = await hash(token);
    return this.room.players.find((p) => p.tokenHash === tokenHash);
  }
  async fetch(request: Request): Promise<Response> {
    return this.serial(async () => {
      try {
        const path = new URL(request.url).pathname;
        const code = path.split("/")[3];
        if (!ROOM_CODE.test(code)) return json({ error: "房间号无效" }, 400);
        const operation = path.split("/")[4];
        if (operation === "create" && request.method === "POST") {
          if (this.room) return json({ error: "房间已存在，请重试" }, 409);
          const body = await readJson(request);
          if (body.kind !== "guandan" && body.kind !== "doudizhu")
            return json({ error: "游戏类型无效" }, 400);
          const name = nickname(body.name),
            token = randomToken(),
            id = crypto.randomUUID();
          const next: RoomState = {
            schema: 1,
            code,
            kind: body.kind,
            revision: 0,
            hostId: id,
            players: [
              {
                id,
                name,
                seat: 0,
                ready: false,
                tokenHash: await hash(token),
                connectionId: null,
                lastReaction: 0,
                lastTomato: 0,
                actionTimes: [],
              },
            ],
            game: null,
            houseRule: body.houseRule !== false,
            lastActive: Date.now(),
          };
          await this.commit(next);
          return this.sessionResponse(request, id, token);
        }
        if (!this.room) return json({ error: "房间不存在或已过期" }, 404);
        if (
          this.room.lastActive + this.ttl() < Date.now() &&
          !this.connected().size
        ) {
          await this.ctx.storage.deleteAll();
          this.room = null;
          return json({ error: "房间已过期" }, 410);
        }
        if (operation === "join" && request.method === "POST") {
          const current = await this.identity(request);
          if (current) return json({ roomCode: code, playerId: current.id });
          if (this.room.game)
            return json({ error: "牌局已开始，不能加入" }, 409);
          const seats = this.room.kind === "guandan" ? 4 : 3;
          if (this.room.players.length >= seats)
            return json({ error: "房间已满" }, 409);
          const name = nickname((await readJson(request)).name),
            token = randomToken(),
            id = crypto.randomUUID();
          const seat = Array.from({ length: seats }, (_, i) => i).find(
            (i) => !this.room!.players.some((p) => p.seat === i),
          )!;
          const next = structuredClone(this.room);
          next.players.push({
            id,
            name,
            seat,
            ready: false,
            tokenHash: await hash(token),
            connectionId: null,
            lastReaction: 0,
            lastTomato: 0,
            actionTimes: [],
          });
          next.revision++;
          next.lastActive = Date.now();
          await this.commit(next);
          this.broadcast();
          return this.sessionResponse(request, id, token);
        }
        if (operation === "ws" && request.method === "GET") {
          if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
            return json({ error: "需要 WebSocket" }, 426);
          const player = await this.identity(request);
          if (!player) return json({ error: "会话无效，请加入房间" }, 401);
          const pair = new WebSocketPair(),
            client = pair[0],
            server = pair[1];
          const old = this.ctx.getWebSockets(player.id);
          const next = structuredClone(this.room),
            connectionId = crypto.randomUUID();
          next.players.find((p) => p.id === player.id)!.connectionId =
            connectionId;
          this.ctx.acceptWebSocket(server, [player.id]);
          server.serializeAttachment({
            playerId: player.id,
            connectionId,
          } satisfies Attachment);
          next.lastActive = Date.now();
          try {
            await this.commit(next);
          } catch (error) {
            server.close(1011, "连接未保存，请重试");
            throw error;
          }
          for (const socket of old)
            socket.close(4001, "会话已在另一个页面连接");
          this.broadcast();
          return new Response(null, { status: 101, webSocket: client });
        }
        return json({ error: "接口不存在" }, 404);
      } catch (error) {
        return json(
          {
            error:
              error instanceof SyntaxError
                ? "请求格式错误"
                : error instanceof Error
                  ? error.message
                  : "请求失败",
          },
          400,
        );
      }
    });
  }
  private sessionResponse(
    request: Request,
    playerId: string,
    token: string,
  ): Response {
    const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
    return json({ roomCode: this.room!.code, playerId }, 200, {
      "Set-Cookie": `${cookieName(this.room!.code)}=${token}; Path=/api/rooms/${this.room!.code}/; HttpOnly; SameSite=Strict; Max-Age=604800${secure}`,
    });
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    return this.serial(async () => {
      if (!this.room) return;
      const a = ws.deserializeAttachment() as Attachment;
      const player = this.room.players.find(
        (p) => p.id === a.playerId && p.connectionId === a.connectionId,
      );
      if (!player) {
        ws.close(4001, "会话失效");
        return;
      }
      let command: Command | undefined;
      try {
        const now = Date.now();
        const limited = structuredClone(this.room),
          limitedPlayer = limited.players.find((p) => p.id === player.id)!;
        limitedPlayer.actionTimes = limitedPlayer.actionTimes.filter(
          (t) => now - t < 1000,
        );
        if (limitedPlayer.actionTimes.length >= 20) {
          this.send(ws, {
            type: "ERROR",
            code: "RATE_LIMIT",
            message: "操作过于频繁",
          });
          return;
        }
        limitedPlayer.actionTimes.push(now);
        await this.commit(limited);
        if (typeof message !== "string" || message.length > 4096)
          throw new Error("命令过大或格式错误");
        command = parseCommand(JSON.parse(message));
        const receiptKey = `receipt:${player.id}:${command.id}`;
        const fingerprint = await hash(JSON.stringify(command));
        const receipt = await this.ctx.storage.get<Receipt>(receiptKey);
        if (receipt) {
          if (receipt.fingerprint !== fingerprint)
            throw new Error("命令 ID 已使用，不能更改内容");
          this.send(ws, {
            type: "ACK",
            commandId: command.id,
            revision: receipt.revision,
          });
          this.send(ws, snapshot(this.room, player.id, this.connected()));
          return;
        }
        if (command.expectedRevision !== this.room.revision) {
          this.send(ws, {
            type: "ERROR",
            commandId: command.id,
            code: "STALE",
            message: "牌局已更新，请重新操作",
          });
          this.send(ws, snapshot(this.room, player.id, this.connected()));
          return;
        }
        if ((this.room.commandCount ?? 0) >= 100000)
          throw new Error("本房间已达到操作上限，请新建房间继续");
        const next = structuredClone(this.room),
          actor = next.players.find((p) => p.id === player.id)!;
        const action = command.action;
        let event: ReactionEvent | undefined;
        if (action.type === "SEND_REACTION" || action.type === "THROW_TOMATO") {
          const tomato = action.type === "THROW_TOMATO";
          if (
            now - (tomato ? actor.lastTomato : actor.lastReaction) <
            (tomato ? 3000 : 1500)
          )
            throw new Error(
              tomato ? "番茄需要冷却 3 秒" : "表情太快了，稍等一下",
            );
          if (tomato) {
            if (
              action.targetId === player.id ||
              !next.players.some((p) => p.id === action.targetId)
            )
              throw new Error("请选择其他玩家");
            actor.lastTomato = now;
            event = {
              type: "EVENT",
              eventId: crypto.randomUUID(),
              kind: "tomato",
              senderId: player.id,
              targetId: action.targetId,
              at: now,
            };
          } else {
            if (!REACTIONS.some((r) => r.id === action.reactionId))
              throw new Error("表情不存在");
            actor.lastReaction = now;
            event = {
              type: "EVENT",
              eventId: crypto.randomUUID(),
              kind: "reaction",
              senderId: player.id,
              reactionId: action.reactionId,
              at: now,
            };
          }
        } else if (action.type === "READY") {
          if (next.game && next.game.phase !== "finished")
            throw new Error("牌局进行中");
          if (actor.ready === action.ready) throw new Error("准备状态未改变");
          actor.ready = action.ready;
          next.revision++;
        } else if (action.type === "CHOOSE_SEAT") {
          if (next.game) throw new Error("开局后不能换座");
          if (
            action.seat === actor.seat ||
            action.seat >= (next.kind === "guandan" ? 4 : 3) ||
            next.players.some(
              (p) => p.id !== actor.id && p.seat === action.seat,
            )
          )
            throw new Error("座位已占用或无效");
          actor.seat = action.seat;
          actor.ready = false;
          next.revision++;
        } else if (action.type === "START_GAME") {
          if (next.hostId !== player.id) throw new Error("只有房主可以开始");
          if (next.game && next.game.phase !== "finished")
            throw new Error("本局尚未结束");
          const connected = this.connected();
          if (
            next.players.length !== (next.kind === "guandan" ? 4 : 3) ||
            next.players.some((p) => !connected.has(p.id) || !p.ready)
          )
            throw new Error("所有玩家入座、连接并准备后才能开始");
          if (next.kind === "guandan") {
            const previous =
              next.game?.kind === "guandan" ? next.game : undefined;
            next.game = createGuandan({
              houseRule: next.houseRule,
              previous: previous?.matchWinner == null ? previous : undefined,
            });
          } else
            next.game = createDoudizhu({
              handNumber: (next.game?.handNumber ?? 0) + 1,
            });
          next.revision++;
        } else {
          if (!next.game) throw new Error("请先开始游戏");
          next.game =
            next.game.kind === "guandan"
              ? applyGuandan(next.game, actor.seat, action as GameAction)
              : applyDoudizhu(next.game, actor.seat, action as GameAction);
          next.revision++;
        }
        next.lastActive = now;
        next.commandCount = (next.commandCount ?? 0) + 1;
        if (next.game) {
          assertCardConservation(next.game);
          next.game.history = next.game.history.slice(-200);
        }
        await this.commit(next, {
          key: receiptKey,
          value: { fingerprint, revision: next.revision },
        });
        this.send(ws, {
          type: "ACK",
          commandId: command.id,
          revision: next.revision,
        });
        if (event) {
          for (const socket of this.ctx.getWebSockets()) {
            const attachment = socket.deserializeAttachment() as Attachment;
            if (
              next.players.some(
                (p) =>
                  p.id === attachment.playerId &&
                  p.connectionId === attachment.connectionId,
              )
            )
              this.send(socket, event);
          }
        } else this.broadcast();
      } catch (error) {
        this.send(ws, {
          type: "ERROR",
          commandId: command?.id,
          message:
            error instanceof SyntaxError
              ? "命令格式错误"
              : error instanceof Error
                ? error.message
                : "操作失败",
        });
      }
    });
  }
  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ) {
    void reason;
    void wasClean;
    return this.serial(async () => {
      try {
        ws.close(code === 1005 ? 1000 : code);
      } catch {
        /* Already closed. */
      }
      const a = ws.deserializeAttachment() as Attachment;
      const player = this.room?.players.find(
        (p) => p.id === a.playerId && p.connectionId === a.connectionId,
      );
      if (player && this.room) {
        const next = structuredClone(this.room);
        next.players.find((p) => p.id === player.id)!.connectionId = null;
        next.lastActive = Date.now();
        await this.commit(next);
        this.broadcast();
      }
    });
  }
  async webSocketError(ws: WebSocket) {
    return this.webSocketClose(ws, 1011, "socket error", false);
  }
  async alarm() {
    return this.serial(async () => {
      if (!this.room) return;
      if (this.connected().size) {
        const next = structuredClone(this.room);
        next.lastActive = Date.now();
        await this.commit(next);
      } else if (this.room.lastActive + this.ttl() <= Date.now()) {
        await this.ctx.storage.deleteAll();
        this.room = null;
      } else await this.ctx.storage.setAlarm(this.room.lastActive + this.ttl());
    });
  }
}
