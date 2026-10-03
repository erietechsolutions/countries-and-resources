/// The desktop shell only hosts the web build of the game; all game logic lives in TypeScript.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Countries & Resources");
}
