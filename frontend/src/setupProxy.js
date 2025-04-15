const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // Configure the proxy middleware
  const apiProxy = createProxyMiddleware({
    target: 'http://127.0.0.1:7432', // Use IPv4 explicitly instead of localhost
    changeOrigin: true,
    secure: false,
    xfwd: true,
    logLevel: 'debug',
    // Important: Do NOT rewrite paths - preserve them exactly as they are
    pathRewrite: { '^/api': '/api' }, // This ensures /api/docs stays as /api/docs
    onProxyReq: (proxyReq, req, res) => {
      // Log proxy requests for debugging
      console.log(`Proxying ${req.method} ${req.url} to http://127.0.0.1:7432${req.url}`);
    },
    onError: (err, req, res) => {
      console.error('Proxy error:', err);
      res.writeHead(500, {
        'Content-Type': 'text/plain',
      });
      res.end(`Proxy error: Could not connect to backend at http://127.0.0.1:7432${req.url} - ${err.message}`);
    }
  });

  // Apply the proxy middleware to all /api routes
  app.use('/api', apiProxy);
  
  console.log('Proxy middleware configured for /api routes to http://127.0.0.1:7432');
};