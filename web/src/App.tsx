import { useState } from "react";
import { CurrentGame, gameLabel, useGames, type Game } from "./hooks/useGames";
import { Ingestion } from "./pages/Ingestion";
import { Overview } from "./pages/Overview";
import { Players } from "./pages/Players";
import { Remotes } from "./pages/Remotes";
import { Violations } from "./pages/Violations";

const PAGES = {
  overview: { label: "Overview", Component: Overview },
  violations: { label: "Violations", Component: Violations },
  players: { label: "Players", Component: Players },
  remotes: { label: "Remotes", Component: Remotes },
  ingestion: { label: "Ingestion & keys", Component: Ingestion },
};
type PageId = keyof typeof PAGES;

export function App() {
  const [page, setPage] = useState<PageId>("overview");
  const { games, error, current, select } = useGames();
  const { Component } = PAGES[page];

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-start">
          <div className="brand">
            <span className="brand-mark" aria-hidden />
            Oculus
          </div>
          {games && current && <GamePicker games={games} current={current} onChange={select} />}
        </div>
        <nav>
          {(Object.keys(PAGES) as PageId[]).map((id) => (
            <button key={id} className={id === page ? "tab tab-active" : "tab"} onClick={() => setPage(id)}>
              {PAGES[id].label}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {error ? (
          <div className="banner">Couldn&apos;t load the list of games: {error}</div>
        ) : !games ? (
          <div className="skeleton" />
        ) : !current ? (
          <div className="banner">
            No games are set up for this dashboard. Add a read key to <code className="mono">OCULUS_READ_KEYS</code> on
            the server.
          </div>
        ) : (
          // Keyed by game: switching remounts every screen, so no filter, open drawer, request
          // in flight or unlocked admin key carries over from one game to the next.
          <CurrentGame.Provider value={current} key={current.slug}>
            <Component />
          </CurrentGame.Provider>
        )}
      </main>
    </div>
  );
}

// A dropdown when there are several games; with one, just its name (nothing to pick).
function GamePicker({ games, current, onChange }: { games: Game[]; current: Game; onChange: (slug: string) => void }) {
  if (games.length === 1) {
    return (
      <span className="game-name" title={current.info ? `Universe ${current.info.universeId}` : undefined}>
        {gameLabel(current)}
      </span>
    );
  }
  return (
    <label className="game-picker">
      <span className="sr-only">Game</span>
      <select value={current.slug} onChange={(e) => onChange(e.target.value)}>
        {games.map((g) => (
          <option key={g.slug} value={g.slug}>
            {g.info ? gameLabel(g) : `${g.slug} (read key not working)`}
          </option>
        ))}
      </select>
    </label>
  );
}
