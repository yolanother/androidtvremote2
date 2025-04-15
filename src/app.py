from flask import Flask, request, jsonify, send_from_directory
import asyncio
import argparse
from androidtvremote2 import AndroidTVRemote, CannotConnect, ConnectionClosed, InvalidAuth
from flask_swagger_ui import get_swaggerui_blueprint
import os
from flask_cors import CORS

app = Flask(__name__)
# Enable CORS for all routes with more specific configuration
CORS(app, resources={r"/*": {
    "origins": ["http://localhost:7433", "http://127.0.0.1:7433", os.getenv('FRONTEND_URL', "http://localhost")],
    "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    "allow_headers": ["Content-Type", "Authorization"]
}})
CORS(app, resources={r"/*": {"origins": "*"}})

from api import routes  # Ensure all API routes are registered

# Swagger setup
SWAGGER_URL = '/api/docs'
API_URL = '/api/static/swagger.json'
swaggerui_blueprint = get_swaggerui_blueprint(
    SWAGGER_URL,
    API_URL,
    config={
        'app_name': "Android TV Remote API"
    }
)
app.register_blueprint(swaggerui_blueprint, url_prefix=SWAGGER_URL)

# Store connected TVs
tvs = {}

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
    return jsonify({"message": "TV added successfully.", "name": name, "ip": ip})

@app.route('/api/tvs/<ip>/pair', methods=['POST'])
def pair_tv(ip):
    """Pair with a TV."""
    if ip not in tvs:
        return jsonify({"error": "TV not found."}), 404

    remote = tvs[ip]['remote']
    asyncio.run(remote.async_generate_cert_if_missing())
    asyncio.run(remote.async_start_pairing())

    return jsonify({"message": "Pairing started. Enter the pairing code."})

@app.route('/api/tvs/<ip>/pair', methods=['PUT'])
def finish_pairing(ip):
    """Finish pairing with a TV by providing the pairing code."""
    if ip not in tvs:
        return jsonify({"error": "TV not found."}), 404

    data = request.json
    pairing_code = data.get('pairing_code')

    remote = tvs[ip]['remote']
    try:
        asyncio.run(remote.async_finish_pairing(pairing_code))
        return jsonify({"message": "Pairing successful."})
    except InvalidAuth:
        return jsonify({"error": "Invalid pairing code."}), 400
    except ConnectionClosed:
        return jsonify({"error": "Connection closed. Try pairing again."}), 400

@app.route('/api/tvs/<ip>/control', methods=['POST'])
def control_tv(ip):
    """Send a control command to the TV."""
    if ip not in tvs:
        return jsonify({"error": "TV not found."}), 404

    data = request.json
    command = data.get('command')

    remote = tvs[ip]['remote']
    try:
        remote.send_key_command(command)
        return jsonify({"message": "Command sent successfully."})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/devices', methods=['GET'])
def list_devices():
    """List all available devices."""
    devices = [
        {"name": "Living Room TV", "ip": "192.168.1.10"},
        {"name": "Bedroom TV", "ip": "192.168.1.11"},
        {"name": "Kitchen TV", "ip": "192.168.1.12"}
    ]
    return jsonify(devices)

from api import app
if __name__ == '__main__':
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Run the Android TV Remote API server')
    parser.add_argument('--port', type=int, default=int(os.getenv('BACKEND_PORT', 7432)),
                        help='Port to run the server on (default: 7432 or BACKEND_PORT env var)')
    args = parser.parse_args()
    
    print(f"Starting server on port {args.port}")
    app.run(debug=True, host='0.0.0.0', port=args.port)