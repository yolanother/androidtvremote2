# Copyright (c) Yolan. Use of this file is governed by the LICENSE file in the
# repository root.
#
# Device, pairing, and control routes for the Android TV Remote appliance. Implements the
# registry endpoints (list, register by address, fetch, update, delete), the three-step
# human-in-the-loop pairing flow, and every control endpoint — keys, text entry, app
# launches, idempotent power, volume, explicit connect/disconnect, and Google Cast media
# transport. Each route is a thin translation between HTTP and the DeviceManager facade;
# all behaviour lives in the manager.
"""Device, pairing, and control routes for the Android TV Remote appliance."""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from ..deps import ManagerDep
from ..models import (
    CompletePairingRequest,
    Device,
    DeviceState,
    LaunchAppRequest,
    MediaControlRequest,
    RegisterDeviceRequest,
    SendKeyRequest,
    SendTextRequest,
    SetPowerRequest,
    SetVolumeRequest,
    StartPairingResponse,
    UpdateDeviceRequest,
)

router = APIRouter(prefix="/devices", tags=["devices"])


@router.get(
    "",
    response_model=list[Device],
    summary="List registered devices",
    description="Every registered TV together with its live connection state.",
)
async def list_devices(manager: ManagerDep) -> list[Device]:
    """Return every registered device.

    :param manager: The device manager.
    :returns: All registered devices with live state.
    """
    return manager.list_devices()


@router.post(
    "",
    response_model=Device,
    status_code=status.HTTP_201_CREATED,
    summary="Register a TV by address",
    description=(
        "Connects to the given address, reads the TV's name and MAC address from its "
        "certificate, and registers it under a permanent MAC-derived id. The address is "
        "stored as a mutable attribute, so a later DHCP change does not orphan the pairing."
    ),
    responses={
        409: {"description": "That MAC is already registered; the existing device is returned."},
        503: {"description": "No TV answered at that address."},
    },
)
async def register_device(body: RegisterDeviceRequest, manager: ManagerDep) -> Device:
    """Register a new TV.

    :param body: Address and optional display name.
    :param manager: The device manager.
    :returns: The newly registered device.
    """
    return await manager.add_device(body.host, body.name)


@router.get(
    "/{device_id}",
    response_model=Device,
    summary="Fetch one device",
    responses={404: {"description": "No device with that id."}},
)
async def get_device(device_id: str, manager: ManagerDep) -> Device:
    """Return one registered device.

    :param device_id: MAC-derived device identifier.
    :param manager: The device manager.
    :returns: The device with its live state.
    """
    return manager.get_device(device_id)


@router.patch(
    "/{device_id}",
    response_model=Device,
    summary="Rename, move, or enable/disable a device",
    description=(
        "Omitted fields are left unchanged. Changing the address reconnects at the new one "
        "without touching the certificate; disabling drops the held connection."
    ),
)
async def update_device(device_id: str, body: UpdateDeviceRequest, manager: ManagerDep) -> Device:
    """Update a device's mutable fields.

    :param device_id: MAC-derived device identifier.
    :param body: Fields to change.
    :param manager: The device manager.
    :returns: The updated device.
    """
    return await manager.update_device(
        device_id, name=body.name, host=body.host, enabled=body.enabled
    )


@router.delete(
    "/{device_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a device and its certificates",
)
async def remove_device(device_id: str, manager: ManagerDep) -> Response:
    """Delete a device, its registration, and its stored keypair.

    :param device_id: MAC-derived device identifier.
    :param manager: The device manager.
    :returns: An empty 204 response.
    """
    await manager.remove_device(device_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# -- pairing -----------------------------------------------------------------------------


@router.post(
    "/{device_id}/pair",
    response_model=StartPairingResponse,
    summary="Start pairing",
    description=(
        "Generates the device's keypair if missing and starts the handshake; the TV then "
        "displays a 6-character code. Submit it to pair/complete within 120 seconds."
    ),
)
async def start_pairing(device_id: str, manager: ManagerDep) -> StartPairingResponse:
    """Begin the pairing handshake.

    :param device_id: MAC-derived device identifier.
    :param manager: The device manager.
    :returns: The ``code_required`` acknowledgement.
    """
    await manager.start_pairing(device_id)
    return StartPairingResponse()


@router.post(
    "/{device_id}/pair/complete",
    response_model=Device,
    summary="Complete pairing with the on-screen code",
    responses={
        400: {"description": "The TV rejected the code."},
        409: {"description": "No pairing session is open."},
    },
)
async def complete_pairing(
    device_id: str, body: CompletePairingRequest, manager: ManagerDep
) -> Device:
    """Finish the pairing handshake.

    :param device_id: MAC-derived device identifier.
    :param body: The code shown on the TV.
    :param manager: The device manager.
    :returns: The now-paired device.
    """
    return await manager.finish_pairing(device_id, body.code)


@router.delete(
    "/{device_id}/pair",
    response_model=Device,
    summary="Unpair, deleting the stored certificates",
)
async def unpair(device_id: str, manager: ManagerDep) -> Device:
    """Drop the pairing but keep the registration.

    :param device_id: MAC-derived device identifier.
    :param manager: The device manager.
    :returns: The device, now unpaired.
    """
    return await manager.unpair(device_id)


# -- control -----------------------------------------------------------------------------


@router.post(
    "/{device_id}/keys",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Send a key press",
    description=(
        "Accepts the short form (DPAD_UP) or the full keycode (KEYCODE_DPAD_UP). Use repeat "
        "for volume ramps and fast scrolling, and START_LONG/END_LONG for a held press."
    ),
    responses={
        400: {"description": "The key is not in the catalog."},
        409: {"description": "The device is not paired."},
        503: {"description": "No live connection to the TV."},
    },
)
async def send_key(device_id: str, body: SendKeyRequest, manager: ManagerDep) -> Response:
    """Send a key press to the TV.

    :param device_id: MAC-derived device identifier.
    :param body: Key, direction, and repeat count.
    :param manager: The device manager.
    :returns: An empty 202 response.
    """
    await manager.send_key(device_id, body.key, body.direction, body.repeat)
    return Response(status_code=status.HTTP_202_ACCEPTED)


@router.post(
    "/{device_id}/text",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Type text into the focused field",
)
async def send_text(device_id: str, body: SendTextRequest, manager: ManagerDep) -> Response:
    """Type text on the TV.

    :param device_id: MAC-derived device identifier.
    :param body: The text to type.
    :param manager: The device manager.
    :returns: An empty 202 response.
    """
    await manager.send_text(device_id, body.text)
    return Response(status_code=status.HTTP_202_ACCEPTED)


@router.post(
    "/{device_id}/launch",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Launch an app or open a deep link",
    description="Accepts a catalog slug (netflix), a package id, or a deep-link URL.",
)
async def launch_app(device_id: str, body: LaunchAppRequest, manager: ManagerDep) -> Response:
    """Launch an app on the TV.

    :param device_id: MAC-derived device identifier.
    :param body: The app to launch.
    :param manager: The device manager.
    :returns: An empty 202 response.
    """
    await manager.launch_app(device_id, body.app)
    return Response(status_code=status.HTTP_202_ACCEPTED)


@router.post(
    "/{device_id}/power",
    response_model=DeviceState,
    summary="Set power state, idempotently",
    description=(
        "Reads the TV's reported state and only sends the power key when it differs, so a "
        "home automation system can retry safely. Send {\"on\": null} to toggle regardless."
    ),
)
async def set_power(device_id: str, body: SetPowerRequest, manager: ManagerDep) -> DeviceState:
    """Turn the TV on or off.

    :param device_id: MAC-derived device identifier.
    :param body: Desired power state, or null to toggle.
    :param manager: The device manager.
    :returns: The resulting device state.
    """
    return await manager.set_power(device_id, body.on)


@router.post(
    "/{device_id}/volume",
    response_model=DeviceState,
    summary="Step the volume, mute, or set an absolute level",
    description=(
        "Supply exactly one of action (up, down, mute, unmute, toggle_mute) or level. An "
        "absolute level is reached by stepping from the level the TV last reported."
    ),
)
async def set_volume(device_id: str, body: SetVolumeRequest, manager: ManagerDep) -> DeviceState:
    """Change the TV's volume or mute state.

    :param device_id: MAC-derived device identifier.
    :param body: Either an action or an absolute level.
    :param manager: The device manager.
    :returns: The resulting device state.
    """
    return await manager.set_volume(device_id, action=body.action, level=body.level)


@router.post(
    "/{device_id}/media",
    response_model=DeviceState,
    summary="Control the Google Cast media session",
    description=(
        "Transport and scrubbing over the TV's Cast channel: play, pause, play_pause, "
        "stop, seek, next, previous. position is required for seek and rejected for "
        "everything else. Returns 409 no_media_session when nothing is casting, which is "
        "the common case — Cast publishes a media session only for content cast from a "
        "phone or browser, so a TV playing one of its own apps has none. Clients should "
        "hide transport controls while state.now_playing is null rather than calling this."
    ),
    responses={
        400: {"description": "seek without a position, or a position on another action."},
        404: {"description": "No device with that id."},
        409: {"description": "Nothing is casting, or the session refuses that action."},
    },
)
async def media_control(
    device_id: str, body: MediaControlRequest, manager: ManagerDep
) -> DeviceState:
    """Run a transport command against the device's Cast media session.

    :param device_id: MAC-derived device identifier.
    :param body: The action and, for seek, its target offset.
    :param manager: The device manager.
    :returns: The resulting device state.
    """
    return await manager.media_control(device_id, body.action, body.position)


@router.post(
    "/{device_id}/connect",
    response_model=DeviceState,
    summary="Open the held connection",
)
async def connect(device_id: str, manager: ManagerDep) -> DeviceState:
    """Connect to the TV.

    :param device_id: MAC-derived device identifier.
    :param manager: The device manager.
    :returns: The resulting device state.
    """
    return await manager.connect(device_id)


@router.post(
    "/{device_id}/disconnect",
    response_model=DeviceState,
    summary="Close the held connection",
)
async def disconnect(device_id: str, manager: ManagerDep) -> DeviceState:
    """Disconnect from the TV.

    :param device_id: MAC-derived device identifier.
    :param manager: The device manager.
    :returns: The resulting device state.
    """
    return await manager.disconnect(device_id)


@router.get(
    "/{device_id}/state",
    response_model=DeviceState,
    summary="Read the live device state",
)
async def get_state(device_id: str, manager: ManagerDep) -> DeviceState:
    """Return the TV's live state.

    :param device_id: MAC-derived device identifier.
    :param manager: The device manager.
    :returns: The device's current state.
    """
    return manager.get_state(device_id)
