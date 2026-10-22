import { useState } from "react";
import { zhCN } from "./i18n";
import type { PracticePace, SavedPractice } from "./practice-save";

export const PRACTICE_DELAYS: Record<PracticePace, number> = {
  relaxed: 1800,
  normal: 1050,
  quick: 450,
};

export function PracticeTools({
  paused,
  pace,
  canUndo,
  saved,
  finished,
  onPause,
  onPace,
  onUndo,
}: {
  paused: boolean;
  pace: PracticePace;
  canUndo: boolean;
  saved: boolean;
  finished: boolean;
  onPause: () => void;
  onPace: (pace: PracticePace) => void;
  onUndo: () => void;
}) {
  const [optionsOpen, setOptionsOpen] = useState(false);

  return (
    <section
      className={`practice-tools ${paused ? "is-paused" : ""} ${optionsOpen ? "options-open" : ""}`}
      aria-label="练习控制"
    >
      <div className="practice-tools-copy">
        <span className="practice-mark" aria-hidden="true">
          ✦
        </span>
        <div>
          <strong>
            {paused ? "歇一会儿，好牌等你。" : "放心试，每一手都能学点新招。"}
          </strong>
          <span data-testid="practice-save-status">
            {saved
              ? "进度已保存在此浏览器 · 随时回来接着玩"
              : "本次无法保存，关闭页面后进度会丢失"}
          </span>
        </div>
      </div>
      <div className="practice-controls">
        <button
          type="button"
          className="practice-options-toggle"
          data-testid="practice-options"
          aria-expanded={optionsOpen}
          onClick={() => setOptionsOpen((value) => !value)}
        >
          <span aria-hidden="true">⚙</span>{" "}
          {optionsOpen ? "收起设置" : "更多设置"}
        </button>
        <div className="practice-secondary">
          <label className="practice-pace">
            <span>电脑节奏</span>
            <select
              data-testid="practice-pace"
              value={pace}
              onChange={(event) => onPace(event.target.value as PracticePace)}
            >
              <option value="relaxed">慢慢想</option>
              <option value="normal">刚刚好</option>
              <option value="quick">快一点</option>
            </select>
          </label>
          <button
            className="practice-control"
            data-testid="practice-undo"
            disabled={!canUndo}
            onClick={onUndo}
            title="回到你上次操作之前，电脑的后续出牌也会撤回"
          >
            <span aria-hidden="true">↶</span> 悔一步
          </button>
        </div>
        <button
          className="practice-control pause-control"
          data-testid="practice-pause"
          aria-pressed={paused}
          disabled={finished}
          onClick={onPause}
        >
          <span aria-hidden="true">{paused ? "▷" : "Ⅱ"}</span>{" "}
          {paused ? "继续" : "暂停"}
        </button>
      </div>
    </section>
  );
}

export function ResumePractice({
  saved,
  persistent,
  onResume,
}: {
  saved: SavedPractice;
  persistent: boolean;
  onResume: () => void;
}) {
  const game = saved.session.game;
  return (
    <section
      className="resume-practice"
      aria-label="上次的练习"
      data-testid="saved-practice"
    >
      <div className="resume-illustration" aria-hidden="true">
        <span>♠</span>
        <span>♥</span>
      </div>
      <div className="resume-copy">
        <span className="eyebrow">YOUR SEAT IS SAVED</span>
        <h2>
          {game.phase === "finished"
            ? "上一局的余兴，还没散。"
            : "你的牌，替你留着呢。"}
        </h2>
        <p>
          {zhCN.games[game.kind]} · 第 {game.handNumber} 局 ·{" "}
          {game.phase === "finished"
            ? "已结算"
            : `手中还有 ${game.hands[0].length} 张牌`}
          <span>
            {persistent
              ? "仅保存在此浏览器，新练习会替换此存档"
              : "暂存在本页，关闭页面后将无法继续"}
          </span>
        </p>
      </div>
      <button
        className="button button-primary"
        data-testid="resume-practice"
        onClick={onResume}
      >
        {game.phase === "finished" ? "看看上局" : "继续上次"}
        <span aria-hidden="true">→</span>
      </button>
    </section>
  );
}
