import type { Reaction } from "../shared/soundboard";

export interface SoundSettings {
  enabled: boolean;
  volume: number;
  gentle: boolean;
}

export type SoundCue =
  | "select"
  | "deal"
  | "play"
  | "pass"
  | "turn"
  | "bomb"
  | "win"
  | "lose"
  | "tomato";

const DEFAULT_SETTINGS: SoundSettings = {
  enabled: false,
  volume: 0.65,
  gentle: false,
};

const MAX_VOLUME = 0.82;
const VOICE_GAIN = 0.72;
const EFFECT_GAIN = 0.52;

type AudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

interface ActiveSource {
  source: AudioScheduledSourceNode;
  nodes: AudioNode[];
}

let settings: SoundSettings = { ...DEFAULT_SETTINGS };
let audioContext: AudioContext | undefined;
let masterGain: GainNode | undefined;
let currentVoiceAudio: HTMLAudioElement | undefined;
const activeSources = new Set<ActiveSource>();
const activeAudio = new Set<HTMLAudioElement>();
const audioCancelers = new Map<HTMLAudioElement, () => void>();
const recentSelectTimes: number[] = [];
const MAX_ACTIVE_SOURCES = 48;

function clamp(value: number, min = 0, max = 1): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

function effectiveVolume(multiplier = 1): number {
  return clamp(
    clamp(settings.volume) *
      MAX_VOLUME *
      multiplier *
      (settings.gentle ? 0.78 : 1),
    0,
    MAX_VOLUME,
  );
}

function getAudioContext(): AudioContext | undefined {
  if (audioContext) return audioContext;
  if (typeof window === "undefined") return undefined;

  const browserWindow = window as AudioWindow;
  const Context = window.AudioContext || browserWindow.webkitAudioContext;
  if (!Context) return undefined;

  try {
    audioContext = new Context();
    masterGain = audioContext.createGain();
    masterGain.gain.value = effectiveVolume();
    masterGain.connect(audioContext.destination);
    return audioContext;
  } catch {
    audioContext = undefined;
    masterGain = undefined;
    return undefined;
  }
}

function updateMasterGain(): void {
  if (!audioContext || !masterGain) return;
  const now = audioContext.currentTime;
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setTargetAtTime(
    settings.enabled ? effectiveVolume() : 0,
    now,
    0.018,
  );
}

function releaseSource(active: ActiveSource, stop: boolean): void {
  activeSources.delete(active);
  active.source.onended = null;
  try {
    if (stop) active.source.stop();
  } catch {
    // A source that has already ended is safe to ignore.
  }
  for (const node of active.nodes) {
    try {
      node.disconnect();
    } catch {
      // A disconnected node is already fully released.
    }
  }
}

function stopSource(active: ActiveSource): void {
  releaseSource(active, true);
}

function stopAllSources(): void {
  for (const source of [...activeSources]) stopSource(source);
}

function releaseAudio(audio: HTMLAudioElement, stop = false): void {
  activeAudio.delete(audio);
  audioCancelers.delete(audio);
  if (currentVoiceAudio === audio) currentVoiceAudio = undefined;
  audio.onended = null;
  audio.onerror = null;
  if (!stop) return;
  try {
    audio.pause();
    audio.currentTime = 0;
  } catch {
    // A media element may be in the middle of loading or already released.
  }
}

function cancelAudio(audio: HTMLAudioElement): void {
  const cancel = audioCancelers.get(audio);
  if (cancel) {
    cancel();
    return;
  }
  releaseAudio(audio, true);
}

function stopAllAudio(): void {
  for (const audio of [...activeAudio]) cancelAudio(audio);
  currentVoiceAudio = undefined;
}

function masterFor(context: AudioContext): GainNode | undefined {
  if (masterGain) return masterGain;
  try {
    masterGain = context.createGain();
    masterGain.connect(context.destination);
    updateMasterGain();
    return masterGain;
  } catch {
    return undefined;
  }
}

function trackSource(
  source: AudioScheduledSourceNode,
  nodes: AudioNode[],
): ActiveSource {
  if (activeSources.size >= MAX_ACTIVE_SOURCES) {
    const oldest = activeSources.values().next().value as
      ActiveSource | undefined;
    if (oldest) stopSource(oldest);
  }
  const active = { source, nodes };
  activeSources.add(active);
  source.onended = () => releaseSource(active, false);
  return active;
}

function scheduleTone(
  context: AudioContext,
  start: number,
  frequency: number,
  duration: number,
  amplitude: number,
  waveform: OscillatorType = "sine",
  glideTo?: number,
): void {
  const output = masterFor(context);
  if (!output) return;

  let active: ActiveSource | undefined;
  try {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const safeDuration = Math.max(0.045, duration);
    const attack = Math.min(0.025, safeDuration * 0.3);
    const peak = clamp(amplitude, 0.0001, 0.85);
    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (glideTo !== undefined) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(20, glideTo),
        start + safeDuration,
      );
    }
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(peak, start + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + safeDuration);
    oscillator.connect(envelope).connect(output);
    active = trackSource(oscillator, [oscillator, envelope]);
    oscillator.start(start);
    oscillator.stop(start + safeDuration + 0.025);
  } catch {
    // The source may have been tracked before a browser rejected its schedule.
    if (active) stopSource(active);
    // Web Audio is an optional enhancement; a failed context must not affect play.
  }
}

function scheduleNoise(
  context: AudioContext,
  start: number,
  duration: number,
  amplitude: number,
  filterFrequency: number,
): void {
  const output = masterFor(context);
  if (!output) return;

  let active: ActiveSource | undefined;
  try {
    const length = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * (1 - index / data.length);
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    const safeDuration = Math.max(0.04, duration);
    source.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(filterFrequency, start);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.linearRampToValueAtTime(
      clamp(amplitude, 0.0001, 0.6),
      start + Math.min(0.018, safeDuration * 0.25),
    );
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + safeDuration);
    source.connect(filter).connect(envelope).connect(output);
    active = trackSource(source, [source, filter, envelope]);
    source.start(start);
    source.stop(start + safeDuration + 0.02);
  } catch {
    if (active) stopSource(active);
    // See scheduleTone: sound should never make a card action fail.
  }
}

function schedulePattern(
  cue: SoundCue | "surprise" | "thinking" | "positive" | "confused",
): void {
  const context = getAudioContext();
  if (!context || !settings.enabled || effectiveVolume() <= 0) return;
  // Do not queue sounds while autoplay policy has suspended the context. The
  // next user gesture will explicitly call unlockAudio instead.
  if (context.state === "suspended") return;
  const start = context.currentTime + 0.008;
  const gain = EFFECT_GAIN;
  const gentleScale = settings.gentle ? 0.6 : 1;
  const tone = (
    offset: number,
    frequency: number,
    duration: number,
    amplitude: number,
    waveform: OscillatorType = "sine",
    glideTo?: number,
  ) =>
    scheduleTone(
      context,
      start + offset,
      frequency,
      duration,
      amplitude * gain * gentleScale,
      waveform,
      glideTo,
    );

  switch (cue) {
    case "select":
      tone(0, 610, 0.12, 0.3, "triangle");
      tone(0.015, 920, 0.085, 0.11, "sine");
      scheduleNoise(context, start + 0.006, 0.055, 0.08, 2500);
      break;
    case "deal":
      tone(0, 180, 0.095, 0.2, "triangle");
      tone(0.012, 360, 0.12, 0.13, "sine");
      scheduleNoise(context, start, 0.075, 0.11, 1900);
      break;
    case "play":
      tone(0, 440, 0.14, 0.23, "triangle");
      tone(0.06, 554, 0.16, 0.18, "triangle");
      scheduleNoise(context, start + 0.008, 0.075, 0.1, 2300);
      break;
    case "pass":
      tone(0, 370, 0.13, 0.2, "sine");
      tone(0.075, 294, 0.15, 0.18, "triangle");
      break;
    case "turn":
      tone(0, 392, 0.12, 0.2, "sine");
      tone(0.07, 494, 0.13, 0.2, "sine");
      tone(0.14, 659, 0.19, 0.22, "triangle");
      break;
    case "bomb":
      tone(0, 104, settings.gentle ? 0.13 : 0.24, 0.34, "sine");
      tone(0.025, 156, settings.gentle ? 0.1 : 0.2, 0.14, "triangle");
      scheduleNoise(
        context,
        start + 0.015,
        settings.gentle ? 0.08 : 0.2,
        gain * (settings.gentle ? 0.1 : 0.22),
        920,
      );
      break;
    case "win":
    case "positive":
      tone(0, 392, 0.13, 0.2, "triangle");
      tone(0.075, 494, 0.14, 0.2, "triangle");
      tone(0.15, 587, 0.15, 0.2, "triangle");
      tone(0.225, 784, 0.24, 0.24, "sine");
      break;
    case "lose":
    case "confused":
      tone(0, 392, 0.16, 0.2, "sine");
      tone(0.1, 330, 0.16, 0.19, "triangle");
      tone(0.2, 247, 0.24, 0.2, "sine");
      break;
    case "tomato":
      tone(0, 210, 0.2, 0.25, "sine", 880);
      tone(0.085, 560, 0.14, 0.16, "triangle", 760);
      scheduleNoise(
        context,
        start + 0.075,
        settings.gentle ? 0.08 : 0.13,
        gain * (settings.gentle ? 0.1 : 0.16),
        620,
      );
      break;
    case "surprise":
      tone(0, 270, 0.2, 0.24, "triangle", 860);
      tone(0.085, 1080, 0.15, 0.15, "sine", 740);
      break;
    case "thinking":
      tone(0, 330, 0.14, 0.19, "sine");
      tone(0.16, 392, 0.14, 0.18, "sine");
      tone(0.32, 330, 0.18, 0.17, "triangle");
      break;
  }
}

function reactionCue(
  reaction: Reaction | "tomato",
): SoundCue | "surprise" | "thinking" | "positive" | "confused" {
  if (reaction === "tomato") return "tomato";
  switch (reaction.id) {
    case "laugh":
    case "applause":
    case "thumbsup":
    case "heart":
    case "fire":
    case "handshake":
    case "sunglasses":
    case "beautiful":
    case "we-got-this":
    case "six-six-six":
      return "positive";
    case "surprise":
      return "surprise";
    case "thinking":
      return "thinking";
    case "cry":
    case "i-give-up":
    case "how-did-we-lose":
      return "lose";
    case "facepalm":
    case "bro-really":
    case "can-you-play":
    case "stay-calm":
    case "what-are-you-doing":
      return "confused";
    case "tomato-face":
      return "tomato";
    default:
      return reaction.category === "voice" ? "thinking" : "positive";
  }
}

function playReactionFallback(reaction: Reaction | "tomato"): void {
  if (!settings.enabled || effectiveVolume() <= 0) return;
  schedulePattern(reactionCue(reaction));
}

function cancelCurrentVoice(): void {
  if (currentVoiceAudio) cancelAudio(currentVoiceAudio);
  currentVoiceAudio = undefined;
}

function playAudioAsset(
  path: string,
  reaction: Reaction | "tomato",
  isVoice: boolean,
): void {
  if (typeof window === "undefined" || typeof Audio === "undefined") {
    playReactionFallback(reaction);
    return;
  }

  let audio: HTMLAudioElement;
  try {
    audio = new Audio(path);
    audio.preload = "auto";
  } catch {
    playReactionFallback(reaction);
    return;
  }

  activeAudio.add(audio);
  if (isVoice) currentVoiceAudio = audio;
  let settled = false;
  const cleanup = (stop: boolean) => {
    if (settled && !stop) return;
    settled = true;
    releaseAudio(audio, stop);
  };
  const finish = (failed: boolean) => {
    if (settled) return;
    cleanup(false);
    if (failed && settings.enabled) playReactionFallback(reaction);
  };
  audioCancelers.set(audio, () => cleanup(true));
  audio.volume = effectiveVolume(isVoice ? VOICE_GAIN : 0.88);
  audio.onended = () => finish(false);
  audio.onerror = () => finish(true);

  try {
    void audio.play().catch(() => finish(true));
  } catch {
    finish(true);
  }
}

/** Resume the optional Web Audio context from a user gesture. */
export async function unlockAudio(): Promise<void> {
  const context = getAudioContext();
  if (!context || context.state !== "suspended") return;
  await context.resume().catch(() => undefined);
}

/** Apply current settings immediately to procedural and HTML audio. */
export function syncAudioSettings(next: SoundSettings): void {
  const wasGentle = settings.gentle;
  settings = {
    enabled: Boolean(next.enabled),
    volume: clamp(next.volume),
    gentle: Boolean(next.gentle),
  };
  if (settings.gentle && !wasGentle) cancelCurrentVoice();
  updateMasterGain();
  for (const audio of activeAudio) {
    audio.volume = effectiveVolume(
      currentVoiceAudio === audio ? VOICE_GAIN : 0.88,
    );
  }
  if (!settings.enabled || effectiveVolume() <= 0) {
    stopAllSources();
    stopAllAudio();
  }
}

export function playCue(cue: SoundCue): void {
  if (!settings.enabled || effectiveVolume() <= 0) return;
  if (cue === "select") {
    const now = Date.now();
    while (recentSelectTimes.length > 0 && now - recentSelectTimes[0] > 180) {
      recentSelectTimes.shift();
    }
    if (recentSelectTimes.length >= 3) return;
    recentSelectTimes.push(now);
  }
  schedulePattern(cue);
}

export function playReaction(reaction: Reaction | "tomato"): void {
  cancelCurrentVoice();
  if (!settings.enabled || effectiveVolume() <= 0) return;

  if (
    reaction !== "tomato" &&
    reaction.category === "voice" &&
    settings.gentle
  ) {
    playReactionFallback(reaction);
    return;
  }

  // Emoji reactions and tomato have expressive procedural cues. Voice
  // reactions alone use their supplied clip, with a motif as the fallback.
  const path =
    reaction !== "tomato" && reaction.category === "voice"
      ? reaction.audioPath
      : null;
  if (!path) {
    playReactionFallback(reaction);
    return;
  }
  playAudioAsset(
    path,
    reaction,
    reaction !== "tomato" && reaction.category === "voice",
  );
}
