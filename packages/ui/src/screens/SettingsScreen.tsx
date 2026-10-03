import { updateSettings, useSettings, type Settings } from "../storage/settings";

const TOGGLES: { key: keyof Settings; label: string; description: string }[] = [
  {
    key: "autosave",
    label: "Autosave",
    description: "Save automatically at the start of every in-game month.",
  },
  {
    key: "showProvinceBorders",
    label: "Province borders",
    description: "Draw borders between regions inside countries.",
  },
  { key: "showCityLabels", label: "City names", description: "Show city names when zoomed in." },
];

export function SettingsPanel() {
  const settings = useSettings();
  return (
    <div className="settings-list">
      {TOGGLES.map((t) => (
        <label key={t.key} className="toggle-row">
          <div>
            <strong>{t.label}</strong>
            <span className="muted small">{t.description}</span>
          </div>
          <input
            type="checkbox"
            className="switch"
            checked={settings[t.key]}
            onChange={(e) => updateSettings({ [t.key]: e.target.checked })}
          />
        </label>
      ))}
      <div className="muted small">
        Keyboard: <kbd>Space</kbd> pause · <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> speed ·{" "}
        <kbd>Q</kbd>–<kbd>T</kbd> map modes · <kbd>Esc</kbd> menu
      </div>
    </div>
  );
}

export function SettingsScreen({ onBack }: { onBack(): void }) {
  return (
    <div className="page">
      <header className="page-head">
        <button className="btn" onClick={onBack}>
          ← Back
        </button>
        <h2>Settings</h2>
      </header>
      <div className="page-body narrow">
        <SettingsPanel />
      </div>
    </div>
  );
}
