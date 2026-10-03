/** True when running inside the Tauri desktop app (M7) rather than a browser. */
export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function quitApp(): void {
  window.close();
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
