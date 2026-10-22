export interface Reaction {
  id: string;
  label: string;
  audioPath: string | null;
  duration: number;
  category: "emoji" | "voice";
}

export const REACTIONS: Reaction[] = [
  {
    id: "laugh",
    label: "😂",
    audioPath: "/sounds/pop.wav",
    duration: 2200,
    category: "emoji",
  },
  {
    id: "applause",
    label: "👏",
    audioPath: "/sounds/chime.wav",
    duration: 2200,
    category: "emoji",
  },
  {
    id: "thumbsup",
    label: "👍",
    audioPath: "/sounds/pop.wav",
    duration: 2200,
    category: "emoji",
  },
  {
    id: "surprise",
    label: "😮",
    audioPath: "/sounds/pop.wav",
    duration: 2200,
    category: "emoji",
  },
  {
    id: "cry",
    label: "😭",
    audioPath: "/sounds/pop.wav",
    duration: 2200,
    category: "emoji",
  },
  {
    id: "thinking",
    label: "🤔",
    audioPath: "/sounds/pop.wav",
    duration: 2200,
    category: "emoji",
  },
  {
    id: "sunglasses",
    label: "😎",
    audioPath: "/sounds/chime.wav",
    duration: 2200,
    category: "emoji",
  },
  {
    id: "facepalm",
    label: "🤦",
    audioPath: "/sounds/pop.wav",
    duration: 2200,
    category: "emoji",
  },
  {
    id: "heart",
    label: "❤️",
    audioPath: "/sounds/chime.wav",
    duration: 2200,
    category: "emoji",
  },
  {
    id: "fire",
    label: "🔥",
    audioPath: "/sounds/chime.wav",
    duration: 2200,
    category: "emoji",
  },
  {
    id: "handshake",
    label: "🤝",
    audioPath: "/sounds/pop.wav",
    duration: 2200,
    category: "emoji",
  },
  {
    id: "tomato-face",
    label: "🍅",
    audioPath: "/sounds/pop.wav",
    duration: 2200,
    category: "emoji",
  },
  {
    id: "you-are-so-right",
    label: "对，你说的太对了！",
    audioPath: null,
    duration: 4200,
    category: "voice",
  },
  {
    id: "bro-really",
    label: "不是哥们？",
    audioPath: null,
    duration: 3200,
    category: "voice",
  },
  {
    id: "can-you-play",
    label: "你会不会玩？",
    audioPath: null,
    duration: 3200,
    category: "voice",
  },
  {
    id: "we-got-this",
    label: "这把稳了！",
    audioPath: null,
    duration: 3200,
    category: "voice",
  },
  {
    id: "six-six-six",
    label: "666！",
    audioPath: null,
    duration: 3200,
    category: "voice",
  },
  {
    id: "stay-calm",
    label: "不要慌！",
    audioPath: null,
    duration: 3200,
    category: "voice",
  },
  {
    id: "i-give-up",
    label: "我真服了！",
    audioPath: null,
    duration: 3200,
    category: "voice",
  },
  {
    id: "how-did-we-lose",
    label: "这也能输？",
    audioPath: null,
    duration: 3200,
    category: "voice",
  },
  {
    id: "beautiful",
    label: "漂亮！",
    audioPath: null,
    duration: 3200,
    category: "voice",
  },
  {
    id: "what-are-you-doing",
    label: "你在干什么？",
    audioPath: null,
    duration: 3200,
    category: "voice",
  },
];

export const SOUNDBOARD = REACTIONS;
export const findReaction = (id: string): Reaction | undefined =>
  REACTIONS.find((reaction) => reaction.id === id);
