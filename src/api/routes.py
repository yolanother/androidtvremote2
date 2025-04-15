from flask import request, jsonify, send_from_directory
import asyncio
from androidtvremote2 import AndroidTVRemote, CannotConnect, ConnectionClosed, InvalidAuth
from . import app, loop
from zeroconf import Zeroconf, ServiceBrowser, ServiceStateChange
import time
import sys
import os
import json

# Store connected TVs
TVS_FILE = os.path.join(os.path.dirname(__file__), 'paired_tvs.json')
tvs = {}

def load_tvs():
    if os.path.exists(TVS_FILE):
        try:
            with open(TVS_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for ip, info in data.items():
                    tvs[ip] = {
                        "name": info["name"],
                        "remote": AndroidTVRemote(info["name"], 'cert.pem', 'key.pem', ip)
                    }
        except Exception:
            pass

def save_tvs():
    try:
        with open(TVS_FILE, 'w', encoding='utf-8') as f:
            json.dump({ip: {"name": tv["name"]} for ip, tv in tvs.items()}, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

load_tvs()

class TVDiscovery:
    CACHE_FILE = os.path.join(os.path.dirname(__file__), 'available_tvs_cache.json')

    def __init__(self):
        self.zeroconf = Zeroconf()
        self.devices = []
        self.last_discovery_time = 0
        self.cache_timeout = 60  # Cache timeout in seconds
        self.persistent_cache = self._load_cache()

    def _load_cache(self):
        if os.path.exists(self.CACHE_FILE):
            try:
                with open(self.CACHE_FILE, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                return []
        return []

    def _save_cache(self):
        try:
            with open(self.CACHE_FILE, 'w', encoding='utf-8') as f:
                json.dump(self.persistent_cache, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def on_service_state_change(self, zeroconf, service_type, name, state_change):
        if state_change == ServiceStateChange.Added:
            info = zeroconf.get_service_info(service_type, name)
            if info:
                addresses = [addr for addr in info.parsed_scoped_addresses()]
                device = {"name": name, "addresses": addresses}
                self.devices.append(device)
                # Add to persistent cache if not already present
                if not any(d["name"] == name and d["addresses"] == addresses for d in self.persistent_cache):
                    self.persistent_cache.append(device)
                    self._save_cache()

    def discover_tvs(self):
        current_time = time.time()
        if current_time - self.last_discovery_time < self.cache_timeout:
            return self.persistent_cache  # Return persistent cache if within timeout

        self.devices = []  # Reset devices list
        browser = ServiceBrowser(self.zeroconf, "_androidtvremote2._tcp.local.", handlers=[self.on_service_state_change])
        time.sleep(3)  # Wait for 3 seconds to allow discovery to complete
        self.last_discovery_time = current_time
        # Merge new discoveries into persistent cache
        for device in self.devices:
            if not any(d["name"] == device["name"] and d["addresses"] == device["addresses"] for d in self.persistent_cache):
                self.persistent_cache.append(device)
        self._save_cache()
        return self.persistent_cache

@app.route('/api/tvs', methods=['GET'])
def list_tvs():
    """List all connected TVs."""
    return jsonify([
        {"ip": ip, "name": tvs[ip]["name"]} for ip in tvs
    ])

# The following routes were moved from app.py
@app.route('/api/tvs', methods=['POST'])
def add_tv():
    """Add a new TV by IP address."""
    data = request.json
    ip = data.get('ip')
    name = data.get('name', f'TV-{ip}')

    if ip in tvs:
        return jsonify({"error": "TV already added."}), 400

    tvs[ip] = {
        "name": name,
        "remote": AndroidTVRemote(name, 'cert.pem', 'key.pem', ip)
    }
    save_tvs()
    return jsonify({"message": "TV added successfully.", "name": name, "ip": ip})

@app.route('/api/tvs/<ip>/pair', methods=['POST'])
def pair_tv(ip):
    """Pair with a TV."""
    if ip not in tvs:
        return jsonify({"error": "TV not found."}), 404

    remote = tvs[ip]['remote']
    async def do_pair():
        await remote.async_generate_cert_if_missing()
        await remote.async_start_pairing()
    try:
        fut = asyncio.run_coroutine_threadsafe(do_pair(), loop)
        fut.result()
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"message": "Pairing started. Enter the pairing code."})

@app.route('/api/tvs/<ip>/pair', methods=['PUT'])
def finish_pairing(ip):
    """Finish pairing with a TV by providing the pairing code."""
    if ip not in tvs:
        return jsonify({"error": "TV not found."}), 404

    data = request.json
    pairing_code = data.get('pairing_code')
    remote = tvs[ip]['remote']
    async def do_finish():
        await remote.async_finish_pairing(pairing_code)
    try:
        fut = asyncio.run_coroutine_threadsafe(do_finish(), loop)
        fut.result()
        save_tvs()
        return jsonify({"message": "Pairing successful."})
    except InvalidAuth:
        return jsonify({"error": "Invalid pairing code."}), 400
    except ConnectionClosed:
        return jsonify({"error": "Connection closed. Try pairing again."}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/tvs/<ip>/control', methods=['POST'])
def control_tv(ip):
    """Send a control command to the TV."""
    if ip not in tvs:
        return jsonify({"error": "TV not found."}), 404

    data = request.json
    command = data.get('command')

    remote = tvs[ip]['remote']
    try:
        # Ensure the remote is connected before sending the command
        if not getattr(remote, '_remote_message_protocol', None):
            async def do_connect():
                await remote.async_connect()
            fut = asyncio.run_coroutine_threadsafe(do_connect(), loop)
            fut.result()
        remote.send_key_command(command)
        return jsonify({"message": "Command sent successfully."})
    except InvalidAuth:
        return jsonify({"error": "Pairing required. Please pair again."}), 400
    except ConnectionClosed:
        return jsonify({"error": "Connection closed. Try again."}), 400
    except CannotConnect:
        return jsonify({"error": "Cannot connect to TV."}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/available_tvs', methods=['GET'])
def list_available_tvs():
    """List all available TVs on the network."""
    discovery = TVDiscovery()
    devices = discovery.discover_tvs()
    return jsonify(devices)