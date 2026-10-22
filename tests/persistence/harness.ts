import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import WebSocket from "ws";
import type {
  Command,
  GameKind,
  RoomAction,
  ServerMessage,
  Snapshot,
} from "../../shared/types";

export const base = "http://127.0.0.1:8791";
export const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function availablePort(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
}

/** Owns only its detached child group and its unique temporary persistence directory. */
export class IsolatedWorker {
  private child: ChildProcess | undefined;
  private output = "";
  private exit: Promise<void> = Promise.resolve();
  directory = "";
  starts = 0;

  diagnostics(): string {
    return this.output;
  }

  async start(): Promise<void> {
    if (this.child) throw new Error("Isolated worker is already running");
    await Promise.all([availablePort(8791), availablePort(9235)]);
    if (!this.directory)
      this.directory = await mkdtemp("/tmp/tomato-persistence-");
    await mkdir("/tmp/tomato-config", { recursive: true });
    this.output = "";
    const child = spawn(
      process.execPath,
      [
        resolve("node_modules/wrangler/bin/wrangler.js"),
        "dev",
        "--local",
        "--ip",
        "127.0.0.1",
        "--port",
        "8791",
        "--inspector-port",
        "9235",
        "--persist-to",
        this.directory,
        "--log-level",
        "error",
      ],
      {
        cwd: process.cwd(),
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          XDG_CONFIG_HOME: "/tmp/tomato-config",
          WRANGLER_SEND_METRICS: "false",
          BROWSER: "none",
        },
      },
    );
    this.child = child;
    this.starts += 1;
    this.exit = new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.once("error", (error) => {
        this.output += `\n${error.message}`;
        resolve();
      });
    });
    for (const stream of [child.stdout, child.stderr])
      stream?.on("data", (chunk) => {
        this.output = `${this.output}${String(chunk)}`.slice(-50000);
      });
    const until = Date.now() + 45000;
    while (Date.now() < until) {
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error(
          `Isolated Wrangler exited during startup:\n${this.output}`,
        );
      try {
        const result = await fetch(`${base}/api/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (result.ok && ((await result.json()) as { ok?: boolean }).ok) return;
      } catch {
        /* The isolated child has not bound its port yet. */
      }
      await delay(100);
    }
    throw new Error(
      `Isolated Wrangler did not become healthy:\n${this.output}`,
    );
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    const signal = (name: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, name);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    };
    signal("SIGTERM");
    await Promise.race([this.exit, delay(5000)]);
    // Kill any surviving workerd/esbuild descendants in the group we created.
    signal("SIGKILL");
    await this.exit;
    this.child = undefined;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        await Promise.all([availablePort(8791), availablePort(9235)]);
        return;
      } catch {
        await delay(100);
      }
    }
    throw new Error(
      "Isolated worker ports did not close after process-group cleanup",
    );
  }

  async cleanup(): Promise<void> {
    await this.stop();
    if (this.directory)
      await rm(this.directory, { recursive: true, force: true });
  }
}

export class PlayerConnection {
  private socket: WebSocket | undefined;
  private failure: Error | undefined;
  private lastActionAt = 0;
  readonly messages: ServerMessage[] = [];
  snapshot!: Snapshot;

  constructor(
    readonly code: string,
    readonly cookie: string,
  ) {}

  get seat(): number {
    return this.snapshot.players.find(
      (player) => player.id === this.snapshot.selfId,
    )!.seat;
  }

  async connect(): Promise<this> {
    const socket = new WebSocket(
      `${base.replace(/^http/, "ws")}/api/rooms/${this.code}/ws`,
      {
        headers: { Cookie: this.cookie, Origin: base },
      },
    );
    this.socket = socket;
    socket.on("error", (error) => {
      this.failure = error;
    });
    socket.on("close", (code, reason) => {
      this.failure ??= new Error(
        `Player socket closed with code ${code}: ${String(reason)}`,
      );
    });
    socket.on("message", (data) => {
      const message = JSON.parse(String(data)) as ServerMessage;
      this.messages.push(message);
      if (message.type === "SNAPSHOT") this.snapshot = message;
    });
    await this.wait((message) => message.type === "SNAPSHOT");
    return this;
  }

  async wait(
    predicate: (message: ServerMessage) => boolean,
    from = 0,
  ): Promise<ServerMessage> {
    const until = Date.now() + 10000;
    while (Date.now() < until) {
      const found = this.messages.slice(from).find(predicate);
      if (found) return found;
      if (this.failure) throw this.failure;
      await delay(5);
    }
    throw new Error(
      `Timed out awaiting server message; received types: ${this.messages
        .slice(from)
        .map((message) => message.type)
        .join(", ")}`,
    );
  }

  async raw(command: Command): Promise<ServerMessage> {
    // Even cooperative complete-round scenarios remain below 20 commands per actor per second.
    await delay(Math.max(0, this.lastActionAt + 65 - Date.now()));
    this.lastActionAt = Date.now();
    const from = this.messages.length;
    if (this.socket?.readyState !== WebSocket.OPEN)
      throw new Error("Player socket is not connected");
    this.socket.send(JSON.stringify(command));
    return this.wait(
      (message) =>
        (message.type === "ACK" && message.commandId === command.id) ||
        (message.type === "ERROR" &&
          (!message.commandId || message.commandId === command.id)),
      from,
    );
  }

  command(action: RoomAction): Command {
    return {
      id: randomUUID(),
      expectedRevision: this.snapshot.revision,
      action,
    };
  }

  close(): void {
    this.socket?.terminate();
  }
}

export async function openRoom(
  kind: GameKind,
  count: number,
): Promise<PlayerConnection[]> {
  const post = async (path: string, body: unknown) => {
    const result = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: base },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!result.ok)
      throw new Error(
        `Room setup returned HTTP ${result.status}: ${await result.text()}`,
      );
    return result;
  };
  const created = await post("/api/rooms", {
    kind,
    name: "持久化房主",
    houseRule: true,
  });
  const { roomCode } = (await created.json()) as { roomCode: string };
  const cookie = (response: Response) => {
    const value = response.headers.get("set-cookie");
    if (!value) throw new Error("Room setup omitted the session cookie");
    return value.split(";")[0];
  };
  const cookies = [cookie(created)];
  for (let index = 1; index < count; index++)
    cookies.push(
      cookie(
        await post(`/api/rooms/${roomCode}/join`, {
          name: `持久化玩家${index}`,
        }),
      ),
    );
  const connected: PlayerConnection[] = [];
  try {
    for (const session of cookies)
      connected.push(await new PlayerConnection(roomCode, session).connect());
    return connected;
  } catch (error) {
    connected.forEach((client) => client.close());
    throw error;
  }
}

export async function apply(
  clients: PlayerConnection[],
  actor: PlayerConnection,
  action: RoomAction,
): Promise<Command> {
  const command = actor.command(action);
  const response = await actor.raw(command);
  if (response.type !== "ACK")
    throw new Error(
      `Expected ACK for ${action.type}: ${JSON.stringify(response)}`,
    );
  await Promise.all(
    clients.map((client) =>
      client.wait(
        (message) =>
          message.type === "SNAPSHOT" && message.revision >= response.revision,
      ),
    ),
  );
  return command;
}

export async function startGame(clients: PlayerConnection[]): Promise<void> {
  for (const client of clients)
    if (
      !client.snapshot.players.find(
        (player) => player.id === client.snapshot.selfId,
      )!.ready
    ) {
      await apply(clients, client, { type: "READY", ready: true });
    }
  const host = clients.find(
    (client) => client.snapshot.selfId === client.snapshot.hostId,
  )!;
  await apply(clients, host, { type: "START_GAME" });
}

/** Presence changes during reconnection; every persisted game and identity field must match. */
export function stableSnapshot(snapshot: Snapshot) {
  return {
    ...snapshot,
    players: snapshot.players.map(
      ({ connected: _connected, ...player }) => player,
    ),
  };
}
