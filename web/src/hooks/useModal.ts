/*
  Shared behaviour for anything that covers the screen (the side Drawer, centered Modals).

  How it keeps keyboard and screen-reader users inside it while open:
    - The overlay is portaled to <body>, outside the app's #root, and #root gets the `inert`
      attribute, so nothing behind it can be focused, clicked or read out.
    - `inert` alone would still let Tab run off the last button into the browser's own UI, so
      Tab / Shift+Tab are wrapped around at the edges (and pulled back in from <body>).
    - On open, focus moves to what `initialFocus()` returns (or else the first control inside);
      on close, it returns to whatever had focus before (usually the button that opened it), so
      keyboard users don't lose their place.
  Esc calls onClose, unless `dismissible` is false (e.g. a dialog that must be acknowledged).
*/
import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const tabbable = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.tabIndex >= 0);

export function useModal(
  panel: RefObject<HTMLElement | null>,
  initialFocus: () => HTMLElement | null | undefined,
  onClose: () => void,
  dismissible = true,
) {
  // Open/close side effects: inert background, no page scroll, focus in and back out.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById("root");
    const overflow = document.body.style.overflow;
    root?.setAttribute("inert", "");
    document.body.style.overflow = "hidden";
    const first = panel.current ? tabbable(panel.current)[0] : undefined;
    (initialFocus() ?? first ?? panel.current)?.focus();
    return () => {
      root?.removeAttribute("inert"); // first, or the opener can't take focus back
      document.body.style.overflow = overflow;
      opener?.focus();
    };
    // Runs once per open (empty deps on purpose): the refs are stable, and re-running would
    // steal focus mid-dialog.
  }, []);

  // Keys are handled on the whole document, not just the panel: if the focused button is
  // removed (e.g. the timeline's last "Load more"), focus falls to <body>, outside the panel,
  // and the next Tab must still be pulled back in.
  useEffect(() => {
    const wrapTab = (event: KeyboardEvent) => {
      const el = panel.current;
      if (!el) return;
      // tabIndex -1 elements (e.g. WindowSelect's unselected options) are focusable but not
      // reachable with Tab, so they can't be the edges we wrap at.
      const items = tabbable(el);
      const first = items[0];
      const last = items.at(-1);
      const active = document.activeElement;
      if (!first || !last) {
        event.preventDefault();
        el.focus();
      } else if (!el.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (active === first || active === el)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) onClose();
      else if (event.key === "Tab") wrapTab(event);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panel, onClose, dismissible]);
}
