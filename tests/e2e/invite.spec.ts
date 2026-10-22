import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { createRoom, newPlayers, screenshot } from "./players";

test("a fresh browser joins through the shared invitation URL", async ({
  browser,
  baseURL,
}, testInfo) => {
  const players = await newPlayers(browser, ["邀请房主", "受邀朋友"], baseURL!);
  const [host, invited] = players;
  try {
    const code = await createRoom([host], "doudizhu");
    const invitation = host.page.url();
    expect(new URL(invitation).searchParams.get("room")).toBe(code);
    await invited.page.goto(invitation);
    await expect(invited.page.getByTestId("room-code-input")).toHaveValue(code);
    await invited.page.getByTestId("nickname").fill(invited.name);
    await screenshot(invited, testInfo, "invitation-prefilled");
    await invited.page.getByTestId("join-room").click();
    await expect.poll(() => invited.snapshot?.roomCode).toBe(code);
    await expect
      .poll(
        () =>
          host.snapshot!.players.filter((player) => player.connected).length,
      )
      .toBe(2);
    expect(invited.seat).toBe(1);
    expect(invited.snapshot!.selfId).not.toBe(host.snapshot!.selfId);
    await expect(invited.page.getByTestId("room-code")).toHaveText(`#${code}`);
    await screenshot(invited, testInfo, "invitation-joined");
    players.forEach((player) => player.assertClean());
    const result = {
      status: "passed",
      independentContexts: 2,
      invitationPrefilled: true,
      joinedThroughUi: true,
      assignedSeat: invited.seat,
      snapshotCounts: players.map((player) => player.snapshots),
      privacyErrors: players.flatMap((player) => player.privacyErrors),
      pageErrors: players.flatMap((player) => player.pageErrors),
      completedAt: new Date().toISOString(),
    };
    let aggregate: Record<string, unknown> = {};
    try {
      aggregate = JSON.parse(
        await readFile("artifacts/e2e-results.json", "utf8"),
      ) as Record<string, unknown>;
    } catch {
      /* Standalone invitation run. */
    }
    aggregate.invitation = result;
    await writeFile(
      "artifacts/e2e-results.json",
      JSON.stringify(aggregate, null, 2),
    );
    await testInfo.attach("invitation-evidence", {
      body: JSON.stringify(result, null, 2),
      contentType: "application/json",
    });
  } finally {
    for (const player of players) await player.context.close();
  }
});
