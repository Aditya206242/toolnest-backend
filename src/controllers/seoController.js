const db = require('../config/db');

// Sitemap Cache Store (Optimizes Performance SEO by reducing database hits on crawl bursts)
let cachedSitemapXml = null;
let lastCacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// GET /sitemap.xml
exports.getSitemap = async (req, res, next) => {
  try {
    const now = Date.now();
    
    // Serve cached copy if within TTL
    if (cachedSitemapXml && (now - lastCacheTimestamp) < CACHE_TTL_MS) {
      res.header('Content-Type', 'application/xml');
      res.header('X-Sitemap-Cache', 'HIT');
      return res.status(200).send(cachedSitemapXml);
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const staticLastMod = new Date().toISOString().split('T')[0];

    // Core static entries
    const urls = [
      { loc: `${frontendUrl}/`, changefreq: 'daily', priority: '1.0', lastmod: staticLastMod },
      { loc: `${frontendUrl}/pdf`, changefreq: 'weekly', priority: '0.8', lastmod: staticLastMod },
      { loc: `${frontendUrl}/image`, changefreq: 'weekly', priority: '0.8', lastmod: staticLastMod },
      { loc: `${frontendUrl}/blog`, changefreq: 'daily', priority: '0.8', lastmod: staticLastMod }
    ];

    // Fetch active tools from database
    const [tools] = await db.query("SELECT name, slug, category FROM tools WHERE status = 'active'");
    for (const tool of tools) {
      const categoryPath = tool.category === 'pdf' ? 'pdf' : 'image';
      // Include fallback images for tools (e.g. site logo or default icons)
      urls.push({
        loc: `${frontendUrl}/${categoryPath}/${tool.slug}`,
        changefreq: 'monthly',
        priority: '0.7',
        lastmod: staticLastMod,
        image: `${frontendUrl}/output-no-bg.png`
      });
    }

    // Fetch active published blog posts
    const [blogs] = await db.query(
      "SELECT slug, featured_image, COALESCE(published_at, created_at) as lastmod FROM blogs WHERE status = 'published' AND (published_at IS NULL OR published_at <= NOW())"
    );
    for (const blog of blogs) {
      const date = new Date(blog.lastmod).toISOString().split('T')[0];
      const blogUrl = {
        loc: `${frontendUrl}/blog/${blog.slug}`,
        lastmod: date,
        changefreq: 'weekly',
        priority: '0.6'
      };
      
      // Dynamic Image SEO sitemap indexing
      if (blog.featured_image) {
        blogUrl.image = blog.featured_image.startsWith('http') 
          ? blog.featured_image 
          : `${frontendUrl}${blog.featured_image}`;
      }
      urls.push(blogUrl);
    }

    // Fetch categories to index landing pages
    const [categories] = await db.query("SELECT slug FROM categories");
    for (const cat of categories) {
      urls.push({
        loc: `${frontendUrl}/blog?category=${cat.slug}`,
        changefreq: 'weekly',
        priority: '0.5',
        lastmod: staticLastMod
      });
    }

    // Fetch tags to index tag pages
    const [tags] = await db.query("SELECT slug FROM tags");
    for (const tag of tags) {
      urls.push({
        loc: `${frontendUrl}/blog?tag=${tag.slug}`,
        changefreq: 'weekly',
        priority: '0.4',
        lastmod: staticLastMod
      });
    }

    // Build sitemap XML string (including standard & image namespaces)
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n';
    
    for (const url of urls) {
      xml += '  <url>\n';
      xml += `    <loc>${url.loc}</loc>\n`;
      if (url.lastmod) {
        xml += `    <lastmod>${url.lastmod}</lastmod>\n`;
      }
      xml += `    <changefreq>${url.changefreq}</changefreq>\n`;
      xml += `    <priority>${url.priority}</priority>\n`;
      if (url.image) {
        xml += '    <image:image>\n';
        xml += `      <image:loc>${url.image}</image:loc>\n`;
        xml += '    </image:image>\n';
      }
      xml += '  </url>\n';
    }
    
    xml += '</urlset>';

    cachedSitemapXml = xml;
    lastCacheTimestamp = now;

    res.header('Content-Type', 'application/xml');
    res.header('X-Sitemap-Cache', 'MISS');
    res.status(200).send(xml);
  } catch (error) {
    next(error);
  }
};

// GET /robots.txt
exports.getRobotsTxt = async (req, res, next) => {
  try {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const sitemapUrl = `${frontendUrl}/sitemap.xml`;

    let robots = 'User-agent: *\n';
    robots += 'Allow: /\n';
    
    // Disallow administrative & private endpoints
    robots += 'Disallow: /admin/\n';
    robots += 'Disallow: /api/\n';
    
    // Disallow indexing of filter/search duplicates (Duplicate Content Protection)
    robots += 'Disallow: /*?*search=\n';
    robots += 'Disallow: /*?*page=\n';
    robots += 'Disallow: /*?*category=\n';
    robots += 'Disallow: /*?*tag=\n';
    
    // Crawl rate-limiting for scraper bots to conserve resources
    robots += 'Crawl-delay: 1\n';
    robots += `Sitemap: ${sitemapUrl}\n`;

    res.header('Content-Type', 'text/plain');
    res.status(200).send(robots);
  } catch (error) {
    next(error);
  }
};
