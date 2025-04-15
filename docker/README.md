# Docker Setup for Android TV Remote

This directory contains Docker configuration files to run the Android TV Remote application in containers.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)

## Files

- `backend.Dockerfile`: Dockerfile for the Python Flask backend
- `frontend.Dockerfile`: Dockerfile for the React frontend
- `nginx.conf`: Nginx configuration for the frontend container
- `../docker-compose.yml`: Docker Compose configuration file

## Running the Application

From the root directory of the project, run:

```bash
docker-compose up -d
```

This will:
1. Build the backend and frontend images
2. Start the backend service on port 5000
3. Start the frontend service on port 80
4. Create a network for the services to communicate

## Accessing the Application

- Frontend: http://localhost
- Backend API: http://localhost/api

## Stopping the Application

```bash
docker-compose down
```

## Rebuilding After Changes

If you make changes to the code, rebuild the containers:

```bash
docker-compose up -d --build
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