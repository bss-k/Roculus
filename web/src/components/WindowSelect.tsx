/*
  1h / 24h / 7d picker, built as an ARIA radio group: Tab lands on the selected option once,
  and the arrow keys move between options (the standard pattern for "pick one of a few").
*/
import { useRef, type KeyboardEvent } from "react";
import type { WindowId } from "../api/client";
import { WINDOW_OPTIONS } from "../lib/windows";

export function WindowSelect({ value, onChange }: { value: WindowId; onChange: (id: WindowId) => void }) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent, index: number) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + WINDOW_OPTIONS.length) % WINDOW_OPTIONS.length;
    onChange(WINDOW_OPTIONS[next]!.id);
    buttons.current[next]?.focus();
  }

  return (
    <div className="segmented" role="radiogroup" aria-label="Time window">
      {WINDOW_OPTIONS.map((option, i) => {
        const checked = option.id === value;
        return (
          <button
            key={option.id}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={checked ? "segment segment-active" : "segment"}
            onClick={() => onChange(option.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
