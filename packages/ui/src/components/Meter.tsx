/** A labeled horizontal bar for 0–100 values (needs, performance, relationships...). */
export function Meter({
  label,
  value,
  max = 100,
  display,
  tone = "auto",
  compact = false,
}: {
  label: string;
  value: number;
  max?: number;
  display?: string;
  /** "auto" colors low values as bad; "inverse" colors high values as bad. */
  tone?: "auto" | "inverse" | "accent" | "neutral";
  compact?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const health = tone === "inverse" ? 100 - pct : pct;
  const color =
    tone === "accent"
      ? "var(--accent)"
      : tone === "neutral"
        ? "var(--muted)"
        : health < 20
          ? "var(--bad)"
          : health < 45
            ? "var(--warn)"
            : "var(--good)";
  return (
    <div className={compact ? "meter compact" : "meter"}>
      <div className="meter-head">
        <span>{label}</span>
        <span className="meter-value">{display ?? Math.round(value)}</span>
      </div>
      <div
        className="bar"
        role="meter"
        aria-label={label}
        aria-valuenow={Math.round(value)}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        <i style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
