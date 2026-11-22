/*
  A centered dialog (confirmations, the one-time new-key display). Same focus handling as the
  Drawer (hooks/useModal.ts). With dismissible = false, Esc and the backdrop do nothing: the
  person has to press one of the dialog's own buttons (used where closing by accident would
  lose something, like a key that is shown only once).
*/
import { useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModal } from "../hooks/useModal";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  actions: ReactNode; // the dialog's buttons; put the safe one (Cancel) first: it gets focus
  dismissible?: boolean;
  tone?: "default" | "danger";
}

export function Modal({ title, onClose, children, actions, dismissible = true, tone = "default" }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Focus lands on the first action button (not on a text field or copy button in the body).
  useModal(panel, () => actionsRef.current?.querySelector("button"), onClose, dismissible);

  return createPortal(
    <div className="modal-root">
      <div className="drawer-backdrop" onClick={dismissible ? onClose : undefined} />
      <div
        ref={panel}
        className={tone === "danger" ? "modal modal-danger" : "modal"}
        role={tone === "danger" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId} className="modal-title">
          {title}
        </h2>
        <div className="modal-body">{children}</div>
        <div ref={actionsRef} className="modal-actions">
          {actions}
        </div>
      </div>
    </div>,
    document.body,
  );
}
