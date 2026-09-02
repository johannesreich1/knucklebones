import { inApex, type BotStanding, type LadderCurveVersion } from "../core/ladder.ts";
import type { EdgeClient } from "./http.ts";

export class BotStandingUnavailable extends Error {}

interface StandingRow {
  rank?: number | string | null;
  population?: number | string | null;
}

/** The bot's standing at decision time. NEON is a POSITION, so it is read from
    the same player_standing projection the profile's rank line reads and
    classified by core inApex — exactly how boardGroup classifies a ladder row.
    A bot with no board row (freshly minted; or any bot once 100 humans have
    played, private.ladder_board) is simply not in the apex. The read goes
    through the caller's authenticated client: player_standing is a public
    projection granted to anon/authenticated, not to service_role. A read the
    board cannot answer throws, so a caller stops the decision instead of
    silently demoting the bot. */
export async function botStanding(
  reader: EdgeClient,
  id: string,
  points: number,
  curveVersion: LadderCurveVersion,
): Promise<BotStanding> {
  const { data, error } = await reader.rpc("player_standing", { p: id });
  if (error) throw new BotStandingUnavailable("player_standing read failed");
  const row = (Array.isArray(data) ? data[0] : data) as StandingRow | null | undefined;
  const apex = row != null && row.rank != null && row.population != null
    && inApex(points, Number(row.rank), Number(row.population), curveVersion);
  return { points, apex, id };
}
