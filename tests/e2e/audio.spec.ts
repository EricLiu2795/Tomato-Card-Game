import { expect, test, type Page } from "@playwright/test";
import { REACTIONS } from "../../shared/soundboard";

type Playback = { src: string; volume: number };

declare global {
  interface Window {
    __acceptancePlayback: Playback[];
    __acceptancePauses: number;
    __acceptanceSpeech: string[];
    __acceptanceCueStarts: number;
  }
}

async function installPlaybackObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const windowWithAudio = window as Window & {
      __acceptancePlayback: Playback[];
      __acceptancePauses: number;
      __acceptanceSpeech: string[];
      __acceptanceCueStarts: number;
    };
    windowWithAudio.__acceptancePlayback = [];
    windowWithAudio.__acceptancePauses = 0;
    windowWithAudio.__acceptanceSpeech = [];
    windowWithAudio.__acceptanceCueStarts = 0;
    const originalPlay = HTMLMediaElement.prototype.play;
    const originalPause = HTMLMediaElement.prototype.pause;
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: function (this: HTMLMediaElement) {
        windowWithAudio.__acceptancePlayback.push({
          src: this.currentSrc || this.src,
          volume: this.volume,
        });
        return originalPlay.call(this);
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: function (this: HTMLMediaElement) {
        windowWithAudio.__acceptancePauses += 1;
        return originalPause.call(this);
      },
    });
    if ("AudioBufferSourceNode" in window) {
      const sourcePrototype = AudioBufferSourceNode.prototype;
      const originalStart = sourcePrototype.start;
      Object.defineProperty(sourcePrototype, "start", {
        configurable: true,
        value: function (
          this: AudioBufferSourceNode,
          ...args: Parameters<typeof originalStart>
        ) {
          windowWithAudio.__acceptanceCueStarts += 1;
          return originalStart.apply(this, args);
        },
      });
    }
    if ("speechSynthesis" in window) {
      const speech = window.speechSynthesis;
      const originalSpeak = speech.speak.bind(speech);
      Object.defineProperty(speech, "speak", {
        configurable: true,
        value: (utterance: SpeechSynthesisUtterance) => {
          windowWithAudio.__acceptanceSpeech.push(utterance.text);
          return originalSpeak(utterance);
        },
      });
    }
  });
}

async function openSoundSettings(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByTestId("settings").click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("local voice clips decode and preview through HTML audio", async ({
  page,
}) => {
  await installPlaybackObserver(page);
  await openSoundSettings(page);
  await page.getByTestId("sound-switch").click();
  await expect(page.getByTestId("sound-switch")).toHaveAttribute(
    "aria-checked",
    "true",
  );

  for (const path of REACTIONS.filter(
    (reaction) => reaction.category === "voice",
  )
    .slice(0, 3)
    .map((reaction) => reaction.audioPath!)) {
    const decoded = await page.evaluate(async (source) => {
      const audio = new Audio(source);
      audio.preload = "auto";
      return await new Promise<boolean>((resolve) => {
        audio.addEventListener("canplaythrough", () => resolve(true), {
          once: true,
        });
        audio.addEventListener("error", () => resolve(false), { once: true });
        audio.load();
      });
    }, path);
    expect(decoded, path).toBe(true);
  }

  const reactionPath = "/sounds/voices/we-got-this.mp3";
  const volume = page.getByTestId("volume");
  await volume.fill("0.85");
  await page.getByTestId("preview-we-got-this").click();
  await expect
    .poll(() =>
      page.evaluate(
        (path) =>
          window.__acceptancePlayback.some(
            (playback) => playback.src.endsWith(path) && playback.volume > 0,
          ),
        reactionPath,
      ),
    )
    .toBe(true);
  const volumeAt85 = await page.evaluate(
    (path) =>
      window.__acceptancePlayback.find((playback) =>
        playback.src.endsWith(path),
      )?.volume ?? 0,
    reactionPath,
  );
  await volume.fill("1");
  await page.getByTestId("preview-we-got-this").click();
  await expect
    .poll(() =>
      page.evaluate(
        (path) =>
          window.__acceptancePlayback.filter((playback) =>
            playback.src.endsWith(path),
          ).length,
        reactionPath,
      ),
    )
    .toBeGreaterThan(1);
  const volumeAt100 = await page.evaluate((path) => {
    const matches = window.__acceptancePlayback.filter((playback) =>
      playback.src.endsWith(path),
    );
    return matches[matches.length - 1]?.volume ?? 0;
  }, reactionPath);
  expect(volumeAt100).toBeGreaterThan(volumeAt85);
  await page.getByTestId("preview-table-sound").click();
  await expect
    .poll(() => page.evaluate(() => window.__acceptanceCueStarts))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__acceptanceSpeech)).toEqual([]);
});

test("muting and gentle mode cancel active voice previews immediately", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await installPlaybackObserver(page);
  await openSoundSettings(page);
  await page.getByTestId("sound-switch").click();
  await page.getByTestId("preview-bro-really").click();
  await expect
    .poll(() => page.evaluate(() => window.__acceptancePlayback.length))
    .toBeGreaterThan(0);

  const gentleSwitch = page.getByRole("switch").nth(1);
  await gentleSwitch.click();
  await expect
    .poll(() => page.evaluate(() => window.__acceptancePauses))
    .toBeGreaterThan(0);

  await gentleSwitch.click();
  await page.getByTestId("preview-bro-really").click();
  await expect
    .poll(() => page.evaluate(() => window.__acceptancePlayback.length))
    .toBeGreaterThan(1);
  const pausesBeforeMute = await page.evaluate(() => window.__acceptancePauses);
  const playbackCount = await page.evaluate(
    () => window.__acceptancePlayback.length,
  );
  await page.getByTestId("sound-switch").click();
  await expect(page.getByTestId("sound-switch")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await page.waitForTimeout(150);
  await expect
    .poll(() => page.evaluate(() => window.__acceptancePauses))
    .toBeGreaterThan(pausesBeforeMute);
  expect(await page.evaluate(() => window.__acceptancePlayback.length)).toBe(
    playbackCount,
  );
  expect(await page.evaluate(() => window.__acceptanceSpeech)).toEqual([]);
  expect(pageErrors).toEqual([]);
});
