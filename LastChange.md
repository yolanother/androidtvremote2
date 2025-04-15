Add Docker support for running the application

This commit adds Docker support to the Android TV Remote application, making it easier to deploy and run. The changes include:

1. Created a docker-compose.yml file in the root directory to orchestrate the services
2. Added Dockerfiles for both the backend and frontend in the docker/ directory
3. Created a custom Nginx configuration for the frontend container
4. Updated the README.md with Docker usage instructions
5. Added detailed Docker documentation in docker/README.md

The Docker setup allows users to run the entire application with a single command:
```
docker-compose up -d
```

This will start both the backend API and the frontend web interface, with the frontend accessible at http://localhost and the API at http://localhost/api.