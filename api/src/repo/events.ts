import type { Db } from "../db/pool.js";
import type { ViolationEvent } from "../schemas/events.js";

// Inserts a whole batch in one statement: each column is sent as an array and unnest() turns
// the arrays back into rows. One round trip no matter how many events.
export async function insertEvents(
  db: Db,
  owner: { gameId: string; apiKeyId: string },
  events: ViolationEvent[],
): Promise<number> {
  const col = <K extends keyof ViolationEvent>(key: K) => events.map((e) => e[key]);
  const result = await db.query(
    `INSERT INTO events (game_id, api_key_id, occurred_at, server_id, player_id, player_name, remote, rule, detail, mode)
     SELECT $1, $2, timestamptz 'epoch' + ts * interval '1 millisecond', server_id, player_id, player_name, remote, rule, detail, mode
     FROM unnest($3::bigint[], $4::text[], $5::bigint[], $6::text[], $7::text[], $8::text[], $9::text[], $10::text[])
       AS t(ts, server_id, player_id, player_name, remote, rule, detail, mode)`,
    [
      owner.gameId,
      owner.apiKeyId,
      col("timestamp"),
      col("serverId"),
      col("playerId"),
      col("playerName"),
      col("remote"),
      col("rule"),
      col("detail"),
      col("mode"),
    ],
  );
  return result.rowCount ?? 0;
}
