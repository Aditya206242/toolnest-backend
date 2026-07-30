require('dotenv').config();
const db = require('./src/config/db');

async function test() {
  try {
    const [blogsCols] = await db.query('DESCRIBE blogs');
    console.log('blogs columns:');
    console.table(blogsCols);

    const [users] = await db.query('SELECT id, email, role, full_name FROM users');
    console.log('Users:');
    console.table(users);

    process.exit(0);
  } catch (err) {
    console.error('DB test error:', err);
    process.exit(1);
  }
}
test();
