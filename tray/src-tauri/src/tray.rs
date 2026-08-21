// Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
// repository root.
//
// Tray-icon presentation for the Android TV Remote desktop app. Draws the menubar/system-tray
// icon procedurally as an RGBA power glyph tinted by overall connection health (so no
// per-state image assets are shipped), and rebuilds the tray context menu from the device
// summary the webview pushes over the `sync_tray` command. Menu item ids are the wire format
// shared with the frontend: `show`, `settings`, `quit`, `power:<device_id>` and
// `mute:<device_id>`.

use serde::{Deserialize, Serialize};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Runtime,
};

/// Overall health of the appliance connection, used to tint the tray icon.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Health {
    /// Server reachable and every enabled device is connected.
    Ok,
    /// Server reachable but at least one device is not connected.
    Degraded,
    /// The appliance itself is unreachable or not configured yet.
    #[default]
    Offline,
}

impl Health {
    /// Returns the RGB triple the tray glyph is drawn in for this health state.
    fn rgb(self) -> [u8; 3] {
        match self {
            // Matches the --online / --pairing / --offline tokens in the web UI palette.
            Health::Ok => [52, 199, 123],
            Health::Degraded => [230, 168, 45],
            Health::Offline => [142, 142, 150],
        }
    }

    /// Returns the tooltip suffix describing this state to the user.
    fn label(self) -> &'static str {
        match self {
            Health::Ok => "connected",
            Health::Degraded => "partially connected",
            Health::Offline => "disconnected",
        }
    }
}

/// One registered TV as the tray menu needs to know it. Mirrors a subset of the
/// contract's `Device` / `DeviceState` that the frontend projects for us.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TrayDevice {
    /// Contract `device_id`: the MAC lowercased with colons stripped.
    pub id: String,
    /// Display name shown in the menu.
    pub name: String,
    /// Contract `DeviceState.connection` value.
    pub connection: String,
    /// Last reported power state, `None` until the TV reports it.
    pub is_on: Option<bool>,
    /// Last reported mute state, `None` until the TV reports it.
    pub muted: Option<bool>,
}

/// The whole tray-visible state, pushed from the webview whenever it changes.
#[derive(Debug, Clone, Deserialize, Serialize, Default)]
pub struct TrayState {
    /// Overall health, driving the icon colour.
    pub health: Health,
    /// Registered devices, in display order.
    pub devices: Vec<TrayDevice>,
}

/// Icon edge length in pixels. 32px is the size both macOS and Windows downsample from
/// cleanly for the menubar/notification area.
const ICON_SIZE: u32 = 32;

/// Draws the tray glyph — a power symbol (broken ring plus a stem) — as straight RGBA
/// bytes in the colour for `health`.
///
/// Drawing rather than shipping one PNG per state keeps the health indicator a single
/// source of truth and avoids three near-identical binary assets in the repo. Coverage is
/// computed per pixel with a one-pixel smooth edge, which is enough anti-aliasing at this
/// size.
///
/// # Arguments
/// * `health` - the state to tint the glyph with.
///
/// # Returns
/// An owned [`Image`] of [`ICON_SIZE`] x [`ICON_SIZE`] RGBA pixels.
pub fn icon_for(health: Health) -> Image<'static> {
    let [r, g, b] = health.rgb();
    let n = ICON_SIZE as f32;
    let c = n / 2.0;
    // Ring geometry, in pixels from the centre.
    let ring_outer = n * 0.36;
    let ring_inner = n * 0.24;
    let stem_half_width = n * 0.05;
    let stem_top = n * 0.14;
    let stem_bottom = c - n * 0.04;
    // Half-angle of the gap at the top of the ring, in radians.
    let gap = 0.45_f32;

    let mut rgba = Vec::with_capacity((ICON_SIZE * ICON_SIZE * 4) as usize);
    for y in 0..ICON_SIZE {
        for x in 0..ICON_SIZE {
            let px = x as f32 + 0.5 - c;
            let py = y as f32 + 0.5 - c;
            let dist = (px * px + py * py).sqrt();

            // Ring: a band between the two radii, minus a wedge at the top.
            let mut coverage = band(dist, ring_inner, ring_outer);
            if py < 0.0 && px.abs() <= py.abs() * (gap.tan()) {
                coverage = 0.0;
            }

            // Stem: a vertical bar from the gap down to just past the centre.
            if px.abs() <= stem_half_width + 0.5 && py >= stem_top - c && py <= stem_bottom - c {
                let stem = 1.0 - ((px.abs() - stem_half_width).max(0.0)).min(1.0);
                coverage = coverage.max(stem);
            }

            let alpha = (coverage.clamp(0.0, 1.0) * 255.0).round() as u8;
            rgba.extend_from_slice(&[r, g, b, alpha]);
        }
    }
    Image::new_owned(rgba, ICON_SIZE, ICON_SIZE)
}

/// Returns 1.0 well inside `[inner, outer]`, 0.0 well outside, and a linear ramp across the
/// one-pixel boundary on each side.
fn band(dist: f32, inner: f32, outer: f32) -> f32 {
    let outside = (outer - dist).clamp(0.0, 1.0);
    let inside = (dist - inner).clamp(0.0, 1.0);
    outside.min(inside)
}

/// The tooltip shown when hovering the tray icon.
///
/// # Arguments
/// * `state` - the current tray state.
pub fn tooltip_for(state: &TrayState) -> String {
    let connected = state
        .devices
        .iter()
        .filter(|d| d.connection == "connected")
        .count();
    format!(
        "Android TV Remote — {} ({}/{} devices)",
        state.health.label(),
        connected,
        state.devices.len()
    )
}

/// Builds the tray context menu for the given state.
///
/// The menu is: Show Remote, a per-device submenu of quick actions (power toggle and mute
/// toggle) for every connected device, Settings, and Quit. Devices that are not connected
/// are listed but disabled, so the user can see them without being able to fire a command
/// that would certainly fail.
///
/// # Arguments
/// * `app` - handle used to allocate the menu items.
/// * `state` - devices and health to render.
///
/// # Returns
/// The assembled [`Menu`], or the underlying Tauri error if an item could not be created.
pub fn build_menu<R: Runtime>(app: &AppHandle<R>, state: &TrayState) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;
    menu.append(&MenuItem::with_id(app, "show", "Show Remote", true, None::<&str>)?)?;

    if !state.devices.is_empty() {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        for device in &state.devices {
            let live = device.connection == "connected";
            let power_label = match device.is_on {
                Some(true) => "Turn Off",
                Some(false) => "Turn On",
                None => "Power",
            };
            let mute_label = match device.muted {
                Some(true) => "Unmute",
                _ => "Mute",
            };
            let power = MenuItem::with_id(
                app,
                format!("power:{}", device.id),
                power_label,
                live,
                None::<&str>,
            )?;
            let mute = MenuItem::with_id(
                app,
                format!("mute:{}", device.id),
                mute_label,
                live,
                None::<&str>,
            )?;
            let label = if live {
                device.name.clone()
            } else {
                format!("{} ({})", device.name, device.connection)
            };
            menu.append(&Submenu::with_items(app, label, true, &[&power, &mute])?)?;
        }
    }

    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?)?;
    Ok(menu)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icon_is_rgba_of_the_declared_size() {
        let img = icon_for(Health::Ok);
        assert_eq!(img.width(), ICON_SIZE);
        assert_eq!(img.height(), ICON_SIZE);
        assert_eq!(img.rgba().len(), (ICON_SIZE * ICON_SIZE * 4) as usize);
    }

    #[test]
    fn icon_draws_something_and_leaves_the_corners_clear() {
        let img = icon_for(Health::Ok);
        let opaque = img.rgba().chunks_exact(4).filter(|p| p[3] > 128).count();
        assert!(opaque > 40, "glyph should cover a meaningful area, got {opaque}px");
        // Top-left corner pixel is well outside the ring and must stay transparent.
        assert_eq!(img.rgba()[3], 0);
    }

    #[test]
    fn health_states_are_visually_distinct() {
        assert_ne!(Health::Ok.rgb(), Health::Degraded.rgb());
        assert_ne!(Health::Degraded.rgb(), Health::Offline.rgb());
    }

    #[test]
    fn tooltip_counts_only_connected_devices() {
        let state = TrayState {
            health: Health::Degraded,
            devices: vec![
                TrayDevice {
                    id: "aabbccddeeff".into(),
                    name: "Living Room".into(),
                    connection: "connected".into(),
                    is_on: Some(true),
                    muted: Some(false),
                },
                TrayDevice {
                    id: "112233445566".into(),
                    name: "Bedroom".into(),
                    connection: "unreachable".into(),
                    is_on: None,
                    muted: None,
                },
            ],
        };
        assert_eq!(
            tooltip_for(&state),
            "Android TV Remote — partially connected (1/2 devices)"
        );
    }
}
