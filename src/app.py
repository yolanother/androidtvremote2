from flask import Flask
import asyncio
import argparse
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

# Import the API routes
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

# Routes have been moved to api/routes.py

# Make the app available to the api package
from api import app
if __name__ == '__main__':
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Run the Android TV Remote API server')
    parser.add_argument('--port', type=int, default=int(os.getenv('BACKEND_PORT', 7432)),
                        help='Port to run the server on (default: 7432 or BACKEND_PORT env var)')
    args = parser.parse_args()
    
    print(f"Starting server on port {args.port}")
    app.run(debug=True, host='0.0.0.0', port=args.port)