#!/bin/bash

# Load environment variables
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Export BACKEND_URL for React
export BACKEND_URL=${BACKEND_URL:-http://localhost:7432}
export FRONTEND_PORT=${FRONTEND_PORT:-7433}

# Set up virtual environment if not already set up
if [ ! -d ".venv" ]; then
    python -m venv .venv
fi

# Activate virtual environment
source .venv/Scripts/activate

# Install dependencies
pip install -r requirements.txt || { echo "Failed to install dependencies"; exit 1; }

# Parse arguments
BACKEND=false
FRONTEND=false
for arg in "$@"; do
    if [ "$arg" == "--backend" ]; then
        BACKEND=true
    fi
    if [ "$arg" == "--frontend" ]; then
        FRONTEND=true
    fi
done

# Start the Python backend in the foreground if --backend is specified
if [ "$BACKEND" == true ]; then
    (cd src && exec python app.py --port=$BACKEND_PORT) || { echo "Failed to start backend"; exit 1; }
fi

# Start the React frontend if --frontend is specified or no arguments are provided
if [ "$FRONTEND" == true ]; then
    (cd frontend && PORT=$FRONTEND_PORT npm start) || { echo "Failed to start frontend"; exit 1; }
fi

# Start both backend and frontend if no arguments are provided
if [ "$BACKEND" == false ] && [ "$FRONTEND" == false ]; then
    (cd src && python app.py --port=$BACKEND_PORT &) || { echo "Failed to start backend"; exit 1; }
    (cd frontend && PORT=$FRONTEND_PORT npm start) || { echo "Failed to start frontend"; exit 1; }
fi