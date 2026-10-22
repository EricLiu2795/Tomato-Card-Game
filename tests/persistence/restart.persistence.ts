import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { legalReturnCards, legalTributeCards } from "../../shared/guandan";
import {
  IsolatedWorker,
  PlayerConnection,
  apply,
  openRoom,
  stableSnapshot,
  startGame,
} from "./harness";

describe.sequential(
  "real isolated Wrangler process restart persistence",
  () => {
    const worker = new IsolatedWorker();
    let clients: PlayerConnection[] = [];
    beforeAll(async () => {
      await worker.start();
    });
    afterEach(({ task }) => {
      if (task.result?.state === "fail") console.error(worker.diagnostics());
    });
    afterAll(async () => {
      clients.forEach((client) => client.close());
      await worker.cleanup();
    });

    async function restartAndCompare(): Promise<void> {
      const saved = clients.map((client) =>
        structuredClone(stableSnapshot(client.snapshot)),
      );
      const sessions = clients.map((client) => ({
        code: client.code,
        cookie: client.cookie,
      }));
      await worker.stop();
      clients.forEach((client) => client.close());
      clients = [];
      await worker.start();
      for (const session of sessions)
        clients.push(
          await new PlayerConnection(session.code, session.cookie).connect(),
        );
      for (let index = 0; index < clients.length; index++)
        expect(stableSnapshot(clients[index].snapshot)).toEqual(saved[index]);
    }

    it("restores three private DDZ hands, seats, turn, revision and committed command receipts", async () => {
      clients = await openRoom("doudizhu", 3);
      await startGame(clients);
      const bidder = clients.find(
        (client) => client.seat === client.snapshot.game!.turn,
      )!;
      await apply(clients, bidder, { type: "BID", value: 3 });
      expect(bidder.snapshot.hand).toHaveLength(20);
      const play = await apply(clients, bidder, {
        type: "PLAY_CARDS",
        cardIds: [bidder.snapshot.hand[0].id],
      });
      const saved = clients.map((client) =>
        structuredClone(stableSnapshot(client.snapshot)),
      );
      const actorId = bidder.snapshot.selfId;
      const revision = bidder.snapshot.revision;
      expect(
        new Set(
          saved.flatMap((snapshot) => snapshot.hand.map((card) => card.id)),
        ).size,
      ).toBe(53);
      expect(saved[0].game?.phase).toBe("playing");

      // Terminate the owned Wrangler/workerd group while real client sockets exist.
      await restartAndCompare();
      expect(worker.starts).toBe(2);

      const actor = clients.find(
        (client) => client.snapshot.selfId === actorId,
      )!;
      const offset = actor.messages.length;
      const replay = await actor.raw(play);
      expect(replay).toMatchObject({
        type: "ACK",
        commandId: play.id,
        revision,
      });
      await actor.wait(
        (message) =>
          message.type === "SNAPSHOT" && message.revision === revision,
        offset,
      );
      expect(stableSnapshot(actor.snapshot)).toEqual(
        saved.find((snapshot) => snapshot.selfId === actorId),
      );

      const altered = await actor.raw({ ...play, action: { type: "PASS" } });
      expect(altered).toMatchObject({ type: "ERROR", commandId: play.id });
      if (altered.type === "ERROR")
        expect(altered.message).toContain("命令 ID 已使用");
      expect(actor.snapshot.revision).toBe(revision);

      // A new legal action proves the restored turn remains usable after both replay attempts.
      const next = clients.find(
        (client) => client.seat === client.snapshot.game!.turn,
      )!;
      await apply(clients, next, { type: "PASS" });
      expect(next.snapshot.revision).toBe(revision + 1);
      expect(next.snapshot.game?.passed).toEqual([next.seat]);
    });

    it("restores four-player Guandan during partial tribute, partial return and partial discard", async () => {
      clients.forEach((client) => client.close());
      clients = await openRoom("guandan", 4);
      await startGame(clients);
      // Passing to each leader lets seats 0 and 2 finish first regardless of the
      // shuffled ranks. Every mutation still uses authenticated public commands.
      let rounds = 0;
      while (clients[0].snapshot.game?.phase !== "tribute" && rounds < 8) {
        let actions = 0;
        while (clients[0].snapshot.game?.phase === "playing" && actions < 400) {
          const game = clients[0].snapshot.game!;
          const actor = clients.find((client) => client.seat === game.turn)!;
          await apply(
            clients,
            actor,
            game.trick
              ? { type: "PASS" }
              : { type: "PLAY_CARDS", cardIds: [actor.snapshot.hand[0].id] },
          );
          actions += 1;
        }
        expect(clients[0].snapshot.game?.phase).toBe("finished");
        expect(clients[0].snapshot.game?.finishOrder.slice(0, 2)).toEqual([
          0, 2,
        ]);
        await startGame(clients);
        rounds += 1;
      }
      // A legal anti-tribute deal is retried through another full public round;
      // the test never silently skips its exchange/discard assertions.
      expect(
        clients[0].snapshot.game?.phase,
        `No non-resisted tribute after ${rounds} completed rounds`,
      ).toBe("tribute");
      expect(clients[0].snapshot.game?.tribute).toMatchObject({
        kind: "double",
        resisted: false,
      });

      const donor = clients.find(
        (client) => client.seat === client.snapshot.game!.turn,
      )!;
      const donorSeat = donor.seat;
      const selectedTribute = legalTributeCards(
        donor.snapshot.hand,
        donor.snapshot.game!.currentLevel!,
      )[0].id;
      const beforeExchange = clients.map((client) => ({
        seat: client.seat,
        hand: structuredClone(client.snapshot.hand),
      }));
      await apply(clients, donor, {
        type: "SELECT_TRIBUTE",
        cardId: selectedTribute,
      });
      expect(
        Object.keys(donor.snapshot.game!.tribute!.selections),
      ).toHaveLength(1);
      expect(donor.snapshot.game!.phase).toBe("tribute");
      await restartAndCompare();

      const secondDonor = clients.find(
        (client) => client.seat === client.snapshot.game!.turn,
      )!;
      await apply(clients, secondDonor, {
        type: "SELECT_TRIBUTE",
        cardId: legalTributeCards(
          secondDonor.snapshot.hand,
          secondDonor.snapshot.game!.currentLevel!,
        )[0].id,
      });
      expect(clients[0].snapshot.game?.phase).toBe("return");
      expect(
        clients[0].snapshot.game?.tribute?.pairs.find(
          (pair) => pair.from === donorSeat,
        )?.tribute?.id,
      ).toBe(selectedTribute);

      const recipient = clients.find(
        (client) => client.seat === client.snapshot.game!.turn,
      )!;
      const recipientSeat = recipient.seat;
      const selectedReturn = legalReturnCards(
        recipient.snapshot.hand,
        recipient.snapshot.game!.currentLevel!,
      )[0].id;
      await apply(clients, recipient, {
        type: "SELECT_RETURN_CARD",
        cardId: selectedReturn,
      });
      expect(recipient.snapshot.game!.phase).toBe("return");
      expect(recipient.snapshot.game!.tribute!.returned).toEqual([
        recipientSeat,
      ]);
      for (const client of clients)
        expect(client.snapshot.hand).toEqual(
          beforeExchange.find((saved) => saved.seat === client.seat)!.hand,
        );
      expect(
        recipient.snapshot.game!.tribute!.pairs.every(
          (pair) => pair.returnCard === undefined,
        ),
      ).toBe(true);
      await restartAndCompare();

      const secondRecipient = clients.find(
        (client) => client.seat === client.snapshot.game!.turn,
      )!;
      await apply(clients, secondRecipient, {
        type: "SELECT_RETURN_CARD",
        cardId: legalReturnCards(
          secondRecipient.snapshot.hand,
          secondRecipient.snapshot.game!.currentLevel!,
        )[0].id,
      });
      expect(clients[0].snapshot.game?.phase).toBe("discard");
      const returnedPair = clients[0].snapshot.game!.tribute!.pairs.find(
        (pair) => pair.to === recipientSeat,
      )!;
      expect(returnedPair.returnCard?.id).toBe(selectedReturn);
      expect(
        clients
          .find((client) => client.seat === returnedPair.from)!
          .snapshot.hand.some((card) => card.id === selectedReturn),
      ).toBe(true);
      for (const pair of clients[0].snapshot.game!.tribute!.pairs) {
        expect(
          clients
            .find((client) => client.seat === pair.to)!
            .snapshot.hand.some((card) => card.id === pair.tribute!.id),
        ).toBe(true);
        expect(
          clients
            .find((client) => client.seat === pair.from)!
            .snapshot.hand.some((card) => card.id === pair.returnCard!.id),
        ).toBe(true);
      }

      const discarder = clients.find(
        (client) => client.seat === client.snapshot.game!.turn,
      )!;
      const discardedId = discarder.snapshot.hand[0].id;
      const discardedSeat = discarder.seat;
      await apply(clients, discarder, {
        type: "DISCARD_HOUSE_RULE",
        cardId: discardedId,
      });
      expect(discarder.snapshot.hand).toHaveLength(26);
      expect(discarder.snapshot.game!.phase).toBe("discard");
      expect(discarder.snapshot.game!.tribute!.discarded).toEqual([
        discardedSeat,
      ]);
      expect(discarder.snapshot.game!.removed.map((card) => card.id)).toEqual([
        discardedId,
      ]);
      await restartAndCompare();

      const last = clients.find(
        (client) => client.seat === client.snapshot.game!.turn,
      )!;
      await apply(clients, last, { type: "DISCARD_HOUSE_RULE", cardId: null });
      expect(last.snapshot.game!.phase).toBe("playing");
      expect(last.snapshot.game!.tribute!.discarded).toHaveLength(2);
      const allCards = [
        ...clients.flatMap((client) => client.snapshot.hand),
        ...last.snapshot.game!.removed,
      ];
      expect(allCards).toHaveLength(108);
      expect(new Set(allCards.map((card) => card.id)).size).toBe(108);
    });
  },
);
