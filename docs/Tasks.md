# Tasks

## Backend
- [x] Set up Flask application.
- [x] Create REST API endpoints for:
  - Listing TVs.
  - Adding TVs.
  - Pairing with TVs.
  - Sending control commands.
- [x] Add Swagger/OpenAPI documentation for the REST API.
- [ ] Refactor event loop handling in AndroidTVRemote and Flask routes for pairing to avoid asyncio errors
- [ ] Ensure /api/tvs and /api/tvs/<ip>/pair endpoints follow demo.py logic for pairing
- [ ] Add error handling and clear responses for pairing process

## Frontend
- [x] Set up React application.
- [x] Create components for:
  - Listing TVs.
  - Adding TVs.
  - Pairing with TVs.
  - Sending control commands.
- [x] Integrate frontend with the Flask backend.
- [ ] Update Settings page to follow correct pairing flow (add TV, start pairing, prompt for code, finish pairing)
- [ ] Add UI feedback for pairing steps and errors

## Deployment
- [x] Set up Docker for containerized deployment.
- [x] Add CI/CD pipeline for automated testing and deployment.