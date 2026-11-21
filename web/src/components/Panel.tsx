import type { ReactNode } from "react";

interface PanelProps {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, action, children, className = "" }: PanelProps) {
  return (
    <section className={`panel ${className}`}>
      <header className="panel-header">
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
