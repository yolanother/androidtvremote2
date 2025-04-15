# Docker Setup for Android TV Remote

This directory contains Docker configuration files to run the Android TV Remote application in containers.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)

## Files

- `backend.Dockerfile`: Dockerfile for the Python Flask backend
- `frontend.Dockerfile`: Dockerfile for the React frontend
- `nginx.conf`: Nginx configuration for the frontend container
- `../docker-compose.yml`: Docker Compose configuration file with default settings
- `../docker-compose.local.yml`: Docker Compose configuration file that uses environment variables from .env

## Running the Application

### Standard Setup

From the root directory of the project, run:

```bash
docker-compose up -d
```

This will:
1. Build the backend and frontend images
2. Start the backend service on port 7432
3. Start the frontend service on port 7433
4. Create a network for the services to communicate

### Using Environment Variables

If you want to use custom environment variables from a .env file, use the local configuration:

```bash
docker-compose -f docker-compose.local.yml up -d
```

This will use the environment variables from your .env file, such as:
- BACKEND_PORT
- FRONTEND_PORT
- BACKEND_URL
- REACT_APP_BACKEND_URL

## Accessing the Application

- Frontend: http://localhost:7433
- Backend API: http://localhost:7433/api

## Environment Variables

The application uses the following environment variables from the `.env` file:

- `BACKEND_PORT`: The port for the backend service (default: 7432)
- `BACKEND_URL`: The URL for the backend service (default: http://localhost:7432)
- `REACT_APP_BACKEND_URL`: The URL for the frontend to connect to the backend (default: http://localhost:7432)
- `FRONTEND_PORT`: The port for the frontend service (default: 7433)

## Stopping the Application

```bash
docker-compose down
```

Or if using the local configuration:

```bash
docker-compose -f docker-compose.local.yml down
```

## Rebuilding After Changes

If you make changes to the code, rebuild the containers:

```bash
docker-compose up -d --build
```

Or with the local configuration:

```bash
docker-compose -f docker-compose.local.yml up -d --build
```

## Viewing Logs

```bash
# View all logs
docker-compose logs

# View logs for a specific service
docker-compose logs backend
docker-compose logs frontend

# Follow logs
docker-compose logs -f
```

## Volumes

The application uses Docker volumes to persist data:

- The paired TVs data is stored in a volume to persist between container restarts

## Troubleshooting

If you encounter issues:

1. Check the logs: `docker-compose logs`
2. Ensure all services are running: `docker-compose ps`
3. Restart the services: `docker-compose restart`
4. Rebuild the containers: `docker-compose up -d --build`