fix: Resolve proxy configuration issues between frontend and backend

- Removed conflicting proxy setting from package.json
- Enhanced setupProxy.js with improved error handling and logging
- Fixed path preservation in proxy configuration to ensure proper routing
- Updated to use explicit IPv4 address (127.0.0.1) instead of localhost to avoid IPv6 issues
- Added CORS configuration in both app.py and api/__init__.py to properly allow requests from frontend

These changes address the proxy setup issues by:
1. Ensuring the proxy correctly preserves paths when forwarding requests
2. Using explicit IPv4 addressing to avoid IPv6 connection issues
3. Adding detailed logging for better debugging
4. Properly configuring CORS to allow cross-origin requests