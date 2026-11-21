import { useState } from "react";
import { Overview } from "./pages/Overview";
import { Violations } from "./pages/Violations";

const PAGES = { overview: { label: "Overview", Component: Overview }, violations: { label: "Violations", Component: Violations } };
type PageId = keyof typeof PAGES;

export function App() {
  const [page, setPage] = useState<PageId>("overview");
  const { Component } = PAGES[page];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          Oculus
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
        <Component />
      </main>
    </div>
  );
}
