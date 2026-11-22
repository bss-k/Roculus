/*
  Side drawer over the current screen (player and remote details). Focus handling, `inert` on
  the page behind it and Esc are in hooks/useModal.ts (shared with Modal). On open, focus moves
  to the close button. Esc or a click on the backdrop closes it.
*/
import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModal } from "../hooks/useModal";

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
  useModal(panel, () => closeButton.current, onClose);

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
