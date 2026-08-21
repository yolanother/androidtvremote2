// Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
// repository root.
//
// Executable entry point for the Android TV Remote tray app. Suppresses the extra console
// window Windows release builds would otherwise open and hands straight over to the
// application shell in `lib.rs`, which installs the tray icon and the remote panel.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    androidtv_tray_lib::run();
}
