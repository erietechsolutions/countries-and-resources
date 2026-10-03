export interface Toast {
  id: number;
  level: "good" | "bad" | "info";
  message: string;
}

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss(id: number): void }) {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          className={`toast-item ${t.level}`}
          onClick={() => onDismiss(t.id)}
          title="Dismiss"
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
