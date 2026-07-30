const db = require('../config/db');

/**
 * Periodically transition scheduled posts to published state
 * when their target published_at date is reached.
 */
function startScheduler() {
  console.log('[Scheduler] Background publishing daemon service initialized.');
  
  // Scan every 60 seconds
  const intervalId = setInterval(async () => {
    try {
      const [result] = await db.query(
        "UPDATE blogs SET status = 'published' WHERE status = 'scheduled' AND published_at <= NOW()"
      );
      if (result.affectedRows > 0) {
        console.log(`[Scheduler] Automatically published ${result.affectedRows} scheduled post(s).`);
      }
    } catch (err) {
      console.error('[Scheduler Error] Daemon database update check crashed:', err.message);
    }
  }, 60000);

  return intervalId;
}

module.exports = { startScheduler };
