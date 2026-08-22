// Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
// repository root.
//
// Cargo build script for the Android TV Remote tray app. Runs `tauri_build::build()`, which
// generates the permission/capability schemas from `capabilities/`, embeds `tauri.conf.json`
// and the bundled frontend assets, and emits the platform resources (Windows manifest and
// icon, macOS Info.plist keys) the shell links against.
fn main() {
    tauri_build::build()
}
