const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const db = require('./db');

async function addColumnIfMissing(tableName, columnName, columnDefinition) {
  const [cols] = await db.query(`SHOW COLUMNS FROM ${tableName} LIKE ?`, [columnName]);
  if (cols.length === 0) {
    console.log(`Adding missing column "${columnName}" to table "${tableName}"...`);
    await db.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  }
}

async function seedAdminUser() {
  const [existing] = await db.query('SELECT id FROM users WHERE email = ?', ['admin@toolnest.com']);
  if (existing.length === 0) {
    console.log('Seeding default Admin User...');
    const bcrypt = require('bcryptjs');
    const salt = await bcrypt.genSalt(12);
    const hash = await bcrypt.hash('admin123', salt);
    await db.query(
      `INSERT INTO users (email, password_hash, full_name, role, is_verified) 
       VALUES (?, ?, ?, ?, ?)`,
      ['admin@toolnest.com', hash, 'Administrator', 'admin', true]
    );
    console.log('Admin user seeded (admin@toolnest.com / admin123).');
  }
}

async function seedCategoriesAndTags() {
  // Seed categories
  const categories = [
    { name: 'Technology', slug: 'technology', description: 'Latest news and updates in technology.' },
    { name: 'Productivity', slug: 'productivity', description: 'Tips and tricks to boost your daily workflow.' },
    { name: 'Design', slug: 'design', description: 'Creative guidelines, user experience, and visual design.' },
    { name: 'Development', slug: 'development', description: 'Software engineering, tutorials, and programming.' }
  ];

  for (const cat of categories) {
    await db.query(
      'INSERT IGNORE INTO categories (name, slug, description) VALUES (?, ?, ?)',
      [cat.name, cat.slug, cat.description]
    );
  }

  // Seed tags
  const tags = [
    { name: 'React', slug: 'react' },
    { name: 'NodeJS', slug: 'nodejs' },
    { name: 'SEO', slug: 'seo' },
    { name: 'Web Dev', slug: 'web-dev' },
    { name: 'Tutorial', slug: 'tutorial' }
  ];

  for (const tag of tags) {
    await db.query('INSERT IGNORE INTO tags (name, slug) VALUES (?, ?)', [tag.name, tag.slug]);
  }
  console.log('Default categories and tags seeded.');
}

async function runMigration() {
  try {
    console.log('Starting MySQL Schema Initialization...');
    const schemaPath = path.join(__dirname, 'schema.sql');
    
    if (!fs.existsSync(schemaPath)) {
      throw new Error(`Schema file not found at ${schemaPath}`);
    }

    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    // Clean inline and block comments to parse DDL accurately
    const cleanSql = schemaSql
      .replace(/\/\*[\s\S]*?\*\//g, '') // remove block comments
      .replace(/--.*(?:\r?\n|$)/g, '')   // remove line comments
      .trim();

    // Split statements on semicolon if followed by spacing/newlines
    const statements = cleanSql
      .split(/;[\s\r\n]*/)
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0);

    console.log(`Found ${statements.length} DDL statements to execute.`);

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      const snippet = statement.split('\n')[0].replace(/\s+/g, ' ').substring(0, 60);
      console.log(`Executing [${i + 1}/${statements.length}]: "${snippet}..."`);
      
      await db.query(statement);
    }

    console.log('Checking for missing blogs columns...');
    await addColumnIfMissing('blogs', 'canonical_url', 'VARCHAR(255) NULL');
    await addColumnIfMissing('blogs', 'og_title', 'VARCHAR(150) NULL');
    await addColumnIfMissing('blogs', 'og_description', 'VARCHAR(255) NULL');
    await addColumnIfMissing('blogs', 'og_image', 'VARCHAR(255) NULL');
    await addColumnIfMissing('blogs', 'twitter_title', 'VARCHAR(150) NULL');
    await addColumnIfMissing('blogs', 'twitter_description', 'VARCHAR(255) NULL');
    await addColumnIfMissing('blogs', 'twitter_image', 'VARCHAR(255) NULL');
    await addColumnIfMissing('blogs', 'reading_time', 'INT DEFAULT 0');
    await addColumnIfMissing('blogs', 'published_at', 'TIMESTAMP NULL DEFAULT NULL');

    console.log('Ensuring user permissions for AI tools are enabled for testing...');
    await db.query(
      "UPDATE role_permissions SET is_allowed = 1 WHERE role = 'user' AND permission IN ('image_remove_bg', 'image_ai_upscale')"
    );

    console.log('Database Schema Migration completed successfully.');

    // Seeding phase
    await seedAdminUser();
    await seedCategoriesAndTags();

    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
