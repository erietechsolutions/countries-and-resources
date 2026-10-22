/** True when running inside the Tauri desktop app (M7) rather than a browser. */
export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function quitApp(): Promise<void> {
  if (!isDesktop) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}

export interface AvailableUpdate {
  version: string;
  notes: string;
  install(onProgress: (fraction: number) => void): Promise<void>;
}

/** Asks GitHub Releases whether a newer signed version exists (desktop only; null if not). */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isDesktop) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body ?? "",
    async install(onProgress) {
      let total = 0;
      let done = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          done += event.data.chunkLength;
          if (total > 0) onProgress(done / total);
        }
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    },
  };
}

/** Offers a text file to the player as a download. */
export function downloadTextFile(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
