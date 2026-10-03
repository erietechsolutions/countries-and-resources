import { updateSettings, useSettings, type Settings } from "../storage/settings";

type ToggleKey = Exclude<keyof Settings, "tutorialDone">;

const TOGGLES: { key: ToggleKey; label: string; description: string }[] = [
  {
    key: "pauseOnActivityEnd",
    label: "Pause when idle",
    description: "Pause the game when an activity ends and your character has nothing to do.",
  },
  {
    key: "pauseOnBadNews",
    label: "Pause on bad news",
    description: "Pause when something goes wrong: getting fired, robbed, evicted...",
  },
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
      <button
        className="btn small align-start"
        onClick={() => updateSettings({ tutorialDone: false })}
      >
        Show the tutorial again
      </button>
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
