-- ToolNest Production Database Schema
-- Character Set: utf8mb4 for full emoji & multilingual support
-- Storage Engine: InnoDB for transactions & foreign key integrity

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) DEFAULT 'user', -- 'user', 'premium', 'admin'
    is_verified BOOLEAN DEFAULT FALSE,
    verification_token VARCHAR(255) NULL,
    verification_token_expires TIMESTAMP NULL,
    reset_token VARCHAR(255) NULL,
    reset_token_expires TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_email (email),
    INDEX idx_user_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    refresh_token_hash VARCHAR(255) NOT NULL UNIQUE,
    ip_address VARCHAR(45) NULL, -- Supports IPv4 and IPv6
    user_agent VARCHAR(255) NULL,
    is_revoked BOOLEAN DEFAULT FALSE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_session_token (refresh_token_hash),
    INDEX idx_session_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tags (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    slug VARCHAR(50) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blogs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    author_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    content LONGTEXT NOT NULL,
    summary VARCHAR(500) NULL,
    featured_image VARCHAR(255) NULL,
    seo_title VARCHAR(150) NULL,
    seo_description VARCHAR(255) NULL,
    canonical_url VARCHAR(255) NULL,
    og_title VARCHAR(150) NULL,
    og_description VARCHAR(255) NULL,
    og_image VARCHAR(255) NULL,
    twitter_title VARCHAR(150) NULL,
    twitter_description VARCHAR(255) NULL,
    twitter_image VARCHAR(255) NULL,
    reading_time INT DEFAULT 0,
    status VARCHAR(20) DEFAULT 'draft', -- 'draft', 'published'
    published_at TIMESTAMP NULL DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE RESTRICT,
    INDEX idx_blog_slug (slug),
    INDEX idx_blog_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blog_categories (
    blog_id INT NOT NULL,
    category_id INT NOT NULL,
    PRIMARY KEY (blog_id, category_id),
    FOREIGN KEY (blog_id) REFERENCES blogs(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blog_tags (
    blog_id INT NOT NULL,
    tag_id INT NOT NULL,
    PRIMARY KEY (blog_id, tag_id),
    FOREIGN KEY (blog_id) REFERENCES blogs(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    stripe_customer_id VARCHAR(255) NULL,
    stripe_subscription_id VARCHAR(255) NULL UNIQUE,
    razorpay_subscription_id VARCHAR(255) NULL UNIQUE,
    plan_name VARCHAR(50) NOT NULL, -- 'free', 'basic', 'premium'
    status VARCHAR(50) NOT NULL, -- 'active', 'canceled', 'past_due', 'unpaid'
    current_period_start TIMESTAMP NULL,
    current_period_end TIMESTAMP NULL,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_subscription_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    subscription_id INT NULL,
    provider VARCHAR(50) NOT NULL, -- 'stripe', 'razorpay'
    transaction_id VARCHAR(255) NOT NULL UNIQUE,
    amount DECIMAL(10,2) NOT NULL,
    currency VARCHAR(10) NOT NULL,
    status VARCHAR(50) NOT NULL, -- 'succeeded', 'failed', 'pending'
    invoice_url VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL,
    INDEX idx_payment_transaction (transaction_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tools (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    slug VARCHAR(100) NOT NULL UNIQUE,
    description VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL, -- 'pdf', 'image', 'developer', 'calculators', 'text'
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'beta', 'inactive'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tool_slug (slug),
    INDEX idx_tool_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tool_usage (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL, -- NULL tracking for anonymous users
    tool_id INT NOT NULL,
    request_count INT DEFAULT 1,
    source VARCHAR(20) DEFAULT 'web', -- 'web', 'api'
    usage_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (tool_id) REFERENCES tools(id) ON DELETE CASCADE,
    UNIQUE KEY uq_user_tool_date (user_id, tool_id, usage_date, source),
    INDEX idx_usage_date (usage_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS api_keys (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    key_hash VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    monthly_limit INT DEFAULT 1000,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_api_key_hash (key_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activity_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    action VARCHAR(255) NOT NULL,
    ip_address VARCHAR(45) NULL,
    details TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_log_user (user_id),
    INDEX idx_log_action (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blog_revisions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    blog_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    content LONGTEXT NOT NULL,
    summary VARCHAR(500) NULL,
    updated_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (blog_id) REFERENCES blogs(id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_revision_blog (blog_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS url_redirects (
    id INT AUTO_INCREMENT PRIMARY KEY,
    source_path VARCHAR(255) NOT NULL UNIQUE,
    target_path VARCHAR(255) NOT NULL,
    status_code INT DEFAULT 301,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_redirect_source (source_path)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
    role VARCHAR(50) NOT NULL,
    permission VARCHAR(100) NOT NULL,
    is_allowed BOOLEAN DEFAULT TRUE,
    PRIMARY KEY (role, permission)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO role_permissions (role, permission, is_allowed) VALUES
('user', 'pdf_tools', 1),
('user', 'image_tools', 1),
('user', 'image_remove_bg', 0),
('user', 'image_ai_upscale', 0),
('user', 'blog_editor', 0),
('user', 'system_config', 0),

('premium', 'pdf_tools', 1),
('premium', 'image_tools', 1),
('premium', 'image_remove_bg', 1),
('premium', 'image_ai_upscale', 1),
('premium', 'blog_editor', 0),
('premium', 'system_config', 0),

('admin', 'pdf_tools', 1),
('admin', 'image_tools', 1),
('admin', 'image_remove_bg', 1),
('admin', 'image_ai_upscale', 1),
('admin', 'blog_editor', 1),
('admin', 'system_config', 1);

INSERT IGNORE INTO tools (name, slug, description, category, status) VALUES
('Merge PDF', 'pdf-merge', 'Combine multiple PDF files into a single document.', 'pdf', 'active'),
('Split PDF', 'pdf-split', 'Extract specific pages or separate a document into individual PDF parts.', 'pdf', 'active'),
('Compress PDF', 'pdf-compress', 'Reduce file size of your PDF while maintaining optimal resolution.', 'pdf', 'active'),
('Rotate PDF', 'pdf-rotate', 'Rotate PDF pages clockwise or counter-clockwise.', 'pdf', 'active'),
('Delete PDF Pages', 'pdf-delete-pages', 'Delete selected pages from PDF document.', 'pdf', 'active'),
('Extract PDF Pages', 'pdf-extract-pages', 'Extract selected pages from PDF document.', 'pdf', 'active'),
('Compress Image', 'image-compress', 'Reduce image file sizes locally in browser.', 'image', 'active'),
('Resize Image', 'image-resize', 'Resize image height and width dimension constraints.', 'image', 'active'),
('Crop Image', 'image-crop', 'Crop image dimensions with box overlays.', 'image', 'active'),
('Convert Image', 'image-convert', 'Convert images between multiple formats.', 'image', 'active'),
('Rotate Image', 'image-rotate', 'Rotate images clockwise or counter-clockwise.', 'image', 'active'),
('Watermark Image', 'image-watermark', 'Add text or logo overlays to photos.', 'image', 'active'),
('Remove Background', 'image-remove-bg', 'Strip background segment and create transparent PNG.', 'image', 'active'),
('AI Upscale', 'image-ai-upscale', 'Enlarge images using neural network interpolation.', 'image', 'active');


