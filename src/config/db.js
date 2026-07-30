const mysql = require('mysql2/promise');

const poolConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'toolnest',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

// Enable SSL/TLS by default for known cloud databases (TiDB, Aiven, AWS RDS, Azure) or if DB_SSL is true
if (process.env.DB_SSL === 'true' || 
    (process.env.DB_HOST && 
     (process.env.DB_HOST.includes('tidbcloud.com') || 
      process.env.DB_HOST.includes('aivencloud.com') || 
      process.env.DB_HOST.includes('database.azure.com') ||
      process.env.DB_HOST.includes('rds.amazonaws.com')))) {
  poolConfig.ssl = {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true
  };
}

const pool = mysql.createPool(poolConfig);

module.exports = pool;

