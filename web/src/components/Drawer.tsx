/*
  Side drawer over the current screen (player and remote details).

  How it keeps keyboard and screen-reader users inside it while open:
    - It is portaled to <body>, outside the app's #root, and #root gets the `inert` attribute,
      so nothing behind the drawer can be focused, clicked or read out.
    - `inert` alone would still let Tab run off the last button into the browser's own UI, so
      Tab / Shift+Tab are wrapped around at the edges (and pulled back in from <body>).
    - On open, focus moves to the close button; on close, it returns to whatever opened the
      drawer (usually the table row), so keyboard users don't lose their place.
  Esc or a click on the backdrop closes it.
*/
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DrawerProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

export function Drawer({ title, subtitle, onClose, children }: DrawerProps) {
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // Open/close side effects: inert background, no page scroll, focus in and back out.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById("root");
    const overflow = document.body.style.overflow;
    root?.setAttribute("inert", "");
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => {
      root?.removeAttribute("inert"); // first, or the opener can't take focus back
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, []);

  // Keys are handled on the whole document, not just the panel: if the focused button is
  // removed (e.g. the timeline's last "Load more"), focus falls to <body>, outside the panel,
  // and the next Tab must still be pulled back in.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "Tab") wrapTab(event);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function wrapTab(event: KeyboardEvent) {
    if (!panel.current) return;
    // tabIndex -1 elements (e.g. WindowSelect's unselected options) are focusable but not
    // reachable with Tab, so they can't be the edges we wrap at.
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.tabIndex >= 0);
    const first = items[0];
    const last = items.at(-1);
    const active = document.activeElement;
    if (!first || !last) {
      event.preventDefault();
      panel.current.focus();
    } else if (!panel.current.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && (active === first || active === panel.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div className="drawer-root">
      {/* A sibling of the panel, not its parent: clicks inside the panel never reach it. */}
      <div className="drawer-backdrop" onClick={onClose} />
      <aside
        ref={panel}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="drawer-header">
          <div className="drawer-title">
            <h2 id={titleId}>{title}</h2>
            {subtitle && <div className="muted">{subtitle}</div>}
          </div>
          <button ref={closeButton} type="button" className="drawer-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
