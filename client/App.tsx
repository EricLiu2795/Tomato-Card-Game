import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  cardLabel,
  ddzStrength,
  gdStrength,
  isWild,
  RANK_LABELS,
  SUIT_LABELS,
  type Card,
} from "../shared/cards";
import {
  classifyGuandan,
  classifyGuandanResponse,
} from "../shared/guandan-combinations";
import { classifyDoudizhu } from "../shared/doudizhu-combinations";
import { findReaction, REACTIONS } from "../shared/soundboard";
import {
  unlockAudio,
  syncAudioSettings,
  playCue,
  playReaction,
  type SoundSettings,
} from "./audio";
import { zhCN } from "./i18n";
import { suggestMoves, selectionCanPlay } from "../shared/move-assistance";
import {
  createPractice,
  practiceSnapshot,
  applyPractice,
  stepPracticeBot,
  type PracticeSession,
} from "./practice";
import type {
  Command,
  GameKind,
  PublicPlayer,
  ReactionEvent,
  RoomAction,
  ServerMessage,
  Snapshot,
} from "../shared/types";

type IconName =
  | "arrow"
  | "plus"
  | "link"
  | "sound"
  | "mute"
  | "settings"
  | "close"
  | "history"
  | "check"
  | "shuffle"
  | "smile"
  | "help"
  | "back"
  | "copy";
function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    arrow: (
      <>
        <path d="M5 12h14M13 6l6 6-6 6" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    link: (
      <>
        <path
          d="m10 13 4-4M8 15l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M16 9l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"
          transform="translate(0 -1) scale(.95)"
        />
      </>
    ),
    sound: (
      <>
        <path d="M11 4 5 9H2v6h3l6 5V4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" />
      </>
    ),
    mute: (
      <>
        <path d="M11 4 5 9H2v6h3l6 5V4ZM16 9l6 6M22 9l-6 6" />
      </>
    ),
    settings: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
        <path d="M9 3v6M16 9v6M8 15v6" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    history: (
      <>
        <path d="M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v5l3 2" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    shuffle: (
      <>
        <path d="M3 6h3c5 0 7 12 12 12h3M17 14l4 4-4 4M3 18h3c2 0 4-3 6-6s4-6 6-6h3M17 2l4 4-4 4" />
      </>
    ),
    smile: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M8 14c2 3 6 3 8 0M8 8h.01M16 8h.01" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9a3 3 0 1 1 5 2c-2 1-2 1-2 3M12 17h.01" />
      </>
    ),
    back: <path d="M19 12H5m6-6-6 6 6 6" />,
    copy: (
      <>
        <rect x="8" y="8" width="12" height="13" rx="2" />
        <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function Tomato({
  className = "",
  size = 38,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <path
        d="M32 17C9 5 0 33 13 49c10 12 31 11 40-2 12-19 0-38-21-30Z"
        fill="#ef684f"
      />
      <path
        d="M34 18C26 10 15 17 14 28"
        fill="none"
        stroke="#ffad8b"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="m32 20-15-5 11-3-2-9 8 8 12-7-5 11 12 4-14 4-4 9Z"
        fill="#367b50"
      />
      <path
        d="m32 16 2-12"
        stroke="#296740"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="25" cy="36" r="2" fill="#743a30" />
      <circle cx="41" cy="36" r="2" fill="#743a30" />
      <path
        d="M29 42c2 3 5 3 8 0"
        fill="none"
        stroke="#743a30"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CardFace({
  card,
  selected,
  onClick,
  small = false,
  level,
}: {
  card: Card;
  selected?: boolean;
  onClick?: () => void;
  small?: boolean;
  level?: number;
}) {
  const red = card.suit === "H" || card.suit === "D" || card.rank === 16;
  const joker = card.suit === "J";
  const wild = level !== undefined && isWild(card, level);
  const content = (
    <>
      <span className="card-corner">
        <b>
          {joker
            ? card.rank === 16
              ? "大"
              : "小"
            : (RANK_LABELS[card.rank] ?? card.rank)}
        </b>
        <span>{joker ? "王" : SUIT_LABELS[card.suit]}</span>
      </span>
      <span className="card-suit">{joker ? "✦" : SUIT_LABELS[card.suit]}</span>
      {wild && <span className="wild-tag">逢人配</span>}
      {selected && (
        <span className="card-selected-check">
          <Icon name="check" size={11} />
        </span>
      )}
    </>
  );
  const className = `playing-card ${red ? "red-card" : ""} ${small ? "small-card" : ""} ${selected ? "selected" : ""} ${wild ? "wild-card" : ""}`;
  return onClick ? (
    <button
      type="button"
      className={className}
      data-card-id={card.id}
      data-testid={`card-${card.id}`}
      aria-label={`${cardLabel(card)}${wild ? "，逢人配" : ""}${selected ? "，已选中" : ""}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <span className={className} aria-label={cardLabel(card)}>
      {content}
    </span>
  );
}

function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const buttons = ref.current?.querySelectorAll<HTMLElement>(
          'button, input, select, a[href], [tabindex="0"]',
        );
        if (!buttons?.length) return;
        if (
          event.shiftKey &&
          (document.activeElement === buttons[0] ||
            document.activeElement === ref.current)
        ) {
          event.preventDefault();
          buttons[buttons.length - 1].focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === buttons[buttons.length - 1]
        ) {
          event.preventDefault();
          buttons[0].focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        tabIndex={-1}
        className={`modal ${wide ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="关闭弹窗"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const defaultSound: SoundSettings = {
  enabled: false,
  volume: 0.65,
  gentle: false,
};
function readSound(): SoundSettings {
  try {
    return {
      ...defaultSound,
      ...JSON.parse(localStorage.getItem("tomato-sound") || "{}"),
    };
  } catch {
    return defaultSound;
  }
}
function readName(): string {
  try {
    return localStorage.getItem("tomato-nickname") || "";
  } catch {
    return "";
  }
}
interface Bubble {
  id: string;
  sender: string;
  label: string;
  expires: number;
  voice: boolean;
}
interface Throw {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  expires: number;
}
const phaseLabels = zhCN.phase;
const voiceMoods: Record<string, string> = {
  "you-are-so-right": "俏皮附和",
  "bro-really": "惊讶反问",
  "can-you-play": "朋友间的调侃",
  "we-got-this": "自信满满",
  "six-six-six": "兴奋夸赞",
  "stay-calm": "温柔鼓劲",
  "i-give-up": "无奈吐槽",
  "how-did-we-lose": "不可思议",
  beautiful: "开心喝彩",
  "what-are-you-doing": "疑惑打趣",
};

export default function App() {
  const [practice, setPractice] = useState<PracticeSession | null>(null);
  const practiceRef = useRef<PracticeSession | null>(null);
  const [roomCode, setRoomCode] = useState(() => {
    const code =
      new URLSearchParams(location.search).get("room")?.toUpperCase() || "";
    return /^[A-Z0-9]{4,10}$/.test(code) ? code : "";
  });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const snapshotRef = useRef<Snapshot | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [connection, setConnection] = useState<
    "connecting" | "connected" | "reconnecting" | "offline"
  >("offline");
  const [needsJoin, setNeedsJoin] = useState(false);
  const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);
  const pendingTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<"rank" | "suit">("rank");
  const [hintIndex, setHintIndex] = useState(0);
  const [rulesKind, setRulesKind] = useState<GameKind>("guandan");
  const [sound, setSound] = useState<SoundSettings>(readSound);
  const [panel, setPanel] = useState<
    "rules" | "settings" | "history" | "invite" | null
  >(null);
  const [reactionPanel, setReactionPanel] = useState(false);
  const [tomatoMode, setTomatoMode] = useState(false);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [throws, setThrows] = useState<Throw[]>([]);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const stageRef = useRef<HTMLDivElement>(null);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4800);
  }, []);
  useEffect(() => {
    syncAudioSettings(sound);
    try {
      localStorage.setItem("tomato-sound", JSON.stringify(sound));
    } catch {
      /* Private browsing may disable storage. */
    }
  }, [sound]);
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setBubbles((old) => old.filter((bubble) => bubble.expires > now));
      setThrows((old) => old.filter((item) => item.expires > now));
    }, 500);
    return () => clearInterval(timer);
  }, []);

  const receiveEvent = useCallback((event: ReactionEvent) => {
    if (event.kind === "reaction") {
      const reaction = findReaction(event.reactionId || "");
      if (!reaction) return;
      setBubbles((old) => [
        ...old.filter((bubble) => bubble.sender !== event.senderId),
        {
          id: event.eventId,
          sender: event.senderId,
          label: reaction.label,
          expires: Date.now() + reaction.duration,
          voice: reaction.category === "voice",
        },
      ]);
      playReaction(reaction);
    } else {
      const stage = stageRef.current;
      const origin = stage
        ?.querySelector<HTMLElement>(
          `[data-player-id="${CSS.escape(event.senderId)}"]`,
        )
        ?.getBoundingClientRect();
      const target = stage
        ?.querySelector<HTMLElement>(
          `[data-player-id="${CSS.escape(event.targetId || "")}"]`,
        )
        ?.getBoundingClientRect();
      const bounds = stage?.getBoundingClientRect();
      if (origin && target && bounds)
        setThrows((old) => [
          ...old.slice(-5),
          {
            id: event.eventId,
            fromX: origin.left + origin.width / 2 - bounds.left,
            fromY: origin.top + origin.height / 2 - bounds.top,
            toX: target.left + target.width / 2 - bounds.left,
            toY: target.top + target.height / 2 - bounds.top,
            expires: Date.now() + 1800,
          },
        ]);
      playReaction("tomato");
    }
  }, []);

  const updatePractice = useCallback((next: PracticeSession) => {
    const newHand =
      practiceRef.current?.game.handNumber !== next.game.handNumber;
    practiceRef.current = next;
    setPractice(next);
    const view = practiceSnapshot(next);
    snapshotRef.current = view;
    setSnapshot(view);
    setSelected((old) =>
      newHand
        ? []
        : old.filter((id) => view.hand.some((card) => card.id === id)),
    );
    setHintIndex(0);
  }, []);

  useEffect(() => {
    if (
      !practice ||
      practice.game.phase === "finished" ||
      practice.game.turn === 0
    )
      return;
    const timer = setTimeout(() => {
      if (practiceRef.current !== practice) return;
      try {
        updatePractice(stepPracticeBot(practice));
      } catch (error) {
        notify(
          error instanceof Error
            ? error.message
            : "练习暂时中断，请返回大厅重试。",
        );
      }
    }, 1050);
    return () => clearTimeout(timer);
  }, [practice, updatePractice, notify]);

  useEffect(() => {
    if (!roomCode) return;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    const connect = () => {
      if (cancelled) return;
      setConnection(attempts ? "reconnecting" : "connecting");
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/rooms/${encodeURIComponent(roomCode)}/ws`,
      );
      socketRef.current = ws;
      ws.onmessage = (message) => {
        if (cancelled) return;
        let data: ServerMessage;
        try {
          data = JSON.parse(String(message.data)) as ServerMessage;
        } catch {
          return;
        }
        if (data.type === "SNAPSHOT") {
          setHintIndex(0);
          attempts = 0;
          const newHand =
            snapshotRef.current?.game?.handNumber !== data.game?.handNumber;
          snapshotRef.current = data;
          setSnapshot(data);
          setConnection("connected");
          setNeedsJoin(false);
          setSelected((old) =>
            newHand
              ? []
              : old.filter((id) => data.hand.some((card) => card.id === id)),
          );
        } else if (data.type === "ACK") {
          if (pendingRef.current === data.commandId) {
            pendingRef.current = null;
            setPending(null);
            clearTimeout(pendingTimeout.current);
          }
        } else if (data.type === "ERROR") {
          notify(data.message);
          pendingRef.current = null;
          setPending(null);
          clearTimeout(pendingTimeout.current);
        } else receiveEvent(data);
      };
      ws.onclose = (event) => {
        if (cancelled) return;
        pendingRef.current = null;
        setPending(null);
        clearTimeout(pendingTimeout.current);
        if (
          event.code === 4001 ||
          event.code === 4003 ||
          event.code === 4401 ||
          event.code === 4403
        ) {
          setConnection("offline");
          setNeedsJoin(true);
          return;
        }
        if (!snapshotRef.current || snapshotRef.current.roomCode !== roomCode) {
          if (attempts >= 2) {
            setConnection("offline");
            setNeedsJoin(true);
            return;
          }
        }
        setConnection("reconnecting");
        attempts += 1;
        reconnectTimer = setTimeout(
          connect,
          Math.min(1000 * 2 ** attempts, 12000) + Math.random() * 400,
        );
      };
      ws.onerror = () => {
        /* onclose handles connection recovery. */
      };
    };
    connect();
    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [roomCode, retry, notify, receiveEvent]);

  const send = useCallback(
    (action: RoomAction) => {
      const local = practiceRef.current;
      if (local) {
        if (action.type === "SEND_REACTION" || action.type === "THROW_TOMATO") {
          receiveEvent({
            type: "EVENT",
            eventId: crypto.randomUUID(),
            at: Date.now(),
            senderId: "practice-you",
            kind: action.type === "SEND_REACTION" ? "reaction" : "tomato",
            ...(action.type === "SEND_REACTION"
              ? { reactionId: action.reactionId }
              : { targetId: action.targetId }),
          });
          return;
        }
        try {
          updatePractice(applyPractice(local, action));
        } catch (error) {
          notify(error instanceof Error ? error.message : "这手牌暂时不能出。");
        }
        return;
      }
      const ws = socketRef.current;
      const current = snapshotRef.current;
      if (!current || ws?.readyState !== WebSocket.OPEN) {
        notify("正在重新连接，稍等一下再操作。");
        return;
      }
      const social =
        action.type === "SEND_REACTION" || action.type === "THROW_TOMATO";
      if (!social && pendingRef.current) return;
      const command: Command = {
        id: crypto.randomUUID(),
        expectedRevision: current.revision,
        action,
      };
      if (!social) {
        pendingRef.current = command.id;
        setPending(command.id);
        clearTimeout(pendingTimeout.current);
        pendingTimeout.current = setTimeout(() => {
          if (pendingRef.current === command.id) {
            pendingRef.current = null;
            setPending(null);
            notify("操作确认超时，正在同步牌桌。");
            setRetry((value) => value + 1);
          }
        }, 8000);
      }
      ws.send(JSON.stringify(command));
    },
    [notify, receiveEvent, updatePractice],
  );

  const startPractice = (kind: GameKind, name: string, houseRule: boolean) => {
    socketRef.current?.close();
    setRoomCode("");
    setNeedsJoin(false);
    setBubbles([]);
    setThrows([]);
    setConnection("connected");
    updatePractice(createPractice(kind, name.trim() || "番茄同学", houseRule));
    playCue("deal");
    const url = new URL(location.href);
    url.searchParams.delete("room");
    history.replaceState(null, "", url);
    window.scrollTo({ top: 0 });
  };

  const enterRoom = (code: string) => {
    practiceRef.current = null;
    setPractice(null);
    snapshotRef.current = null;
    setSnapshot(null);
    setNeedsJoin(false);
    setSelected([]);
    setBubbles([]);
    setThrows([]);
    setRoomCode(code);
    setRetry((value) => value + 1);
    const url = new URL(location.href);
    url.searchParams.set("room", code);
    history.replaceState(null, "", url);
  };
  const leaveRoom = () => {
    practiceRef.current = null;
    setPractice(null);
    socketRef.current?.close();
    snapshotRef.current = null;
    setSnapshot(null);
    setRoomCode("");
    setNeedsJoin(false);
    setSelected([]);
    setConnection("offline");
    setReactionPanel(false);
    setTomatoMode(false);
    setBubbles([]);
    setThrows([]);
    setPanel(null);
    const url = new URL(location.href);
    url.searchParams.delete("room");
    history.replaceState(null, "", url);
  };
  const toggleSound = () => {
    const next = { ...sound, enabled: !sound.enabled };
    syncAudioSettings(next);
    if (next.enabled) {
      void unlockAudio().then(() => playCue("win"));
    }
    setSound(next);
  };
  const copyInvite = async () => {
    const url = new URL(location.href);
    url.searchParams.set("room", roomCode);
    try {
      await navigator.clipboard.writeText(url.toString());
      notify("邀请链接已复制，发给朋友就能入座。");
    } catch {
      setPanel("invite");
    }
  };
  const closePanel = useCallback(() => setPanel(null), []);
  const self = snapshot?.players.find(
    (player) => player.id === snapshot.selfId,
  );
  const game = snapshot?.game;
  const isRoom = !!snapshot && !needsJoin;
  const isMyTurn = !!game && self?.seat === game.turn;
  const previousAudioSnapshot = useRef<Snapshot | null>(null);
  useEffect(() => {
    const previous = previousAudioSnapshot.current;
    previousAudioSnapshot.current = snapshot;
    if (
      !snapshot?.game ||
      !previous ||
      previous.roomCode !== snapshot.roomCode ||
      previous.revision === snapshot.revision
    )
      return;
    const current = snapshot.game;
    const before = previous.game;
    if (current.phase === "finished" && before?.phase !== "finished") {
      const seat =
        snapshot.players.find((player) => player.id === snapshot.selfId)
          ?.seat ?? 0;
      const won =
        current.kind === "guandan"
          ? current.winnerTeam === seat % 2
          : (current.winnerTeam === "landlord") === (current.landlord === seat);
      playCue(won ? "win" : "lose");
    } else if (!before || current.handNumber !== before.handNumber) {
      playCue("deal");
    } else if (
      current.trick &&
      current.trick.cards.map((card) => card.id).join() !==
        before.trick?.cards.map((card) => card.id).join() &&
      current.trick.combination.bomb
    ) {
      playCue("bomb");
    } else if (
      isMyTurn &&
      (current.turn !== before.turn || current.phase !== before.phase)
    ) {
      playCue("turn");
    } else if (
      current.trick &&
      current.trick.cards.map((card) => card.id).join() !==
        before.trick?.cards.map((card) => card.id).join()
    ) {
      playCue("play");
    } else if (current.phase === "playing" && current.turn !== before.turn) {
      playCue("pass");
    }
  }, [snapshot, isMyTurn]);
  const hand = useMemo(() => {
    if (!snapshot) return [];
    const strength = (card: Card) =>
      snapshot.kind === "guandan"
        ? gdStrength(card.rank, snapshot.game?.currentLevel ?? 2)
        : ddzStrength(card.rank);
    return [...snapshot.hand].sort((a, b) =>
      sortBy === "suit"
        ? a.suit.localeCompare(b.suit) ||
          strength(b) - strength(a) ||
          a.deck - b.deck
        : strength(b) - strength(a) ||
          a.suit.localeCompare(b.suit) ||
          a.deck - b.deck,
    );
  }, [snapshot, sortBy]);
  const selection = useMemo(
    () => hand.filter((card) => selected.includes(card.id)),
    [hand, selected],
  );
  const combination = useMemo(() => {
    if (!selection.length || !snapshot) return null;
    try {
      if (snapshot.kind === "doudizhu")
        return classifyDoudizhu(selection, game?.trick?.combination);
      if (game?.trick && game.trick.seat !== self?.seat)
        return classifyGuandanResponse(
          selection,
          game.currentLevel ?? 2,
          game.trick.combination,
        );
      return classifyGuandan(selection, game?.currentLevel ?? 2);
    } catch {
      return null;
    }
  }, [selection, snapshot, game, self?.seat]);

  const canPlay = !!game && selectionCanPlay(selection, game);
  const hints = useMemo(
    () =>
      game?.phase === "playing" && isMyTurn ? suggestMoves(hand, game) : [],
    [hand, game, isMyTurn],
  );
  const showHint = useCallback(() => {
    if (!hints.length) {
      notify("暂未找到推荐组合，可以自行选牌，或选择不出。");
      return;
    }
    const hint = hints[hintIndex % hints.length];
    setSelected(hint.cards.map((card) => card.id));
    setHintIndex((value) => value + 1);
  }, [hints, hintIndex, notify]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        panel ||
        reactionPanel ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("input, textarea, select, button, [contenteditable]")
      )
        return;
      if (
        !game ||
        game.phase !== "playing" ||
        !isMyTurn ||
        pending ||
        connection !== "connected"
      )
        return;
      if (event.key.toLowerCase() === "h") {
        event.preventDefault();
        showHint();
      }
      if (event.key === "Escape") setSelected([]);
      if (event.key === "Enter" && canPlay) {
        event.preventDefault();
        send({ type: "PLAY_CARDS", cardIds: selected });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    panel,
    reactionPanel,
    game,
    isMyTurn,
    pending,
    connection,
    showHint,
    canPlay,
    send,
    selected,
  ]);

  return (
    <div
      className={`app ${isRoom ? "in-room" : ""}`}
      onPointerDownCapture={() => {
        if (sound.enabled) unlockAudio();
      }}
      onKeyDownCapture={() => {
        if (sound.enabled) unlockAudio();
      }}
    >
      <header className="site-header">
        <button
          className="brand"
          onClick={isRoom ? leaveRoom : undefined}
          aria-label={isRoom ? "番茄牌局，返回大厅" : "番茄牌局首页"}
        >
          <Tomato />
          <span>
            <strong>番茄牌局</strong>
            <small>TOMATO CARD CLUB</small>
          </span>
        </button>
        <nav className="header-nav" aria-label="主导航">
          {isRoom ? (
            <>
              <span
                data-testid="connection-status"
                className={`connection-status ${connection === "connected" ? "online" : ""}`}
              >
                <i />
                {connection === "connected"
                  ? practice
                    ? "单人练习"
                    : zhCN.connection.connected
                  : zhCN.connection.reconnecting}
              </span>
              <button className="quiet-button" onClick={leaveRoom}>
                <Icon name="back" size={17} />
                <span>返回大厅</span>
              </button>
            </>
          ) : (
            <>
              <span className="nav-current">牌局大厅</span>
              <button
                className="quiet-button lobby-rules-link"
                onClick={() => setPanel("rules")}
              >
                玩法指南
              </button>
              <span className="header-tag">
                <span className="tiny-tomato" /> 好朋友，好牌局。
              </span>
            </>
          )}
          <button
            className={`icon-button ${sound.enabled ? "sound-on" : ""}`}
            aria-label={sound.enabled ? "静音" : "开启声音"}
            title={sound.enabled ? "静音" : "开启声音"}
            data-testid="toggle-sound"
            onClick={toggleSound}
          >
            <Icon name={sound.enabled ? "sound" : "mute"} />
          </button>
          <button
            className="icon-button"
            aria-label="设置"
            data-testid="settings"
            onClick={() => setPanel("settings")}
          >
            <Icon name="settings" />
          </button>
        </nav>
      </header>

      {!isRoom ? (
        <Lobby
          kind={rulesKind}
          onKindChange={setRulesKind}
          initialRoom={roomCode}
          restoring={!!roomCode && !needsJoin}
          onEnter={enterRoom}
          onRules={(kind) => {
            setRulesKind(kind);
            setPanel("rules");
          }}
          onError={notify}
          onPractice={startPractice}
        />
      ) : (
        <main
          className="room-main"
          data-testid="room"
          data-revision={snapshot.revision}
        >
          <div className="room-toolbar">
            <div className="room-title">
              <span className="eyebrow">
                {snapshot.kind === "guandan"
                  ? "四人 · 搭档竞技"
                  : "三人 · 欢乐对局"}
              </span>
              <h1>
                {zhCN.games[snapshot.kind]}
                <span className="room-code" data-testid="room-code">
                  {practice ? "电脑陪练" : `#${roomCode}`}
                </span>
              </h1>
            </div>
            <div className="room-tools">
              <button
                className="quiet-button"
                onClick={() => setPanel("rules")}
              >
                <Icon name="help" size={17} />
                <span>玩法</span>
              </button>
              <button
                className="quiet-button"
                data-testid="history"
                onClick={() => setPanel("history")}
              >
                <Icon name="history" size={17} />
                <span>牌局记录</span>
              </button>
              {!practice && (
                <button
                  className="button button-small button-cream"
                  data-testid="invite"
                  onClick={() => void copyInvite()}
                >
                  <Icon name="link" size={17} />
                  邀请好友
                </button>
              )}
            </div>
          </div>
          {connection !== "connected" && (
            <div className="connection-banner" role="status">
              正在恢复连接，手牌和座位都会保留。
              <button onClick={() => setRetry((value) => value + 1)}>
                立即重试
              </button>
            </div>
          )}
          {practice && (
            <div className="practice-banner">
              <span className="practice-mark">✦</span>
              <div>
                <strong>练练手，慢慢来。</strong>
                <span>
                  电脑已入座；点「提示」找一手好牌。练习仅在本页进行，刷新后重开。
                </span>
              </div>
              <span className="practice-tag">轻松练习</span>
            </div>
          )}
          <section className="table-shell" aria-label="游戏牌桌">
            <div className="table-topline">
              <span>
                <span className="live-dot" />
                {game
                  ? `第 ${game.handNumber} 局 · ${phaseLabels[game.phase]}`
                  : "等待好友入座"}
              </span>
              {game?.kind === "guandan" ? (
                <div className="level-score">
                  <span>
                    一队 <b>{rankLabel(game.levels?.[0] ?? 2)}</b>
                  </span>
                  <i>:</i>
                  <span>
                    二队 <b>{rankLabel(game.levels?.[1] ?? 2)}</b>
                  </span>
                  <span className="current-level">
                    本局打 {rankLabel(game.currentLevel ?? 2)}
                  </span>
                </div>
              ) : game?.kind === "doudizhu" ? (
                <span className="level-score">
                  当前倍数 <b>×{game.multiplier ?? 1}</b>
                </span>
              ) : (
                <span>
                  {snapshot.kind === "guandan"
                    ? "对面是队友"
                    : "三人齐聚，即刻开局"}
                </span>
              )}
            </div>
            <div className={`table-stage ${snapshot.kind}`} ref={stageRef}>
              <div className="table-watermark">
                <Tomato size={52} />
                <span>番 茄 牌 局</span>
                <small>GOOD CARDS, GREAT COMPANY</small>
              </div>
              {Array.from(
                { length: snapshot.kind === "guandan" ? 4 : 3 },
                (_, seat) => {
                  const player = snapshot.players.find(
                    (item) => item.seat === seat,
                  );
                  const relative =
                    (seat -
                      (self?.seat ?? 0) +
                      (snapshot.kind === "guandan" ? 4 : 3)) %
                    (snapshot.kind === "guandan" ? 4 : 3);
                  const position =
                    snapshot.kind === "guandan"
                      ? ["self", "left", "top", "right"][relative]
                      : ["self", "left", "right"][relative];
                  const bubble = bubbles.find(
                    (item) => item.sender === player?.id,
                  );
                  return (
                    <Seat
                      key={seat}
                      seat={seat}
                      player={player}
                      position={position}
                      current={
                        !!game &&
                        game.phase !== "finished" &&
                        game.turn === seat
                      }
                      mine={player?.id === snapshot.selfId}
                      teammate={
                        snapshot.kind === "guandan" &&
                        seat !== self?.seat &&
                        seat % 2 === (self?.seat ?? 0) % 2
                      }
                      host={player?.id === snapshot.hostId}
                      kind={snapshot.kind}
                      landlord={game?.landlord === seat}
                      finished={
                        game?.finishOrder.includes(seat)
                          ? game.finishOrder.indexOf(seat) + 1
                          : undefined
                      }
                      passed={game?.passed.includes(seat)}
                      choosing={
                        !practice && (!game || game.phase === "finished")
                      }
                      disabled={!!pending || connection !== "connected"}
                      tomatoMode={tomatoMode && player?.id !== snapshot.selfId}
                      bubble={bubble}
                      onSeat={() => send({ type: "CHOOSE_SEAT", seat })}
                      onTomato={() => {
                        if (player && player.id !== snapshot.selfId) {
                          send({ type: "THROW_TOMATO", targetId: player.id });
                          setTomatoMode(false);
                        }
                      }}
                    />
                  );
                },
              )}
              <div className={`table-center ${!game ? "waiting-center" : ""}`}>
                {!game ? (
                  <>
                    <div className="waiting-icon">
                      <span>♠</span>
                      <span>♥</span>
                    </div>
                    <h2>好牌，留给好朋友</h2>
                    <p>
                      还差{" "}
                      {Math.max(
                        0,
                        (snapshot.kind === "guandan" ? 4 : 3) -
                          snapshot.players.length,
                      )}{" "}
                      位好友，就能凑齐一桌
                    </p>
                    <button
                      className="table-invite"
                      onClick={() => void copyInvite()}
                    >
                      <Icon name="link" size={15} />
                      复制邀请链接
                    </button>
                    <span className="waiting-hint">
                      点击空座可换座 · 准备后等待房主开局
                    </span>
                  </>
                ) : game.phase === "finished" ? (
                  <div className="result-card">
                    <div className="result-confetti" aria-hidden="true">
                      {Array.from({ length: 12 }, (_, index) => (
                        <i
                          key={index}
                          style={{ "--i": index } as CSSProperties}
                        />
                      ))}
                    </div>
                    <span className="result-spark">✦</span>
                    <span className="eyebrow">这局打得漂亮</span>
                    <h2>
                      {game.kind === "guandan"
                        ? `${game.winnerTeam === 0 ? "一队" : "二队"} 获胜`
                        : game.winnerTeam === "landlord"
                          ? "地主获胜"
                          : "农民获胜"}
                    </h2>
                    {game.kind === "guandan" ? (
                      <p>
                        {game.matchWinner !== null &&
                        game.matchWinner !== undefined
                          ? "已完成过 A，整场比赛胜利！"
                          : `本局升 ${game.advancement ?? 0} 级 · 下一局继续配合`}
                      </p>
                    ) : (
                      <p>
                        {snapshot.players
                          .map(
                            (player) =>
                              `${player.name} ${(game.scores?.[player.seat] ?? 0) >= 0 ? "+" : ""}${game.scores?.[player.seat] ?? 0}`,
                          )
                          .join(" · ")}
                      </p>
                    )}
                    <div className="finish-order">
                      {game.finishOrder.map((seat, index) => (
                        <span key={seat}>
                          {index + 1}.{" "}
                          {
                            snapshot.players.find(
                              (player) => player.seat === seat,
                            )?.name
                          }
                        </span>
                      ))}
                    </div>
                  </div>
                ) : game.phase === "bidding" ? (
                  <div className="phase-center">
                    <span className="eyebrow">地主还没定，精彩先开始</span>
                    <h2>
                      {isMyTurn
                        ? "轮到你叫分了"
                        : `${snapshot.players.find((player) => player.seat === game.turn)?.name ?? "玩家"} 正在叫分`}
                    </h2>
                    <div className="bottom-cards">
                      {[0, 1, 2].map((index) => (
                        <span className="card-back" key={index}>
                          <Tomato size={24} />
                        </span>
                      ))}
                    </div>
                    <p>当前最高叫分：{game.highBid ?? 0} 分</p>
                  </div>
                ) : game.phase === "tribute" ||
                  game.phase === "return" ||
                  game.phase === "discard" ? (
                  <div className="phase-center">
                    <span className="phase-pill">
                      {phaseLabels[game.phase]}
                    </span>
                    <h2>
                      {game.phase === "tribute"
                        ? "先敬一手好牌"
                        : game.phase === "return"
                          ? "礼尚往来，还一张牌"
                          : "房规时刻，轻装上阵"}
                    </h2>
                    <p>
                      {game.phase === "tribute"
                        ? "进贡方选择最大非逢人配牌"
                        : game.phase === "return"
                          ? "优先还 10 或以下的非级牌"
                          : "双贡进贡方可弃任意一张手牌"}
                    </p>
                    <div className="phase-status">
                      {game.tribute?.pairs.map((pair, index) => (
                        <span key={index}>
                          {
                            snapshot.players.find(
                              (player) => player.seat === pair.from,
                            )?.name
                          }{" "}
                          →{" "}
                          {
                            snapshot.players.find(
                              (player) => player.seat === pair.to,
                            )?.name
                          }
                          {pair.tribute
                            ? ` · ${cardLabel(pair.tribute)}`
                            : game.tribute?.selections[pair.from]
                              ? " · 已选择"
                              : " · 待选择"}
                          {pair.returnCard
                            ? ` / 还 ${cardLabel(pair.returnCard)}`
                            : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    {game.trick ? (
                      <div
                        className={`trick ${game.trick.combination.bomb ? "bomb-trick" : ""}`}
                        key={game.trick.cards.map((card) => card.id).join("-")}
                      >
                        <div className="trick-label">
                          {
                            snapshot.players.find(
                              (player) => player.seat === game.trick?.seat,
                            )?.name
                          }
                          <span>{game.trick.combination.label}</span>
                        </div>
                        <div className="trick-cards">
                          {game.trick.cards.map((card) => (
                            <CardFace
                              card={card}
                              key={card.id}
                              small
                              level={game.currentLevel}
                            />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="empty-trick">
                        <span>✦</span>
                        <p>新的一轮，自由出牌</p>
                      </div>
                    )}
                    <div
                      className={`turn-message ${isMyTurn ? "your-turn" : ""}`}
                      role="status"
                      aria-live="polite"
                    >
                      <span className="live-dot" />
                      {isMyTurn
                        ? "轮到你出牌"
                        : `等待 ${snapshot.players.find((player) => player.seat === game.turn)?.name ?? "玩家"} 出牌`}
                    </div>
                  </>
                )}
              </div>
              {throws.map((item) => (
                <div
                  key={item.id}
                  className="tomato-flight"
                  aria-label="飞来的番茄"
                  style={
                    {
                      "--from-x": `${item.fromX}px`,
                      "--from-y": `${item.fromY}px`,
                      "--to-x": `${item.toX}px`,
                      "--to-y": `${item.toY}px`,
                    } as CSSProperties
                  }
                >
                  <Tomato size={35} />
                  <span className="tomato-splat">✹</span>
                </div>
              ))}
              {tomatoMode && (
                <div className="tomato-prompt">
                  <Tomato size={22} />
                  点一位朋友，送 TA 一颗番茄
                  <button
                    onClick={() => setTomatoMode(false)}
                    aria-label="取消扔番茄"
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
              )}
            </div>
            {game?.kind === "doudizhu" &&
              game.bottom &&
              game.bottom.length > 0 && (
                <div className="revealed-bottom">
                  <span>地主底牌</span>
                  {game.bottom.map((card) => (
                    <CardFace card={card} key={card.id} small />
                  ))}
                </div>
              )}
            <div className="table-bottomline">
              <span>
                {snapshot.kind === "guandan"
                  ? snapshot.houseRule
                    ? "房规已开启 · 双贡后可弃任意一张牌"
                    : "标准规则 · 双人搭档"
                  : "经典叫分 · 炸弹翻倍"}
                {game?.tribute?.resisted ? " · 本局抗贡" : ""}
              </span>
              <span>
                {practice ? "电脑陪练 · 放心试牌" : "仅好友邀请 · 无真钱输赢"}
              </span>
            </div>
          </section>
          <section className="hand-section" aria-label="我的手牌和操作">
            <div className="hand-toolbar">
              <div>
                <h2>
                  {game && game.phase !== "finished" ? "我的手牌" : "我的座位"}
                  {hand.length > 0 && <span>{hand.length} 张</span>}
                </h2>
                {selection.length > 0 && (
                  <span
                    className={`selection-preview ${(game?.phase === "playing" ? canPlay : !!combination) ? "" : "unrecognized"}`}
                    aria-live="polite"
                  >
                    已选 {selection.length} 张
                    {combination
                      ? ` · ${combination.label}${game?.phase === "playing" && !canPlay ? " · 还压不过上一手" : ""}`
                      : " · 请选择有效牌型"}
                  </span>
                )}
              </div>
              <div className="hand-tools">
                {hand.length > 0 && (
                  <>
                    <button
                      className="quiet-button"
                      data-testid="clear-selection"
                      disabled={!selected.length}
                      onClick={() => setSelected([])}
                    >
                      取消选择
                    </button>
                    <button
                      className="quiet-button"
                      data-testid="sort-hand"
                      onClick={() =>
                        setSortBy((value) =>
                          value === "rank" ? "suit" : "rank",
                        )
                      }
                    >
                      <Icon name="shuffle" size={16} />
                      {sortBy === "rank" ? "按点数" : "按花色"}
                    </button>
                  </>
                )}
                <button
                  className={`social-button ${reactionPanel ? "active" : ""}`}
                  data-testid="open-reactions"
                  aria-expanded={reactionPanel}
                  onClick={() => {
                    setReactionPanel((value) => !value);
                    setTomatoMode(false);
                  }}
                >
                  <Icon name="smile" size={19} />
                  <span>来点互动</span>
                </button>
              </div>
            </div>
            {hand.length > 0 ? (
              <div
                className={`hand-cards ${hand.length > 20 ? "large-hand" : ""}`}
                data-testid="hand"
              >
                {hand.map((card) => (
                  <CardFace
                    card={card}
                    key={card.id}
                    level={
                      snapshot.kind === "guandan"
                        ? game?.currentLevel
                        : undefined
                    }
                    selected={selected.includes(card.id)}
                    onClick={() => {
                      playCue("select");
                      setSelected((old) =>
                        old.includes(card.id)
                          ? old.filter((id) => id !== card.id)
                          : [...old, card.id],
                      );
                    }}
                  />
                ))}
              </div>
            ) : !game ? (
              <div className="hand-waiting">
                <span>☕</span>
                <p>先坐一会儿，等朋友们到齐。</p>
              </div>
            ) : game.phase === "finished" ? null : (
              <div className="hand-waiting">
                <span>✦</span>
                <p>你已出完手牌，给朋友们加个油吧。</p>
              </div>
            )}
            {game && game.phase !== "finished" && (
              <div className={`table-coach ${isMyTurn ? "coach-active" : ""}`}>
                <span className="coach-icon">✧</span>
                <span>
                  {game.phase === "bidding"
                    ? "好牌敢叫分：3 分直接成为地主，拿走 3 张底牌。"
                    : game.phase === "playing"
                      ? game.trick
                        ? `跟牌目标：${game.trick.combination.label} · ${game.trick.cards.length} 张。用更大的同类牌型，或炸弹来压。`
                        : "你可以自由领出。试试对子、顺子等组合，一次多出几张。"
                      : "跟着桌面提示选一张牌；完成交换后，新的对局就开始了。"}
                </span>
                <button
                  onClick={() => setPanel("rules")}
                  aria-label="查看详细玩法"
                >
                  <Icon name="help" size={17} />
                </button>
              </div>
            )}
            <ActionBar
              snapshot={snapshot}
              selected={selected}
              isMyTurn={isMyTurn}
              pending={!!pending || connection !== "connected"}
              onAction={send}
              canPlay={canPlay}
              onHint={showHint}
              practice={!!practice}
            />
            {reactionPanel && (
              <div
                className="reaction-panel"
                role="region"
                aria-label="表情和语音互动"
              >
                <div className="reaction-head">
                  <div>
                    <h3>给牌局加点料</h3>
                    <p>
                      {sound.enabled
                        ? "文字和声音，一起送到朋友身边"
                        : "目前已静音，互动气泡照常显示"}
                    </p>
                  </div>
                  <button
                    className="icon-button"
                    onClick={() => setReactionPanel(false)}
                    aria-label="关闭互动"
                  >
                    <Icon name="close" size={18} />
                  </button>
                </div>
                <div className="emoji-grid">
                  {REACTIONS.filter((item) => item.category === "emoji").map(
                    (item) => (
                      <button
                        key={item.id}
                        data-testid={`reaction-${item.id}`}
                        aria-label={`发送表情 ${item.label}`}
                        onClick={() =>
                          send({ type: "SEND_REACTION", reactionId: item.id })
                        }
                      >
                        {item.label}
                      </button>
                    ),
                  )}
                </div>
                <div className="voice-grid">
                  {REACTIONS.filter((item) => item.category === "voice").map(
                    (item, index) => (
                      <button
                        key={item.id}
                        className={index === 0 ? "featured-quote" : ""}
                        data-testid={`reaction-${item.id}`}
                        onClick={() =>
                          send({ type: "SEND_REACTION", reactionId: item.id })
                        }
                      >
                        <Icon name="sound" size={15} />
                        <span>
                          {item.label}
                          <small>{voiceMoods[item.id]}</small>
                        </span>
                      </button>
                    ),
                  )}
                </div>
                <button
                  className="tomato-action"
                  data-testid="throw-tomato"
                  onClick={() => {
                    setTomatoMode(true);
                    setReactionPanel(false);
                    stageRef.current?.scrollIntoView({
                      behavior: matchMedia("(prefers-reduced-motion: reduce)")
                        .matches
                        ? "auto"
                        : "smooth",
                      block: "center",
                    });
                  }}
                >
                  <Tomato size={28} />
                  <span>
                    扔个番茄<small>选一位好友，友好吐槽一下</small>
                  </span>
                  <Icon name="arrow" size={18} />
                </button>
              </div>
            )}
          </section>
        </main>
      )}

      <footer className="site-footer">
        <span>🍅 生活有点忙，朋友来一场。</span>
        <button onClick={() => setPanel("rules")}>
          玩法说明
          <Icon name="arrow" size={13} />
        </button>
        <span className="footer-note">为朋友间的小聚而做</span>
      </footer>
      {toast && (
        <div className="toast" role="status" data-testid="toast">
          <span>✦</span>
          {toast}
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
      {panel === "settings" && (
        <Modal title="让牌局更合心意" onClose={closePanel}>
          <div className="setting-row">
            <div>
              <strong>牌桌声音</strong>
              <p>纸牌轻响、回合提醒，还有有情绪的语音表情</p>
            </div>
            <button
              role="switch"
              aria-checked={sound.enabled}
              aria-label="牌桌声音"
              data-testid="sound-switch"
              className={`switch ${sound.enabled ? "on" : ""}`}
              onClick={toggleSound}
            >
              <span />
            </button>
          </div>
          <div className="sound-preview">
            <div>
              <strong>听听牌桌上的好心情</strong>
              <p>
                {sound.enabled
                  ? sound.gentle
                    ? "轻声模式播放柔和提示音；关闭后可试听语音。"
                    : "仅在你的设备试听，不会发送给其他玩家。"
                  : "先开启牌桌声音，再试听你喜欢的语气。"}
              </p>
            </div>
            <div className="sound-preview-grid">
              {["we-got-this", "bro-really", "beautiful", "i-give-up"].map(
                (id) => {
                  const reaction = findReaction(id)!;
                  return (
                    <button
                      key={id}
                      data-testid={`preview-${id}`}
                      disabled={!sound.enabled}
                      onClick={() => {
                        unlockAudio();
                        playReaction(reaction);
                      }}
                    >
                      <Icon name="sound" size={16} />
                      <span>
                        {reaction.label}
                        <small>{voiceMoods[id]}</small>
                      </span>
                    </button>
                  );
                },
              )}
            </div>
            <button
              className="text-link"
              disabled={!sound.enabled}
              data-testid="preview-table-sound"
              onClick={() => {
                void unlockAudio().then(() => playCue("deal"));
              }}
            >
              听听发牌声 <Icon name="sound" size={14} />
            </button>
          </div>
          <label className="volume-control">
            <span>
              音量 <b>{Math.round(sound.volume * 100)}%</b>
            </span>
            <input
              data-testid="volume"
              aria-label="音量"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={sound.volume}
              onChange={(event) =>
                setSound((value) => ({
                  ...value,
                  volume: Number(event.target.value),
                }))
              }
            />
          </label>
          <div className="setting-row">
            <div>
              <strong>轻声模式</strong>
              <p>用轻提示音替代语音，降低音量</p>
            </div>
            <button
              role="switch"
              aria-checked={sound.gentle}
              aria-label="轻声模式"
              className={`switch ${sound.gentle ? "on" : ""}`}
              onClick={() =>
                setSound((value) => ({ ...value, gentle: !value.gentle }))
              }
            >
              <span />
            </button>
          </div>
          <p className="settings-note">
            语音表情使用本地神经语音片段；轻声模式只播放柔和提示音。动画跟随系统的“减少动态效果”设置。
          </p>
          <button
            className="button button-primary full-width"
            onClick={closePanel}
          >
            就这样，继续玩
          </button>
        </Modal>
      )}
      {panel === "rules" && (
        <Modal title="一桌朋友，一起上手" onClose={closePanel} wide>
          <Rules initialKind={snapshot?.kind ?? rulesKind} />
        </Modal>
      )}
      {panel === "history" && (
        <Modal title="这一局的来来往往" onClose={closePanel}>
          <div className="history-list">
            {game?.history.length ? (
              [...game.history].reverse().map((entry, index) => (
                <div className="history-entry" key={`${index}-${entry.text}`}>
                  <span className="history-dot" />
                  <div>
                    <p>{entry.text}</p>
                    {entry.cards && entry.cards.length > 0 && (
                      <div className="history-cards">
                        {entry.cards.map((card) => (
                          <span
                            key={card.id}
                            className={
                              card.suit === "H" ||
                              card.suit === "D" ||
                              card.rank === 16
                                ? "red-text"
                                : ""
                            }
                          >
                            {cardLabel(card)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <Icon name="history" size={32} />
                <p>开局后，出牌、进贡、还贡和弃牌会记在这里。</p>
              </div>
            )}
          </div>
          {game?.removed.length ? (
            <div className="discard-record">
              <strong>本局公开弃牌</strong>
              <p>{game.removed.map(cardLabel).join("、")}</p>
            </div>
          ) : null}
        </Modal>
      )}
      {panel === "invite" && (
        <Modal title="叫朋友来坐坐" onClose={closePanel}>
          <p className="modal-copy">
            把下面的链接发给朋友，或告诉 TA 房间号 <strong>{roomCode}</strong>。
          </p>
          <input
            className="invite-input"
            aria-label="房间邀请链接"
            readOnly
            value={location.href}
            onFocus={(event) => event.target.select()}
          />
          <button
            className="button button-primary full-width"
            onClick={() => void copyInvite()}
          >
            <Icon name="copy" size={17} />
            复制邀请链接
          </button>
        </Modal>
      )}
    </div>
  );
}

function rankLabel(rank: number) {
  return RANK_LABELS[rank] ?? String(rank);
}

function Lobby({
  kind,
  onKindChange: setKind,
  initialRoom,
  restoring,
  onEnter,
  onRules,
  onError,
  onPractice,
}: {
  kind: GameKind;
  onKindChange: (kind: GameKind) => void;
  initialRoom: string;
  restoring: boolean;
  onEnter: (code: string) => void;
  onRules: (kind: GameKind) => void;
  onError: (message: string) => void;
  onPractice: (kind: GameKind, name: string, houseRule: boolean) => void;
}) {
  const [name, setName] = useState(readName);
  const [code, setCode] = useState(initialRoom);
  const [houseRule, setHouseRule] = useState(true);
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const nicknameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (initialRoom) setCode(initialRoom);
  }, [initialRoom]);
  const submit = async (mode: "create" | "join") => {
    if (!name.trim()) {
      nicknameRef.current?.focus();
      onError("先取个朋友们认得出的昵称吧。");
      return;
    }
    if (mode === "join" && !/^[A-Z0-9]{4,10}$/.test(code.trim())) {
      onError("请输入正确的房间号。");
      return;
    }
    setBusy(mode);
    try {
      const response = await fetch(
        mode === "create"
          ? "/api/rooms"
          : `/api/rooms/${encodeURIComponent(code.trim())}/join`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "create"
              ? { kind, name: name.trim(), houseRule }
              : { name: name.trim() },
          ),
        },
      );
      const data = (await response.json()) as {
        roomCode?: string;
        error?: string;
        message?: string;
      };
      if (!response.ok || !data.roomCode)
        throw new Error(
          data.message || data.error || "暂时没能加入牌局，请稍后再试。",
        );
      try {
        localStorage.setItem("tomato-nickname", name.trim());
      } catch {
        /* Nickname storage is optional. */
      }
      onEnter(data.roomCode);
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "网络连接失败，请稍后再试。",
      );
    } finally {
      setBusy(null);
    }
  };
  return (
    <main className="lobby-main">
      <section className="lobby-hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="tiny-tomato" />
            THE GOOD COMPANY CLUB
          </span>
          <h1>
            好朋友，
            <br />
            <span className="hero-emphasis">
              来一局。
              <svg
                viewBox="0 0 210 16"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path d="M3 11C54 0 132 1 205 7M28 15c53-9 111-7 165-3" />
              </svg>
            </span>
          </h1>
          <p>
            把日子放慢，把好牌打出去。
            <br />
            掼蛋、斗地主，还有一桌说不完的快乐。
          </p>
          <div className="hero-actions">
            <button
              className="button hero-play"
              data-testid="hero-practice"
              onClick={() => onPractice(kind, name, houseRule)}
            >
              <span>先来一局</span>
              <Icon name="arrow" size={19} />
            </button>
            <a className="hero-friends" href="#choose-game">
              约朋友开桌 <Icon name="arrow" size={16} />
            </a>
          </div>
          <div className="hero-features">
            <span>
              <Icon name="check" size={14} />
              无需下载
            </span>
            <span>
              <Icon name="check" size={14} />
              电脑随时陪练
            </span>
            <span>
              <Icon name="check" size={14} />
              手机电脑都能玩
            </span>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <span className="art-round-stamp">
            好 牌 · 好 朋 友<small>EST. 2026</small>
          </span>
          <span className="art-spark spark-one">✦</span>
          <span className="art-spark spark-two">✧</span>
          <div className="art-table">
            <div className="art-card art-card-one">
              <b>A</b>
              <span>♠</span>
              <i>♠</i>
            </div>
            <div className="art-card art-card-two">
              <b>A</b>
              <span>♥</span>
              <i>♥</i>
            </div>
            <div className="art-card art-card-three">
              <b>2</b>
              <span>♣</span>
              <i>♣</i>
            </div>
            <div className="art-tomato">
              <Tomato size={92} />
            </div>
            <div className="art-chip chip-one" />
            <div className="art-chip chip-two" />
            <span className="art-label">GOOD CARDS. GREAT COMPANY.</span>
          </div>
          <span className="art-chat">
            这把，默契拉满！<span>✧</span>
          </span>
          <span className="art-mini-heart">♥</span>
        </div>
      </section>
      {initialRoom && (
        <div
          className={`invite-banner ${restoring ? "restoring" : ""}`}
          role="status"
        >
          <Icon name="link" size={19} />
          <span>
            {restoring
              ? `正在尝试返回房间 ${initialRoom}，首次来访可填写昵称加入。`
              : `朋友在 ${initialRoom} 房间等你，填好昵称就能加入。`}
          </span>
        </div>
      )}
      <div className="lobby-section-title" id="choose-game">
        <div>
          <span className="eyebrow">PICK YOUR TABLE</span>
          <h2>今天，玩点什么？</h2>
        </div>
        <span>一张牌桌，两种快乐。</span>
      </div>
      <section className="lobby-controls">
        <div className="create-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">01 / 选个拿手的</span>
              <h2>你的快乐主场</h2>
            </div>
            <button className="text-link" onClick={() => onRules(kind)}>
              先看看玩法
              <Icon name="arrow" size={15} />
            </button>
          </div>
          <div className="game-picker" role="group" aria-label="选择游戏">
            <button
              className={`game-choice guandan-choice ${kind === "guandan" ? "chosen" : ""}`}
              data-testid="game-guandan"
              aria-pressed={kind === "guandan"}
              onClick={() => setKind("guandan")}
            >
              <span className="game-symbol guandan-symbol">
                <i>♥</i>
                <i>♠</i>
              </span>
              <span className="game-choice-copy">
                <strong>
                  经典掼蛋<span>默契搭档</span>
                </strong>
                <small>两两搭档，默契拉满</small>
                <em>4 人 · 双副牌 · 升级竞技</em>
              </span>
              <span className="radio-indicator">
                {kind === "guandan" && <Icon name="check" size={13} />}
              </span>
            </button>
            <button
              className={`game-choice doudizhu-choice ${kind === "doudizhu" ? "chosen" : ""}`}
              data-testid="game-doudizhu"
              aria-pressed={kind === "doudizhu"}
              onClick={() => setKind("doudizhu")}
            >
              <span className="game-symbol ddz-symbol">
                ♠<small>♠</small>
              </span>
              <span className="game-choice-copy">
                <strong>
                  欢乐斗地主<span>斗智斗勇</span>
                </strong>
                <small>三人一桌，各显神通</small>
                <em>3 人 · 叫分抢地主 · 经典玩法</em>
              </span>
              <span className="radio-indicator">
                {kind === "doudizhu" && <Icon name="check" size={13} />}
              </span>
            </button>
          </div>
          <div
            className={`house-rule ${kind === "doudizhu" ? "rule-hidden" : ""}`}
          >
            <label>
              <input
                type="checkbox"
                data-testid="house-rule"
                checked={houseRule}
                disabled={kind !== "guandan"}
                onChange={(event) => setHouseRule(event.target.checked)}
              />
              <span>开启朋友房规</span>
              <span className="mini-badge">可选</span>
            </label>
            <p>进贡、还贡后，双贡进贡方可弃任意一张手牌。</p>
          </div>
          <div className="lobby-play-actions">
            <button
              className="button button-practice"
              data-testid="start-practice"
              disabled={!!busy}
              onClick={() => onPractice(kind, name, houseRule)}
            >
              <span>✦</span> 单人练习 <Icon name="arrow" size={17} />
            </button>
            <button
              className="button button-primary create-button"
              data-testid="create-room"
              disabled={!!busy}
              onClick={() => void submit("create")}
            >
              <Icon name="plus" size={19} />
              {busy === "create" ? "正在准备牌桌…" : "开个房间"}
              <Icon name="arrow" size={19} />
            </button>
          </div>
          <p className="under-button">
            一个人也能即刻开玩 · 和朋友玩，先填昵称再开房
          </p>
        </div>
        <aside className="join-panel">
          <span className="join-decoration" aria-hidden="true">
            ✳
          </span>
          <span className="eyebrow">02 / 留个位置给你</span>
          <h2>朋友在等你？</h2>
          <p className="join-intro">带上昵称，来牌桌边坐坐。</p>
          <label className="field-label" htmlFor="nickname">
            你的昵称<span>让朋友一眼认出你</span>
          </label>
          <input
            ref={nicknameRef}
            id="nickname"
            data-testid="nickname"
            autoComplete="nickname"
            maxLength={16}
            placeholder="比如：番茄小能手"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <div className="field-divider">
            <span />
            已有房间
            <span />
          </div>
          <label className="field-label" htmlFor="room-code-input">
            房间号
          </label>
          <div className="room-input-wrap">
            <span>#</span>
            <input
              id="room-code-input"
              data-testid="room-code-input"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={10}
              placeholder="输入朋友的房间号"
              value={code}
              onChange={(event) =>
                setCode(
                  event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""),
                )
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit("join");
              }}
            />
          </div>
          <button
            className="button button-outline join-button"
            data-testid="join-room"
            disabled={!!busy || !code.trim()}
            onClick={() => void submit("join")}
          >
            {busy === "join" ? "正在入座…" : "加入好友房间"}
            <Icon name="arrow" size={18} />
          </button>
          <div className="join-note">
            <span>✦</span>
            <p>
              不必注册，不用客气。
              <br />
              留一把好牌，也留一点好心情。
            </p>
          </div>
        </aside>
      </section>
      <section className="club-notes" aria-label="牌桌小贴士">
        <div>
          <span className="note-illustration">
            ♠<i>♥</i>
          </span>
          <span>
            <strong>第一局？轻松上手。</strong>
            <small>认牌型、找搭档，一分钟认识你的下一局。</small>
          </span>
          <button onClick={() => onRules(kind)}>
            看看玩法 <Icon name="arrow" size={16} />
          </button>
        </div>
        <div>
          <Tomato size={37} />
          <span>
            <strong>牌技可以练，气氛必须到。</strong>
            <small>表情、语音、扔番茄，给朋友的好牌加点料。</small>
          </span>
        </div>
      </section>
      <section className="lobby-bottom">
        <div className="friend-avatars" aria-hidden="true">
          <span>🍊</span>
          <span>🥑</span>
          <span>🍓</span>
          <span>🍅</span>
        </div>
        <p>
          牌技可以一般，<strong>气氛必须到位。</strong>
        </p>
        <span className="bottom-quote">“这把稳了！”</span>
        <span className="bottom-quote">“不是哥们？”</span>
        <span className="bottom-quote wide-quote">“对，你说的太对了！”</span>
      </section>
    </main>
  );
}

function Seat({
  seat,
  player,
  position,
  current,
  mine,
  teammate,
  host,
  kind,
  landlord,
  finished,
  passed,
  choosing,
  disabled,
  tomatoMode,
  bubble,
  onSeat,
  onTomato,
}: {
  seat: number;
  player?: PublicPlayer;
  position: string;
  current: boolean;
  mine: boolean;
  teammate: boolean;
  host: boolean;
  kind: GameKind;
  landlord: boolean;
  finished?: number;
  passed?: boolean;
  choosing: boolean;
  disabled: boolean;
  tomatoMode: boolean;
  bubble?: Bubble;
  onSeat: () => void;
  onTomato: () => void;
}) {
  const avatars = ["🍅", "🥑", "🍊", "🍇"];
  return (
    <div
      className={`seat seat-${position} ${current ? "active-seat" : ""} ${!player ? "empty-seat" : ""}`}
      data-testid={`seat-${seat}`}
      data-player-id={player?.id}
    >
      {bubble && (
        <div
          className={`reaction-bubble ${bubble.voice ? "voice-bubble" : "emoji-bubble"}`}
          data-testid="reaction-bubble"
          role="status"
        >
          {bubble.voice && <Icon name="sound" size={13} />}
          {bubble.label}
        </div>
      )}
      {player ? (
        <>
          <button
            type="button"
            className={`avatar avatar-${seat} ${tomatoMode ? "tomato-target" : ""}`}
            aria-label={
              tomatoMode
                ? `向 ${player.name} 扔番茄`
                : `${player.name}${mine ? "，你" : ""}${current ? "，当前回合" : ""}`
            }
            data-testid={`avatar-${seat}`}
            disabled={!tomatoMode}
            onClick={onTomato}
          >
            <span>{avatars[seat]}</span>
            {current && <i className="turn-ring" />}
            {host && (
              <span className="host-crown" aria-label="房主">
                ♛
              </span>
            )}
            {!player.connected && (
              <span className="offline-dot" title="暂时离线" />
            )}
          </button>
          <span className="seat-name">
            {player.name}
            {mine && <small>你</small>}
          </span>
          <div className="seat-details">
            {teammate && <span className="partner-label">你的搭档</span>}
            {kind === "guandan" ? (
              <span className={`team-dot team-${seat % 2}`}>
                {seat % 2 === 0 ? "一队" : "二队"}
              </span>
            ) : landlord ? (
              <span className="landlord-label">地主</span>
            ) : !choosing ? (
              <span className="farmer-label">农民</span>
            ) : null}
            {choosing ? (
              <span className={`ready-label ${player.ready ? "is-ready" : ""}`}>
                {player.ready ? "已准备" : "未准备"}
              </span>
            ) : finished ? (
              <span className="finished-label">
                {finished === 1 ? "头游" : `${finished} 游`}
              </span>
            ) : (
              <span
                className={`card-count ${player.count <= 5 ? "low-count" : ""}`}
                data-testid={`count-${seat}`}
              >
                {player.count <= 5 && "⚑ "}
                {player.count} 张
              </span>
            )}
          </div>
          {passed && !finished && <span className="pass-label">不出</span>}
          {!player.connected && (
            <span className="seat-disconnected">正在重连</span>
          )}
        </>
      ) : (
        <button
          className="empty-seat-button"
          disabled={!choosing || disabled}
          data-testid={`choose-seat-${seat}`}
          onClick={onSeat}
        >
          <span>
            <Icon name="plus" size={22} />
          </span>
          <strong>虚位以待</strong>
          <small>
            {kind === "guandan"
              ? seat % 2 === 0
                ? "一队"
                : "二队"
              : `${seat + 1} 号座位`}
          </small>
        </button>
      )}
    </div>
  );
}

function ActionBar({
  snapshot,
  selected,
  isMyTurn,
  pending,
  onAction,
  canPlay,
  onHint,
  practice,
}: {
  snapshot: Snapshot;
  selected: string[];
  isMyTurn: boolean;
  pending: boolean;
  onAction: (action: RoomAction) => void;
  canPlay: boolean;
  onHint: () => void;
  practice: boolean;
}) {
  const { game, players, selfId, hostId } = snapshot;
  const self = players.find((player) => player.id === selfId)!;
  const seat = self.seat;
  const allReady =
    players.length === (snapshot.kind === "guandan" ? 4 : 3) &&
    players.every((player) => player.ready && player.connected);
  const isHost = selfId === hostId;
  if (!game)
    return (
      <div className="action-bar lobby-action">
        <span>
          {allReady
            ? "全员到齐，准备开局！"
            : `已准备 ${players.filter((player) => player.ready).length} / ${snapshot.kind === "guandan" ? 4 : 3} 人`}
        </span>
        <div>
          <button
            className={`button ${self.ready ? "button-soft" : "button-primary"}`}
            data-testid="ready"
            disabled={pending}
            onClick={() => onAction({ type: "READY", ready: !self.ready })}
          >
            {self.ready ? (
              <>
                <Icon name="check" size={18} />
                已准备 · 取消
              </>
            ) : (
              "准备好了"
            )}
          </button>
          {isHost && (
            <button
              className="button button-tomato"
              data-testid="start-game"
              disabled={pending || !allReady}
              onClick={() => onAction({ type: "START_GAME" })}
            >
              开始游戏
              <Icon name="arrow" size={18} />
            </button>
          )}
        </div>
      </div>
    );
  if (game.phase === "finished")
    return (
      <div className="action-bar finished-action">
        <span>
          {isHost
            ? practice
              ? "手感正热，再练一局？"
              : "朋友都在，再来一局？"
            : "等房主开启下一局，也可以先聊两句。"}
        </span>
        {isHost && (
          <button
            className="button button-primary"
            data-testid="next-game"
            disabled={pending}
            onClick={() => onAction({ type: "START_GAME" })}
          >
            再来一局
            <Icon name="arrow" size={18} />
          </button>
        )}
      </div>
    );
  if (game.phase === "bidding")
    return (
      <div className="action-bar">
        <span className="action-hint">
          {isMyTurn
            ? "叫一个比当前更高的分数，或选择不叫"
            : "稍等一下，其他玩家正在叫分"}
        </span>
        <div className="bid-actions">
          <button
            className="button button-soft"
            data-testid="bid-0"
            disabled={!isMyTurn || pending}
            onClick={() => onAction({ type: "BID", value: 0 })}
          >
            不叫
          </button>
          {[1, 2, 3].map((value) => (
            <button
              key={value}
              className="button button-primary"
              data-testid={`bid-${value}`}
              disabled={!isMyTurn || pending || value <= (game.highBid ?? 0)}
              onClick={() => onAction({ type: "BID", value })}
            >
              {value} 分
            </button>
          ))}
        </div>
      </div>
    );
  if (
    game.phase === "tribute" ||
    game.phase === "return" ||
    game.phase === "discard"
  ) {
    const tribute = game.tribute;
    const eligible =
      game.phase === "tribute"
        ? tribute?.contributors.includes(seat) &&
          !Object.hasOwn(tribute.selections, seat)
        : game.phase === "return"
          ? tribute?.pairs.some((pair) => pair.to === seat) &&
            !tribute.returned.includes(seat)
          : tribute?.contributors.includes(seat) &&
            !tribute.discarded.includes(seat);
    const label =
      game.phase === "tribute"
        ? "确认进贡"
        : game.phase === "return"
          ? "确认还贡"
          : "弃掉这张";
    const action: RoomAction =
      game.phase === "tribute"
        ? { type: "SELECT_TRIBUTE", cardId: selected[0] }
        : game.phase === "return"
          ? { type: "SELECT_RETURN_CARD", cardId: selected[0] }
          : { type: "DISCARD_HOUSE_RULE", cardId: selected[0] };
    return (
      <div className="action-bar">
        <span className="action-hint">
          {eligible
            ? game.phase === "discard"
              ? "选择任意一张自己的牌，或跳过弃牌"
              : `请选择一张手牌${game.phase === "tribute" ? "进贡" : "还贡"}`
            : `等待其他玩家完成${phaseLabels[game.phase]}`}
        </span>
        {eligible && (
          <div>
            {game.phase === "discard" && (
              <button
                className="button button-soft"
                data-testid="skip-discard"
                disabled={pending}
                onClick={() =>
                  onAction({ type: "DISCARD_HOUSE_RULE", cardId: null })
                }
              >
                跳过弃牌
              </button>
            )}
            <button
              className="button button-primary"
              data-testid={
                game.phase === "tribute"
                  ? "submit-tribute"
                  : game.phase === "return"
                    ? "submit-return"
                    : "submit-discard"
              }
              disabled={pending || selected.length !== 1}
              onClick={() => onAction(action)}
            >
              {label}
              <Icon name="arrow" size={17} />
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="action-bar">
      <span className={`action-hint ${isMyTurn ? "active-hint" : ""}`}>
        {isMyTurn ? (
          <>
            <span className="pulse-dot" />
            轮到你了，打出你的好牌
          </>
        ) : (
          "看看牌，想想下一手"
        )}
      </span>
      <div>
        <button
          className="button button-hint"
          data-testid="hint"
          disabled={pending || !isMyTurn}
          onClick={onHint}
          title="选出一手推荐牌，再点一次换一手"
        >
          <span>✧</span> 提示 <kbd>H</kbd>
        </button>
        <button
          className="button button-soft"
          data-testid="pass"
          disabled={
            pending || !isMyTurn || !game.trick || game.trick.seat === seat
          }
          onClick={() => onAction({ type: "PASS" })}
        >
          不出
        </button>
        <button
          className="button button-primary play-button"
          data-testid="play-cards"
          disabled={pending || !isMyTurn || !canPlay}
          onClick={() => onAction({ type: "PLAY_CARDS", cardIds: selected })}
        >
          出牌{selected.length > 0 && <span>{selected.length}</span>}
          <Icon name="arrow" size={18} />
        </button>
      </div>
    </div>
  );
}

function Rules({ initialKind }: { initialKind: GameKind }) {
  const [kind, setKind] = useState(initialKind);
  return (
    <div className="rules">
      <div className="rules-tabs">
        <button
          className={kind === "guandan" ? "active" : ""}
          onClick={() => setKind("guandan")}
        >
          经典掼蛋
        </button>
        <button
          className={kind === "doudizhu" ? "active" : ""}
          onClick={() => setKind("doudizhu")}
        >
          欢乐斗地主
        </button>
      </div>
      {kind === "guandan" ? (
        <>
          <div className="rule-intro">
            <span>4 人 · 2 副牌 · 27 张起手</span>
            <p>隔位搭档，同进同退。从 2 打到 A，合作赢下这一场。</p>
          </div>
          <div className="rule-grid">
            <div>
              <b>01</b>
              <h3>级牌与逢人配</h3>
              <p>
                本局级牌大于
                A、小于王。红桃级牌是逢人配，可在允许的牌型中替代普通牌；单独出时仍是级牌。
              </p>
            </div>
            <div>
              <b>02</b>
              <h3>出牌与压制</h3>
              <p>
                单张、对子、三张、三带二、五张顺子、三连对和两组三连。相同牌型比较大小，炸弹可压普通牌，同花顺与更大炸弹按规则比较。
              </p>
            </div>
            <div>
              <b>03</b>
              <h3>搭档与升级</h3>
              <p>
                先出完为头游。搭档第二、第三、第四出完，分别升 3、2、1
                级。有人出完后，牌权按接风规则继续。
              </p>
            </div>
            <div>
              <b>04</b>
              <h3>进贡、还贡、抗贡</h3>
              <p>
                下一局按上一局名次单贡或双贡。进贡最大非逢人配牌；还贡优先选 10
                或以下非级牌；没有时还最小非逢人配牌。满足双大王条件时抗贡。
              </p>
            </div>
          </div>
          <div className="house-rule-explainer">
            <strong>🍅 朋友房规，可在创建时开启</strong>
            <p>
              仅在双贡进贡与还贡完成后，两位进贡方各可公开弃掉任意一张自己的手牌，也可以跳过。弃牌会记入公开记录。单贡、抗贡时不适用。
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="rule-intro">
            <span>3 人 · 1 副牌 · 17 张起手</span>
            <p>一人当地主，两人做搭档。先出完手牌的一方获胜。</p>
          </div>
          <div className="rule-grid">
            <div>
              <b>01</b>
              <h3>叫分定地主</h3>
              <p>
                依次选择不叫或 1、2、3
                分，只能叫更高分。最高分成为地主，拿走并公开 3 张底牌；3
                分立即确定地主。全员不叫则重新发牌。
              </p>
            </div>
            <div>
              <b>02</b>
              <h3>跟牌与不出</h3>
              <p>
                地主先出。相同牌型按主牌点数比较，2 大于 A，王大于
                2。顺子和连对不能包含 2 或王。跟不上可选择不出。
              </p>
            </div>
            <div>
              <b>03</b>
              <h3>组合与炸弹</h3>
              <p>
                支持三带一、三带二、连对、飞机带翅膀和四带二。四张相同点数是炸弹，两张王是火箭；炸弹和火箭会增加倍数。
              </p>
            </div>
            <div>
              <b>04</b>
              <h3>合作与结算</h3>
              <p>
                地主先出完则地主获胜，任一农民先出完则农民共同获胜。积分按叫分、炸弹与春天等倍数结算，仅作朋友间记录。
              </p>
            </div>
          </div>
        </>
      )}
      <p className="rules-footnote">
        提示：所有出牌都由房间统一校验。游戏仅供朋友娱乐，不涉及真钱或兑换。
      </p>
    </div>
  );
}
