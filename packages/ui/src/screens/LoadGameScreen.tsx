import { useCallback, useEffect, useRef, useState } from "react";
import { formatDate, formatMoney, MODES } from "@cr/sim";
import { downloadTextFile } from "../platform";
import { deleteSave, listSaves, readSave, type SaveMeta } from "../storage/saves";

interface PanelProps {
  onLoad(id: string): void;
  onImport(text: string): void;
}

/** The list of saves with load/export/delete, used on its own screen and in the pause menu. */
export function LoadGamePanel({ onLoad, onImport }: PanelProps) {
  const [saves, setSaves] = useState<SaveMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    listSaves()
      .then(setSaves)
      .catch((e: unknown) => {
        setSaves([]);
        setError(e instanceof Error ? e.message : "Could not read saves.");
      });
  }, []);

  useEffect(refresh, [refresh]);

  const exportSave = async (meta: SaveMeta) => {
    try {
      const { text } = await readSave(meta.id);
      const safeName = meta.summary.characterName.replace(/[^\w-]+/g, "_");
      downloadTextFile(`${safeName}-${meta.savedAt.slice(0, 10)}.crsave.json`, text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not export the save.");
    }
  };

  const remove = async (id: string) => {
    setConfirmDelete(null);
    await deleteSave(id);
    refresh();
  };

  return (
    <div className="load-panel">
      {error && <p className="error-text">{error}</p>}
      {saves === null ? (
        <p className="muted">Loading saves…</p>
      ) : saves.length === 0 ? (
        <p className="muted">No saved games yet.</p>
      ) : (
        <ul className="save-list">
          {saves.map((s) => (
            <li key={s.id}>
              <div className="save-info">
                <strong>
                  {s.name}
                  {s.autosave && <span className="tag">Autosave</span>}
                </strong>
                <span className="small">
                  {s.summary.characterName} · {MODES[s.summary.mode].name} ·{" "}
                  {formatDate(s.summary.gameTime)}
                </span>
                <span className="muted small">
                  {s.summary.location} · {formatMoney(s.summary.cashCents)} · saved{" "}
                  {new Date(s.savedAt).toLocaleString()}
                </span>
              </div>
              <div className="save-actions">
                {confirmDelete === s.id ? (
                  <>
                    <span className="small">Delete this save?</span>
                    <button className="btn small danger" onClick={() => remove(s.id)}>
                      Delete
                    </button>
                    <button className="btn small" onClick={() => setConfirmDelete(null)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn small primary" onClick={() => onLoad(s.id)}>
                      Load
                    </button>
                    <button className="btn small" onClick={() => exportSave(s)}>
                      Export
                    </button>
                    <button className="btn small" onClick={() => setConfirmDelete(s.id)}>
                      Delete
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <button className="btn" onClick={() => fileInput.current?.click()}>
          Import save file…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onImport(await file.text());
          }}
        />
      </div>
    </div>
  );
}

export function LoadGameScreen({ onBack, ...panel }: PanelProps & { onBack(): void }) {
  return (
    <div className="page">
      <header className="page-head">
        <button className="btn" onClick={onBack}>
          ← Back
        </button>
        <h2>Load Game</h2>
      </header>
      <div className="page-body narrow">
        <LoadGamePanel {...panel} />
      </div>
    </div>
  );
}
