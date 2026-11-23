/*
  The games this dashboard can show, and which one it is showing.

  The list comes from /dash/games.json (slugs only); each game's name and universe come from
  the API, asked with that game's own read key. The choice is remembered in localStorage (just
  the slug: nothing secret), which can be unavailable (private windows, blocked storage), so
  every access is wrapped and a failure only means the choice isn't remembered.
*/
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { gamesApi, setRequestGame, type GameInfo } from "../api/client";

export interface Game {
  slug: string;
  info?: GameInfo; // missing when that game's read key didn't work
  error?: string;
}

const STORAGE_KEY = "oculus.game";

function remembered(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function remember(slug: string) {
  try {
    localStorage.setItem(STORAGE_KEY, slug);
  } catch {
    // Not remembered across reloads; the dashboard still works.
  }
}

export function useGames() {
  const [games, setGames] = useState<Game[]>();
  const [error, setError] = useState<string>();
  const [current, setCurrent] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const slugs = await gamesApi.list(controller.signal);
        const infos = await Promise.allSettled(slugs.map((slug) => gamesApi.info(slug, controller.signal)));
        const list = slugs.map((slug, i): Game => {
          const result = infos[i]!;
          return result.status === "fulfilled" ? { slug, info: result.value } : { slug, error: (result.reason as Error).message };
        });
        const saved = remembered();
        const pick = list.find((g) => g.slug === saved)?.slug ?? list[0]?.slug;
        // Before the screens mount, so their very first requests are already for this game.
        if (pick) setRequestGame(pick);
        setGames(list);
        setCurrent(pick);
      } catch (err) {
        if (!controller.signal.aborted) setError((err as Error).message);
      }
    })();
    return () => controller.abort();
  }, []);

  const select = useCallback((slug: string) => {
    setRequestGame(slug);
    remember(slug);
    setCurrent(slug);
  }, []);

  return { games, error, current: games?.find((g) => g.slug === current), select };
}

// The game on screen, for components deep in a page (the key screen checks the admin key's
// game against it). Always set inside <main>.
export const CurrentGame = createContext<Game | null>(null);

export function useCurrentGame(): Game | null {
  return useContext(CurrentGame);
}

// "Name" when the API told us, else the slug from .env.
export function gameLabel(game: Game): string {
  return game.info?.name ?? game.slug;
}
