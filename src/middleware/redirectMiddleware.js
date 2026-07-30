const db = require('../config/db');

/**
 * Global redirection interceptor middleware.
 * Looks up requested GET paths in the url_redirects database table.
 */
module.exports = async (req, res, next) => {
  try {
    // Redirection routing logic only applies to GET requests to save database load
    if (req.method !== 'GET') {
      return next();
    }

    const requestedPath = req.path;

    // Performance SEO: Skip redirects lookup query for static core assets and API routes
    if (requestedPath === '/sitemap.xml' || requestedPath === '/robots.txt' || requestedPath.startsWith('/api/')) {
      return next();
    }
    
    // Check if redirect matches the requested path
    const [redirects] = await db.query(
      'SELECT target_path, status_code FROM url_redirects WHERE source_path = ?',
      [requestedPath]
    );

    if (redirects.length > 0) {
      const redirect = redirects[0];
      const status = redirect.status_code || 301;
      
      console.log(`[Redirect Engine] Re-routing requested path "${requestedPath}" to "${redirect.target_path}" with status ${status}`);
      return res.redirect(status, redirect.target_path);
    }
  } catch (err) {
    console.error('[Redirect Engine Error] Middleware lookup failed:', err.message);
  }

  next();
};
