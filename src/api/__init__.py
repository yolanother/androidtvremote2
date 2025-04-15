import os
from flask import Flask, send_from_directory
from flask_swagger_ui import get_swaggerui_blueprint
from flask_cors import CORS

app = Flask(__name__)

# Enable CORS for all routes with specific configuration
CORS(app, resources={r"/*": {
    "origins": ["http://localhost:7433", "http://127.0.0.1:7433"],
    "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    "allow_headers": ["Content-Type", "Authorization"]
}})

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

@app.route('/api/static/swagger.json')
def serve_swagger_json():
    """Serve the Swagger JSON file."""
    docs_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../docs'))
    return send_from_directory(directory=docs_dir, path='swagger.json')

# Import routes
from .routes import *