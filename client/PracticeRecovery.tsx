import type { PracticeSaveReadResult } from "./practice-save";

export function PracticeRecovery({
  result,
}: {
  result: PracticeSaveReadResult;
}) {
  if (result.status !== "invalid" && result.status !== "unsupported")
    return null;
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([result.raw], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "tomato-practice-recovery.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section
      className="connection-banner"
      role="alert"
      data-testid="practice-recovery"
    >
      <div>
        <strong>这份练习暂时无法恢复</strong>
        <p>{result.reason} 开始新练习前会保留原始备份，也可先下载留存。</p>
      </div>
      <button onClick={download}>下载原始存档</button>
    </section>
  );
}
