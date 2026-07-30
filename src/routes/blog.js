const express = require('express');
const blogController = require('../controllers/blogController');
const authMiddleware = require('../middleware/auth');
const roleMiddleware = require('../middleware/role');
const imageUpload = require('../middleware/imageUpload');

const router = express.Router();

// --- Public Routes ---
router.get('/', blogController.getPublicBlogs);
router.get('/categories', blogController.getCategories);
router.get('/tags', blogController.getTags);
router.get('/:slug', blogController.getPublicBlogBySlug);

// --- Admin CMS Routes (Protected by Auth & Admin Role Check) ---
const adminGuards = [authMiddleware, roleMiddleware('admin')];

// Image Upload for Featured Photos
router.post('/admin/upload', adminGuards, imageUpload.single('file'), blogController.uploadFeaturedImage);

// Blogs CRUD
router.get('/admin/blogs', adminGuards, blogController.getAdminBlogs);
router.get('/admin/blogs/:id', adminGuards, blogController.getAdminBlogById);
router.post('/admin/blogs', adminGuards, blogController.createBlog);
router.put('/admin/blogs/:id', adminGuards, blogController.updateBlog);
router.delete('/admin/blogs/:id', adminGuards, blogController.deleteBlog);

// Blog Version Control Revisions CRUD
router.get('/admin/blogs/:id/revisions', adminGuards, blogController.getBlogRevisions);
router.post('/admin/blogs/:id/rollback/:revisionId', adminGuards, blogController.rollbackBlog);

// Categories CRUD
router.post('/admin/categories', adminGuards, blogController.createCategory);
router.put('/admin/categories/:id', adminGuards, blogController.updateCategory);
router.delete('/admin/categories/:id', adminGuards, blogController.deleteCategory);

// Tags CRUD
router.post('/admin/tags', adminGuards, blogController.createTag);
router.put('/admin/tags/:id', adminGuards, blogController.updateTag);
router.delete('/admin/tags/:id', adminGuards, blogController.deleteTag);

module.exports = router;
