import { isLocked, type ChoiceOption } from "@cr/sim";

interface Props<T> {
  label: string;
  options: ChoiceOption<T>[];
  value: T;
  onChange(value: T): void;
  lockedReason?: string;
}

/** A row of selectable cards for one new-game option, showing locked and "Coming Soon" states. */
export function OptionCards<T extends string | number>({
  label,
  options,
  value,
  onChange,
  lockedReason,
}: Props<T>) {
  const locked = isLocked(options);
  return (
    <fieldset className="option-group">
      <legend>
        {label}
        {locked && <span className="tag lock">🔒 {lockedReason ?? "Locked by mode"}</span>}
      </legend>
      <div className="option-cards">
        {options.map((o) => {
          const selected = o.value === value;
          const disabled = !o.available;
          return (
            <button
              key={String(o.value)}
              type="button"
              className={`option-card${selected ? " selected" : ""}${disabled ? " disabled" : ""}`}
              disabled={disabled || locked}
              aria-pressed={selected}
              onClick={() => onChange(o.value)}
            >
              <span className="option-title">
                {o.label}
                {disabled && (
                  <span className="tag soon">{o.unavailableLabel ?? "Unavailable"}</span>
                )}
              </span>
              <span className="option-desc">{o.description}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
