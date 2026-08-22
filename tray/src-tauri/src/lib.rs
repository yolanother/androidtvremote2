// Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
// repository root.
//
// Rust shell of the Android TV Remote desktop tray app. Owns everything the webview cannot
// do for itself: it installs the system-tray icon and menu, anchors the borderless remote
// panel next to the tray icon (below it on macOS, above the notification area on Windows),
// keeps it always-on-top as a persistent overlay widget dismissed only explicitly — the
// panel's close button, Escape, or the tray icon — rather than on focus loss, applies the
// platform's native background material (vibrancy on macOS, Mica/acrylic on Windows), and
// exposes the `show_panel`, `hide_panel`, `toggle_panel` and `sync_tray` commands. All HTTP
// and WebSocket traffic to the appliance stays in the frontend; this side never talks to the
// server, it only relays tray menu clicks to the webview as `tray-action` events.

mod tray;

use std::sync::Mutex;

use serde::Serialize;
use tauri::{
    tray::{TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Rect, Runtime, WebviewWindow,
    WindowEvent,
};

use crate::tray::{build_menu, icon_for, tooltip_for, Health, TrayState};

/// Label of the single remote panel window, as declared in `tauri.conf.json`.
const PANEL: &str = "panel";

/// Gap in physical pixels between the tray icon and the panel edge.
const PANEL_GAP: i32 = 8;

/// Margin kept between the panel and the edge of the monitor's work area.
const SCREEN_MARGIN: i32 = 8;

/// Process-wide state the tray and window callbacks share.
struct AppState {
    /// Latest device summary pushed by the webview, used to rebuild the menu.
    tray: Mutex<TrayState>,
}

/// Payload of the `tray-action` event emitted to the webview when a tray menu item is used.
#[derive(Clone, Serialize)]
struct TrayAction {
    /// `power` or `mute`.
    action: String,
    /// Contract `device_id` the action applies to.
    device_id: String,
}

/// Returns the remote panel window, or an error if it is somehow missing.
fn panel<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
    app.get_webview_window(PANEL)
        .ok_or_else(|| tauri::Error::WindowNotFound)
}

/// Moves the panel so it sits next to `anchor`, clamped inside the monitor's work area.
///
/// The anchor is the tray icon's own rectangle. When the icon is in the upper half of the
/// monitor — the macOS menubar — the panel drops below it; otherwise — the Windows
/// notification area — it rises above it. Horizontally the panel is centred on the icon and
/// then pushed back inside the work area, which is what keeps a right-hand-corner tray icon
/// from putting the panel half off-screen.
///
/// # Arguments
/// * `win` - the panel window to move.
/// * `anchor` - the tray icon rectangle reported by the tray event, if known.
fn anchor_panel<R: Runtime>(win: &WebviewWindow<R>, anchor: Option<Rect>) -> tauri::Result<()> {
    let scale = win.scale_factor()?;
    let size = win.outer_size()?;
    let (w, h) = (size.width as i32, size.height as i32);

    let Some(anchor) = anchor else {
        // No tray rectangle (Linux, or a hotkey press before the icon reports one): fall back
        // to the top-right of the primary monitor, which is where a tray panel belongs anyway.
        if let Some(monitor) = win.primary_monitor()? {
            let area = monitor.work_area();
            let x = area.position.x + area.size.width as i32 - w - SCREEN_MARGIN;
            let y = area.position.y + SCREEN_MARGIN;
            win.set_position(PhysicalPosition::new(x, y))?;
        }
        return Ok(());
    };

    let pos = anchor.position.to_physical::<i32>(scale);
    let icon = anchor.size.to_physical::<i32>(scale);
    let icon_centre_x = pos.x + icon.width / 2;

    // Prefer the monitor the tray icon is actually on, so a tray on a secondary display
    // does not summon the panel onto the primary one.
    let monitor = win
        .app_handle()
        .monitor_from_point(pos.x as f64, pos.y as f64)?
        .or(win.primary_monitor()?);
    let Some(monitor) = monitor else {
        win.set_position(PhysicalPosition::new(icon_centre_x - w / 2, pos.y))?;
        return Ok(());
    };
    let area = monitor.work_area();
    let (min_x, max_x) = (
        area.position.x + SCREEN_MARGIN,
        area.position.x + area.size.width as i32 - w - SCREEN_MARGIN,
    );
    let (min_y, max_y) = (
        area.position.y + SCREEN_MARGIN,
        area.position.y + area.size.height as i32 - h - SCREEN_MARGIN,
    );

    let x = (icon_centre_x - w / 2).clamp(min_x.min(max_x), max_x.max(min_x));
    let tray_in_top_half = pos.y < area.position.y + area.size.height as i32 / 2;
    let y = if tray_in_top_half {
        pos.y + icon.height + PANEL_GAP
    } else {
        pos.y - h - PANEL_GAP
    };
    let y = y.clamp(min_y.min(max_y), max_y.max(min_y));

    win.set_position(PhysicalPosition::new(x, y))
}

/// Shows the panel, anchored to `anchor`, and gives it keyboard focus.
fn show_at<R: Runtime>(app: &AppHandle<R>, anchor: Option<Rect>) -> tauri::Result<()> {
    let win = panel(app)?;
    anchor_panel(&win, anchor)?;
    win.show()?;
    win.set_focus()
}

/// Applies the platform's native window material to the panel.
///
/// macOS gets the `popover` vibrancy material with a rounded radius, which is what a real
/// menubar popover uses. Windows 11 gets Mica, falling back to acrylic on builds that do
/// not support it. Linux has no equivalent, so the panel just stays transparent and the
/// stylesheet paints its own background.
fn apply_effects<R: Runtime>(win: &WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    {
        use tauri::window::{Effect, EffectState, EffectsBuilder};
        let _ = win.set_effects(
            EffectsBuilder::new()
                .effect(Effect::Popover)
                .state(EffectState::Active)
                .radius(14.0)
                .build(),
        );
    }
    #[cfg(target_os = "windows")]
    {
        use tauri::window::{Effect, EffectsBuilder};
        // Mica is Windows 11 only; set_effects errors on older builds, so try acrylic next.
        if win
            .set_effects(EffectsBuilder::new().effect(Effect::Mica).build())
            .is_err()
        {
            let _ = win.set_effects(EffectsBuilder::new().effect(Effect::Acrylic).build());
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let _ = win;
}

/// Shows the remote panel next to the tray icon.
#[tauri::command]
fn show_panel(app: AppHandle, tray: tauri::State<'_, TrayIcon>) -> Result<(), String> {
    show_at(&app, tray.rect().ok().flatten()).map_err(|e| e.to_string())
}

/// Hides the remote panel without closing it, so its WebSocket connection stays up.
#[tauri::command]
fn hide_panel(app: AppHandle) -> Result<(), String> {
    panel(&app)
        .and_then(|w| w.hide())
        .map_err(|e| e.to_string())
}

/// Toggles the remote panel. This is what the configurable global hotkey calls.
#[tauri::command]
fn toggle_panel(app: AppHandle, tray: tauri::State<'_, TrayIcon>) -> Result<(), String> {
    let win = panel(&app).map_err(|e| e.to_string())?;
    if win.is_visible().unwrap_or(false) {
        win.hide().map_err(|e| e.to_string())
    } else {
        show_at(&app, tray.rect().ok().flatten()).map_err(|e| e.to_string())
    }
}

/// Resizes the panel to the height the frontend actually needs, so the popover hugs its
/// content instead of leaving dead space below the remote — then re-anchors it to the tray
/// icon. `set_size` keeps the window's top-left corner fixed, so without re-anchoring, a
/// panel that grows taller while showing (e.g. switching from Settings back to the taller
/// Remote view) would extend past the screen edge it was originally clamped against instead
/// of staying fully visible next to the tray icon.
#[tauri::command]
fn resize_panel(app: AppHandle, tray: tauri::State<'_, TrayIcon>, width: f64, height: f64) -> Result<(), String> {
    let win = panel(&app).map_err(|e| e.to_string())?;
    win.set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    anchor_panel(&win, tray.rect().ok().flatten()).map_err(|e| e.to_string())
}

/// Pushes the current device summary and health from the webview into the tray.
///
/// The frontend owns the API client and the WebSocket, so it is the only thing that knows
/// the device list; it calls this whenever that list or any device's connection state
/// changes. The tray icon is recoloured and the context menu rebuilt from what it sends.
#[tauri::command]
fn sync_tray(
    tray: tauri::State<'_, TrayIcon>,
    state: tauri::State<'_, AppState>,
    app: AppHandle,
    next: TrayState,
) -> Result<(), String> {
    tray.set_icon(Some(icon_for(next.health)))
        .map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(tooltip_for(&next)))
        .map_err(|e| e.to_string())?;
    let menu = build_menu(&app, &next).map_err(|e| e.to_string())?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    *state.tray.lock().unwrap() = next;
    Ok(())
}

/// Handles a tray menu click.
///
/// `show`, `settings` and `quit` are handled here; per-device quick actions are forwarded to
/// the webview as a `tray-action` event, because it holds the configured server URL and
/// token and is the only place that speaks to the appliance.
fn on_menu_event(app: &AppHandle, id: &str) {
    match id {
        "quit" => app.exit(0),
        "show" => {
            let anchor = app.try_state::<TrayIcon>().and_then(|t| t.rect().ok().flatten());
            let _ = show_at(app, anchor);
        }
        "settings" => {
            let anchor = app.try_state::<TrayIcon>().and_then(|t| t.rect().ok().flatten());
            let _ = show_at(app, anchor);
            let _ = app.emit("open-settings", ());
        }
        other => {
            if let Some((action, device_id)) = other.split_once(':') {
                let _ = app.emit(
                    "tray-action",
                    TrayAction {
                        action: action.to_string(),
                        device_id: device_id.to_string(),
                    },
                );
            }
        }
    }
}

/// Builds and runs the tray application.
///
/// # Panics
/// Panics if the Tauri context cannot be built or the tray icon cannot be installed, both
/// of which are unrecoverable at startup.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState {
            tray: Mutex::new(TrayState::default()),
        })
        .invoke_handler(tauri::generate_handler![
            show_panel,
            hide_panel,
            toggle_panel,
            resize_panel,
            sync_tray
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let handle = app.handle().clone();
            let icon = TrayIconBuilder::with_id("remote")
                .icon(icon_for(Health::Offline))
                .tooltip("Android TV Remote — starting…")
                .menu(&build_menu(&handle, &TrayState::default())?)
                // The menu belongs on the secondary button; the primary button opens the panel.
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| on_menu_event(app, event.id.as_ref()))
                .on_tray_icon_event(|tray, event| {
                    // Windows reports a left click as two separate events — button-down, then
                    // button-up — for the same physical click. Acting on both toggled the
                    // panel open and immediately shut again: it showed on the down event and
                    // hid on the up event a few milliseconds later. Only the release should
                    // count as "clicked," matching every native tray icon.
                    if let TrayIconEvent::Click {
                        rect,
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        let visible = app
                            .get_webview_window(PANEL)
                            .and_then(|w| w.is_visible().ok())
                            .unwrap_or(false);
                        if visible {
                            let _ = app.get_webview_window(PANEL).map(|w| w.hide());
                        } else {
                            let _ = show_at(app, Some(rect));
                        }
                    }
                })
                .build(app)?;
            app.manage(icon);

            let win = app
                .get_webview_window(PANEL)
                .expect("panel window is declared in tauri.conf.json");
            apply_effects(&win);

            // A tray app has no business owning a Dock icon or an app menu on macOS.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            Ok(())
        })
        .on_window_event(|win, event| {
            // Closing the panel must not quit the app — it lives in the tray.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if win.label() == PANEL {
                    api.prevent_close();
                    let _ = win.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
