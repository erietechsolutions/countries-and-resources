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
  /** Missing when the updater couldn't prepare it: the player downloads it from this page. */
  install?(onProgress: (fraction: number) => void): Promise<void>;
  downloadPage?: string;
}

export interface UpdateCheck {
  update: AvailableUpdate | null;
  /** Why the built-in updater failed, if it did. */
  error: string | null;
}

const RELEASES_API =
  "https://api.github.com/repos/erietechsolutions/countries-and-resources/releases/latest";

/** "0.3.1" > "0.3.0", comparing numbers part by part. */
function newer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

/** Asks GitHub directly for the latest release, for when the built-in updater can't. */
async function latestRelease(): Promise<AvailableUpdate | null> {
  const res = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) return null;
  const release = (await res.json()) as { tag_name?: string; html_url?: string };
  if (!release.tag_name || !newer(release.tag_name, __APP_VERSION__)) return null;
  return {
    version: release.tag_name.replace(/^v/, ""),
    notes: "",
    downloadPage: release.html_url,
  };
}

/**
 * Checks for a newer version: first with the signed built-in updater, then (if that fails or
 * finds nothing) by asking GitHub directly, so a broken updater can't hide a release.
 */
export async function checkForUpdates(): Promise<UpdateCheck> {
  if (!isDesktop) return { update: null, error: null };
  let error: string | null = null;
  try {
    const update = await signedUpdate();
    if (update) return { update, error: null };
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  try {
    return { update: await latestRelease(), error };
  } catch (e) {
    return { update: null, error: error ?? (e instanceof Error ? e.message : String(e)) };
  }
}

async function signedUpdate(): Promise<AvailableUpdate | null> {
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
