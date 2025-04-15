# androidtvremote2

A Python library for interacting with Android TV using the Android TV Remote protocol v2. This is the same protocol the Google TV mobile app is using. It doesn't require ADB or enabling developer tools on the Android TV device. It only requires the [Android TV Remote Service](https://play.google.com/store/apps/details?id=com.google.android.tv.remote.service) that comes pre-installed on most Android TV devices.

For a list of the most common commands you can send to the Android TV see: [TvKeys](https://github.com/tronikos/androidtvremote2/blob/main/TvKeys.txt).
For a full list see [here](https://github.com/tronikos/androidtvremote2/blob/b4c49ac03043b1b9c40c2f2960e466d5a3b8bd67/src/androidtvremote2/remotemessage.proto#L90).
In addition to commands you can send URLs to open apps registered to handle them. See [this guide](https://community.home-assistant.io/t/android-tv-remote-app-links-deep-linking-guide/567921) for how to find deep links for apps.

## Credits

- Official [implementation](https://android.googlesource.com/platform/external/google-tv-pairing-protocol/+/refs/heads/master) of the pairing protocol in Java
- [Implementation](https://github.com/farshid616/Android-TV-Remote-Controller-Python) in Python but for the old v1 protocol
- [Implementation](https://github.com/louis49/androidtv-remote) in Node JS for the v2 protocol
- [Description](https://github.com/Aymkdn/assistant-freebox-cloud/wiki/Google-TV-(aka-Android-TV)-Remote-Control-(v2)) of the v2 protocol

## Example

See [demo.py](https://github.com/tronikos/androidtvremote2/blob/main/src/demo.py)

## Web Interface

This project includes a web interface built with React that allows you to control your Android TV from a browser. The web interface provides a responsive remote control with various tabs for different functions.

### Running with Docker

The easiest way to run the web interface is using Docker:

#### Standard Setup

```sh
# Build and start the containers with default settings
docker-compose up -d

# Access the web interface at http://localhost:7433
# Access the API at http://localhost:7433/api
```

#### Using Environment Variables

If you want to use custom environment variables from a .env file:

```sh
# Build and start the containers with environment variables from .env
docker-compose -f docker-compose.local.yml up -d

# Access the web interface at the configured port (default: 7433)
```

The application supports the following environment variables in the `.env` file:
- `BACKEND_PORT`: The port for the backend service (default: 7432)
- `BACKEND_URL`: The URL for the backend service (default: http://localhost:7432)
- `REACT_APP_BACKEND_URL`: The URL for the frontend to connect to the backend (default: http://localhost:7432)
- `FRONTEND_PORT`: The port for the frontend service (default: 7433)

For more details on the Docker setup, see [docker/README.md](docker/README.md).

## Development environment

```sh
python3 -m venv .venv
source .venv/bin/activate
# for Windows CMD:
# .venv\Scripts\activate.bat
# for Windows PowerShell:
# .venv\Scripts\Activate.ps1

# Install dependencies
python -m pip install --upgrade pip
python -m pip install .

# Generate *_pb2.py from *.proto
python -m pip install grpcio-tools mypy-protobuf
python -m grpc_tools.protoc src/androidtvremote2/*.proto --python_out=src/androidtvremote2 --mypy_out=src/androidtvremote2 -Isrc/androidtvremote2

# Run pre-commit
python -m pip install pre-commit
pre-commit autoupdate
pre-commit install
pre-commit run --all-files

# Alternative: run formatter, lint, and type checking
python -m pip install isort black flake8 ruff mypy
isort . ; black . ; flake8 . ; ruff check . --fix ; mypy --install-types .

# Run tests
python -m pip install pytest
pytest

# Run demo
python -m pip install pynput zeroconf
python src/demo.py

# Build package
python -m pip install build
python -m build
```

### Running the Web Interface in Development Mode

To run the web interface in development mode:

```sh
# Start the backend API
python src/app.py

# In a separate terminal, start the frontend
cd frontend
npm install
npm start

# Access the web interface at http://localhost:3000
