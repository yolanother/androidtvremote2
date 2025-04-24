from flask import request, jsonify, send_from_directory
import flask
import asyncio
from androidtvremote2 import AndroidTVRemote, CannotConnect, ConnectionClosed, InvalidAuth
from . import app, loop
from zeroconf import Zeroconf, ServiceBrowser, ServiceStateChange
import time
import sys
import os
import json
from flask_restx import Api, Resource, fields, Namespace
from flask import Flask
from jinja2 import ChoiceLoader, FileSystemLoader

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

app = Flask(__name__)
api = Api(
    app,
    version='1.0',
    title='Android TV Remote API',
    description='API documentation for the Android TV Remote application.',
    doc='/api/docs',
    doc_expansion='full',  # Start all sections expanded
)

# Ensure Flask can find both the default Flask-RESTx templates and our custom templates
app.jinja_loader = ChoiceLoader([
    FileSystemLoader(os.path.join(os.path.dirname(__file__), 'templates')),
    app.jinja_loader  # default loader (for flask_restx templates)
])

# Models for documentation
TVModel = api.model('TV', {
    'ip': fields.String(description='IP address of the TV'),
    'name': fields.String(description='Name of the TV'),
})
AvailableTVModel = api.model('AvailableTV', {
    'name': fields.String(description='Name of the TV'),
    'addresses': fields.List(fields.String, description='IP addresses'),
})
CommandModel = api.model('Command', {
    'command': fields.String(description='Control command'),
})

api_ns = Namespace('AndroidTV', description='Android TV Remote API')

@api_ns.route('/tvs')
class TVListResource(Resource):
    @api_ns.marshal_list_with(TVModel)
    def get(self):
        """List all connected TVs."""
        return [{"ip": ip, "name": tvs[ip]["name"]} for ip in tvs]

    @api_ns.expect(TVModel, validate=True)
    def post(self):
        """Add a new TV by IP address."""
        data = api.payload
        ip = data.get('ip')
        name = data.get('name', f'TV-{ip}')
        if ip in tvs:
            return {"error": "TV already added."}, 400
        tvs[ip] = {
            "name": name,
            "remote": AndroidTVRemote(name, 'cert.pem', 'key.pem', ip)
        }
        save_tvs()
        return {"message": "TV added successfully.", "name": name, "ip": ip}

@api_ns.route('/tvs/<string:ip>/pair')
class TVPairResource(Resource):
    def post(self, ip):
        """Pair with a TV."""
        if ip not in tvs:
            return {"error": "TV not found."}, 404
        remote = tvs[ip]['remote']
        async def do_pair():
            await remote.async_generate_cert_if_missing()
            await remote.async_start_pairing()
        try:
            fut = asyncio.run_coroutine_threadsafe(do_pair(), loop)
            fut.result()
        except Exception as e:
            return {"error": str(e)}, 500
        return {"message": "Pairing started. Enter the pairing code."}

    @api_ns.expect(api.model('PairingCode', {'pairing_code': fields.String(required=True)}), validate=True)
    def put(self, ip):
        """Finish pairing with a TV by providing the pairing code."""
        if ip not in tvs:
            return {"error": "TV not found."}, 404
        data = api.payload
        pairing_code = data.get('pairing_code')
        remote = tvs[ip]['remote']
        async def do_finish():
            await remote.async_finish_pairing(pairing_code)
        try:
            fut = asyncio.run_coroutine_threadsafe(do_finish(), loop)
            fut.result()
            save_tvs()
            return {"message": "Pairing successful."}
        except InvalidAuth:
            return {"error": "Invalid pairing code."}, 400
        except ConnectionClosed:
            return {"error": "Connection closed. Try pairing again."}, 400
        except Exception as e:
            return {"error": str(e)}, 500

@api_ns.route('/tvs/<string:ip>/control')
class TVControlResource(Resource):
    @api_ns.expect(CommandModel, validate=True)
    def post(self, ip):
        """Send a control command to the TV."""
        if ip not in tvs:
            return {"error": "TV not found."}, 404
        data = api.payload
        command = data.get('command')
        remote = tvs[ip]['remote']
        try:
            # Try to connect if not connected
            if not getattr(remote, '_remote_message_protocol', None):
                async def do_connect():
                    await remote.async_connect()
                fut = asyncio.run_coroutine_threadsafe(do_connect(), loop)
                fut.result()
            try:
                remote.send_key_command(command)
                return {"message": "Command sent successfully."}
            except (ConnectionClosed, CannotConnect):
                # Attempt to reconnect and resend
                async def do_reconnect():
                    await remote.async_connect()
                fut = asyncio.run_coroutine_threadsafe(do_reconnect(), loop)
                try:
                    fut.result()
                    remote.send_key_command(command)
                    return {"message": "Command sent successfully after reconnect."}
                except InvalidAuth:
                    return {"error": "Pairing required. Please pair again."}, 400
                except (ConnectionClosed, CannotConnect):
                    return {"error": "Cannot connect to TV. Pairing may be required."}, 500
        except InvalidAuth:
            return {"error": "Pairing required. Please pair again."}, 400
        except Exception as e:
            return {"error": str(e)}, 500

@api_ns.route('/available_tvs')
class AvailableTVsResource(Resource):
    @api_ns.marshal_list_with(AvailableTVModel)
    def get(self):
        """List all available TVs on the network."""
        discovery = TVDiscovery()
        devices = discovery.discover_tvs()
        return devices

TVKEYS_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../TvKeys.txt'))

@api_ns.route('/commands')
class CommandsResource(Resource):
    def get(self):
        """List all available control commands."""
        commands = []
        try:
            with open(TVKEYS_PATH, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('//'):
                        commands.append(line)
        except Exception as e:
            return {"error": str(e)}, 500
        return commands

api.add_namespace(api_ns, path='/api')

@app.route('/api/docs/static/<path:filename>')
def swagger_static(filename):
    """Serve custom static files for Swagger UI (logo, CSS, etc)."""
    static_dir = os.path.join(os.path.dirname(__file__), 'static')
    return flask.send_from_directory(static_dir, filename)