import { afterAll, describe, expect, it } from "vitest";
import { withSnapshot } from "../src/db/pool.js";
import { createGame, insertDirect, makeEvent, resetDb, testDb } from "./helpers.js";

const db = testDb();
afterAll(() => db.end());

const count = async (q: { query: typeof db.query }) =>
  (await q.query<{ n: number }>("SELECT count(*) AS n FROM events")).rows[0]!.n;

describe("withSnapshot", () => {
  it("keeps every query on one snapshot, even while other connections write", async () => {
    await resetDb(db);
    const { gameId } = await createGame(db);

    const seen = await withSnapshot(db, async (q) => {
      const before = await count(q);
      await insertDirect(db, gameId, [makeEvent()]); // committed by another connection
      const after = await count(q);
      return [before, after];
    });

    expect(seen).toEqual([0, 0]); // the snapshot never saw the new event…
    expect(await count(db)).toBe(1); // …which was committed all the same
  });

  it("is read-only", async () => {
    await expect(withSnapshot(db, (q) => q.query("DELETE FROM events"))).rejects.toThrow(/read-only/);
  });
});
