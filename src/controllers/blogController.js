const db = require('../config/db');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// Helper: Slugify text
const slugify = (text) => {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-') // Replace spaces with -
    .replace(/[^\w\-]+/g, '') // Remove all non-word chars
    .replace(/\-\-+/g, '-') // Replace multiple - with single -
    .replace(/^-+/, '') // Trim - from start
    .replace(/-+$/, ''); // Trim - from end
};

// Helper: Secure HTML Sanitizer to prevent XSS injection
const sanitizeHtml = (html) => {
  if (!html) return '';
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Strip script blocks
    .replace(/on\w+\s*=\s*(['"][^'"]*['"]|[^\s>]+)/gi, '') // Strip event handlers
    .replace(/href\s*=\s*['"]\s*javascript:[^'"]*['"]/gi, '') // Strip javascript href links
    .replace(/<(object|embed|iframe|frame)[^>]*>[\s\S]*?<\/\1>/gi, '') // Strip object/iframe containers
    .replace(/<(object|embed|iframe|frame)[^>]*\/?>/gi, '');
};

// Helper: Make slug unique in database
const makeSlugUnique = async (slug, existingBlogId = null) => {
  let uniqueSlug = slugify(slug) || 'untitled-post';
  let counter = 1;
  let isUnique = false;

  while (!isUnique) {
    let query = 'SELECT id FROM blogs WHERE slug = ?';
    let params = [uniqueSlug];
    
    if (existingBlogId) {
      query += ' AND id != ?';
      params.push(existingBlogId);
    }

    const [rows] = await db.query(query, params);
    if (rows.length === 0) {
      isUnique = true;
    } else {
      uniqueSlug = `${slugify(slug)}-${counter}`;
      counter++;
    }
  }

  return uniqueSlug;
};

// Helper: Calculate Reading Time (WPM = 200)
const calculateReadingTime = (content) => {
  if (!content) return 0;
  const cleanText = content.replace(/<[^>]*>/g, ''); // strip HTML tags
  const wordCount = cleanText.trim().split(/\s+/).filter(w => w.length > 0).length;
  return Math.max(1, Math.ceil(wordCount / 200));
};

// --- Featured Image Upload ---
exports.uploadFeaturedImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'No image file uploaded.' });
    }

    const uploadsDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const filename = `featured-${Date.now()}.webp`;
    const filepath = path.join(uploadsDir, filename);

    // Sharp optimization: resize to 1200px width (high res for banners), convert to WebP with 80% quality
    await sharp(req.file.buffer)
      .resize({ width: 1200, withoutEnlargement: true })
      .toFormat('webp')
      .webp({ quality: 80 })
      .toFile(filepath);

    const imageUrl = `/uploads/${filename}`;
    res.status(200).json({
      status: 'success',
      imageUrl
    });
  } catch (error) {
    next(error);
  }
};

// --- Public Endpoints ---

// GET /api/v1/blogs
exports.getPublicBlogs = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 6;
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search}%` : null;
    const categorySlug = req.query.category || null;
    const tagSlug = req.query.tag || null;

    let baseQuery = `
      FROM blogs b
      JOIN users u ON b.author_id = u.id
      WHERE b.status = 'published' AND (b.published_at IS NULL OR b.published_at <= NOW())
    `;
    const queryParams = [];

    if (search) {
      baseQuery += ' AND (b.title LIKE ? OR b.summary LIKE ? OR b.content LIKE ?)';
      queryParams.push(search, search, search);
    }

    if (categorySlug) {
      baseQuery += ' AND b.id IN (SELECT blog_id FROM blog_categories bc JOIN categories c ON bc.category_id = c.id WHERE c.slug = ?)';
      queryParams.push(categorySlug);
    }

    if (tagSlug) {
      baseQuery += ' AND b.id IN (SELECT blog_id FROM blog_tags bt JOIN tags t ON bt.tag_id = t.id WHERE t.slug = ?)';
      queryParams.push(tagSlug);
    }

    // Get total count
    const [countResult] = await db.query(`SELECT COUNT(DISTINCT b.id) as total ${baseQuery}`, queryParams);
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    // Get matching blog items with author name and dynamic categories
    let selectQuery = `
      SELECT b.id, b.title, b.slug, b.summary, b.featured_image, b.reading_time, b.published_at, b.created_at,
             u.full_name as author_name
      ${baseQuery}
      ORDER BY COALESCE(b.published_at, b.created_at) DESC
      LIMIT ? OFFSET ?
    `;
    queryParams.push(limit, offset);

    const [blogs] = await db.query(selectQuery, queryParams);

    // Fetch categories and tags for each blog post to return complete relationship object
    for (const blog of blogs) {
      const [categories] = await db.query(
        'SELECT c.id, c.name, c.slug FROM categories c JOIN blog_categories bc ON c.id = bc.category_id WHERE bc.blog_id = ?',
        [blog.id]
      );
      const [tags] = await db.query(
        'SELECT t.id, t.name, t.slug FROM tags t JOIN blog_tags bt ON t.id = bt.tag_id WHERE bt.blog_id = ?',
        [blog.id]
      );
      blog.categories = categories;
      blog.tags = tags;
    }

    res.status(200).json({
      status: 'success',
      data: {
        blogs,
        pagination: {
          currentPage: page,
          limit,
          totalItems,
          totalPages
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/blogs/:slug
exports.getPublicBlogBySlug = async (req, res, next) => {
  try {
    const { slug } = req.params;

    const [blogs] = await db.query(
      `SELECT b.*, u.full_name as author_name, u.email as author_email
       FROM blogs b
       JOIN users u ON b.author_id = u.id
       WHERE b.slug = ?`,
      [slug]
    );

    if (blogs.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Blog post not found.' });
    }

    const blog = blogs[0];

    // Status check for non-admin requests
    const isFutureScheduled = blog.published_at && new Date(blog.published_at) > new Date();
    if (blog.status !== 'published' || isFutureScheduled) {
      return res.status(404).json({ status: 'error', message: 'Blog post is not available.' });
    }

    // Fetch categories & tags
    const [categories] = await db.query(
      'SELECT c.id, c.name, c.slug FROM categories c JOIN blog_categories bc ON c.id = bc.category_id WHERE bc.blog_id = ?',
      [blog.id]
    );
    const [tags] = await db.query(
      'SELECT t.id, t.name, t.slug FROM tags t JOIN blog_tags bt ON t.id = bt.tag_id WHERE bt.blog_id = ?',
      [blog.id]
    );

    blog.categories = categories;
    blog.tags = tags;

    res.status(200).json({
      status: 'success',
      data: blog
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/categories
exports.getCategories = async (req, res, next) => {
  try {
    const [categories] = await db.query('SELECT * FROM categories ORDER BY name ASC');
    res.status(200).json({ status: 'success', data: categories });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/tags
exports.getTags = async (req, res, next) => {
  try {
    const [tags] = await db.query('SELECT * FROM tags ORDER BY name ASC');
    res.status(200).json({ status: 'success', data: tags });
  } catch (error) {
    next(error);
  }
};


// --- Admin Endpoints ---

// GET /api/v1/admin/blogs
exports.getAdminBlogs = async (req, res, next) => {
  try {
    const [blogs] = await db.query(
      `SELECT b.id, b.title, b.slug, b.status, b.published_at, b.created_at, b.featured_image,
              u.full_name as author_name
       FROM blogs b
       JOIN users u ON b.author_id = u.id
       ORDER BY b.created_at DESC`
    );

    for (const blog of blogs) {
      const [categories] = await db.query(
        'SELECT c.id, c.name, c.slug FROM categories c JOIN blog_categories bc ON c.id = bc.category_id WHERE bc.blog_id = ?',
        [blog.id]
      );
      const [tags] = await db.query(
        'SELECT t.id, t.name, t.slug FROM tags t JOIN blog_tags bt ON t.id = bt.tag_id WHERE bt.blog_id = ?',
        [blog.id]
      );
      blog.categories = categories;
      blog.tags = tags;
    }

    res.status(200).json({ status: 'success', data: blogs });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/admin/blogs/:id
exports.getAdminBlogById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [blogs] = await db.query('SELECT * FROM blogs WHERE id = ?', [id]);
    
    if (blogs.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Blog post not found.' });
    }

    const blog = blogs[0];

    const [categories] = await db.query(
      'SELECT category_id FROM blog_categories WHERE blog_id = ?',
      [id]
    );
    const [tags] = await db.query(
      'SELECT tag_id FROM blog_tags WHERE blog_id = ?',
      [id]
    );

    blog.categoryIds = categories.map(c => c.category_id);
    blog.tagIds = tags.map(t => t.tag_id);

    res.status(200).json({ status: 'success', data: blog });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/admin/blogs
exports.createBlog = async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const {
      title,
      content,
      summary,
      featuredImage,
      slug,
      seoTitle,
      seoDescription,
      canonicalUrl,
      ogTitle,
      ogDescription,
      ogImage,
      twitterTitle,
      twitterDescription,
      twitterImage,
      status,
      publishedAt,
      categoryIds,
      tagIds
    } = req.body;

    if (!title || !content) {
      return res.status(400).json({ status: 'error', message: 'Title and content are required.' });
    }

    const cleanTitle = title.trim();
    const cleanContent = sanitizeHtml(content);
    const cleanSummary = summary ? summary.trim() : null;

    const finalSlug = await makeSlugUnique(slug || cleanTitle);
    const readingTime = calculateReadingTime(cleanContent);
    const authorId = req.user.id;

    // Check duplicate canonical content
    if (canonicalUrl) {
      const [duplicate] = await connection.query(
        'SELECT id, title FROM blogs WHERE canonical_url = ?',
        [canonicalUrl]
      );
      if (duplicate.length > 0) {
        return res.status(409).json({
          status: 'error',
          message: `Duplicate content warning: Canonical URL is already claimed by article "${duplicate[0].title}".`
        });
      }
    }

    // Evaluate scheduled status: if status is 'published' but publishedAt is in the future
    let finalStatus = status || 'draft';
    const cleanPublishedAt = publishedAt ? new Date(publishedAt) : null;
    if (finalStatus === 'published' && cleanPublishedAt && cleanPublishedAt > new Date()) {
      finalStatus = 'scheduled';
    }

    // Insert blog post
    const [result] = await connection.query(
      `INSERT INTO blogs (
        author_id, title, slug, content, summary, featured_image,
        seo_title, seo_description, canonical_url,
        og_title, og_description, og_image,
        twitter_title, twitter_description, twitter_image,
        reading_time, status, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        authorId, cleanTitle, finalSlug, cleanContent, cleanSummary, featuredImage || null,
        seoTitle || null, seoDescription || null, canonicalUrl || null,
        ogTitle || null, ogDescription || null, ogImage || null,
        twitterTitle || null, twitterDescription || null, twitterImage || null,
        readingTime, finalStatus, cleanPublishedAt
      ]
    );

    const blogId = result.insertId;

    // Relate categories
    if (categoryIds && Array.isArray(categoryIds)) {
      for (const catId of categoryIds) {
        await connection.query(
          'INSERT INTO blog_categories (blog_id, category_id) VALUES (?, ?)',
          [blogId, catId]
        );
      }
    }

    // Relate tags
    if (tagIds && Array.isArray(tagIds)) {
      for (const tId of tagIds) {
        await connection.query(
          'INSERT INTO blog_tags (blog_id, tag_id) VALUES (?, ?)',
          [blogId, tId]
        );
      }
    }

    await connection.commit();
    res.status(201).json({ status: 'success', message: 'Blog post created successfully.', data: { id: blogId, slug: finalSlug } });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
};

// PUT /api/v1/admin/blogs/:id
exports.updateBlog = async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const { id } = req.params;

    const [existing] = await connection.query('SELECT title, content, summary FROM blogs WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Blog post not found.' });
    }

    const {
      title,
      content,
      summary,
      featuredImage,
      slug,
      seoTitle,
      seoDescription,
      canonicalUrl,
      ogTitle,
      ogDescription,
      ogImage,
      twitterTitle,
      twitterDescription,
      twitterImage,
      status,
      publishedAt,
      categoryIds,
      tagIds
    } = req.body;

    if (!title || !content) {
      return res.status(400).json({ status: 'error', message: 'Title and content are required.' });
    }

    // Save previous snapshot version to revisions list
    await connection.query(
      'INSERT INTO blog_revisions (blog_id, title, content, summary, updated_by) VALUES (?, ?, ?, ?, ?)',
      [id, existing[0].title, existing[0].content, existing[0].summary || null, req.user.id]
    );

    const cleanTitle = title.trim();
    const cleanContent = sanitizeHtml(content);
    const cleanSummary = summary ? summary.trim() : null;

    const finalSlug = await makeSlugUnique(slug || cleanTitle, id);
    const readingTime = calculateReadingTime(cleanContent);

    // Check duplicate canonical content
    if (canonicalUrl) {
      const [duplicate] = await connection.query(
        'SELECT id, title FROM blogs WHERE canonical_url = ? AND id != ?',
        [canonicalUrl, id]
      );
      if (duplicate.length > 0) {
        return res.status(409).json({
          status: 'error',
          message: `Duplicate content warning: Canonical URL is already claimed by article "${duplicate[0].title}".`
        });
      }
    }

    // Evaluate scheduled status: if status is 'published' but publishedAt is in the future
    let finalStatus = status;
    const cleanPublishedAt = publishedAt ? new Date(publishedAt) : null;
    if (finalStatus === 'published' && cleanPublishedAt && cleanPublishedAt > new Date()) {
      finalStatus = 'scheduled';
    }

    // Update blog
    await connection.query(
      `UPDATE blogs SET
        title = ?, slug = ?, content = ?, summary = ?, featured_image = ?,
        seo_title = ?, seo_description = ?, canonical_url = ?,
        og_title = ?, og_description = ?, og_image = ?,
        twitter_title = ?, twitter_description = ?, twitter_image = ?,
        reading_time = ?, status = ?, published_at = ?
      WHERE id = ?`,
      [
        cleanTitle, finalSlug, cleanContent, cleanSummary, featuredImage || null,
        seoTitle || null, seoDescription || null, canonicalUrl || null,
        ogTitle || null, ogDescription || null, ogImage || null,
        twitterTitle || null, twitterDescription || null, twitterImage || null,
        readingTime, finalStatus, cleanPublishedAt,
        id
      ]
    );

    // Sync categories
    await connection.query('DELETE FROM blog_categories WHERE blog_id = ?', [id]);
    if (categoryIds && Array.isArray(categoryIds)) {
      for (const catId of categoryIds) {
        await connection.query(
          'INSERT INTO blog_categories (blog_id, category_id) VALUES (?, ?)',
          [id, catId]
        );
      }
    }

    // Sync tags
    await connection.query('DELETE FROM blog_tags WHERE blog_id = ?', [id]);
    if (tagIds && Array.isArray(tagIds)) {
      for (const tId of tagIds) {
        await connection.query(
          'INSERT INTO blog_tags (blog_id, tag_id) VALUES (?, ?)',
          [id, tId]
        );
      }
    }

    await connection.commit();
    res.status(200).json({ status: 'success', message: 'Blog post updated successfully.' });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
};

// DELETE /api/v1/admin/blogs/:id
exports.deleteBlog = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [result] = await db.query('DELETE FROM blogs WHERE id = ?', [id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: 'Blog post not found.' });
    }

    res.status(200).json({ status: 'success', message: 'Blog post deleted successfully.' });
  } catch (error) {
    next(error);
  }
};

// --- Categories Admin CRUD ---

exports.createCategory = async (req, res, next) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ status: 'error', message: 'Category name is required.' });
    }
    const slug = slugify(name);
    await db.query(
      'INSERT INTO categories (name, slug, description) VALUES (?, ?, ?)',
      [name, slug, description || null]
    );
    res.status(201).json({ status: 'success', message: 'Category created successfully.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ status: 'error', message: 'A category with this name or slug already exists.' });
    }
    next(error);
  }
};

exports.updateCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ status: 'error', message: 'Category name is required.' });
    }
    const slug = slugify(name);
    const [result] = await db.query(
      'UPDATE categories SET name = ?, slug = ?, description = ? WHERE id = ?',
      [name, slug, description || null, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: 'Category not found.' });
    }
    res.status(200).json({ status: 'success', message: 'Category updated successfully.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ status: 'error', message: 'A category with this name or slug already exists.' });
    }
    next(error);
  }
};

exports.deleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [result] = await db.query('DELETE FROM categories WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: 'Category not found.' });
    }
    res.status(200).json({ status: 'success', message: 'Category deleted successfully.' });
  } catch (error) {
    next(error);
  }
};

// --- Tags Admin CRUD ---

exports.createTag = async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ status: 'error', message: 'Tag name is required.' });
    }
    const slug = slugify(name);
    await db.query('INSERT INTO tags (name, slug) VALUES (?, ?)', [name, slug]);
    res.status(201).json({ status: 'success', message: 'Tag created successfully.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ status: 'error', message: 'A tag with this name or slug already exists.' });
    }
    next(error);
  }
};

exports.updateTag = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ status: 'error', message: 'Tag name is required.' });
    }
    const slug = slugify(name);
    const [result] = await db.query('UPDATE tags SET name = ?, slug = ? WHERE id = ?', [name, slug, id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: 'Tag not found.' });
    }
    res.status(200).json({ status: 'success', message: 'Tag updated successfully.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ status: 'error', message: 'A tag with this name or slug already exists.' });
    }
    next(error);
  }
};

exports.deleteTag = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [result] = await db.query('DELETE FROM tags WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ status: 'error', message: 'Tag not found.' });
    }
    res.status(200).json({ status: 'success', message: 'Tag deleted successfully.' });
  } catch (error) {
    next(error);
  }
};

// GET /api/v1/admin/blogs/:id/revisions
exports.getBlogRevisions = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [revisions] = await db.query(
      `SELECT r.*, u.full_name as author_name 
       FROM blog_revisions r
       JOIN users u ON r.updated_by = u.id
       WHERE r.blog_id = ?
       ORDER BY r.created_at DESC`,
      [id]
    );
    res.status(200).json({ status: 'success', data: revisions });
  } catch (error) {
    next(error);
  }
};

// POST /api/v1/admin/blogs/:id/rollback/:revisionId
exports.rollbackBlog = async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const { id, revisionId } = req.params;

    // Check if blog exists
    const [blogs] = await connection.query('SELECT id, title, content, summary FROM blogs WHERE id = ?', [id]);
    if (blogs.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Blog post not found.' });
    }

    // Fetch revision details
    const [revisions] = await connection.query('SELECT * FROM blog_revisions WHERE id = ? AND blog_id = ?', [revisionId, id]);
    if (revisions.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Revision snapshot not found.' });
    }

    const rev = revisions[0];

    // Snapshot current state in revisions before rolling back so rollback is undoable!
    await connection.query(
      'INSERT INTO blog_revisions (blog_id, title, content, summary, updated_by) VALUES (?, ?, ?, ?, ?)',
      [id, blogs[0].title, blogs[0].content, blogs[0].summary || null, req.user.id]
    );

    // Update blog to rollbacked values
    const readingTime = calculateReadingTime(rev.content);
    await connection.query(
      'UPDATE blogs SET title = ?, content = ?, summary = ?, reading_time = ? WHERE id = ?',
      [rev.title, rev.content, rev.summary || null, readingTime, id]
    );

    await connection.commit();
    res.status(200).json({ status: 'success', message: 'Blog post rolled back successfully.', data: { title: rev.title, content: rev.content } });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
};
