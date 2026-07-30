const dotenv = require("dotenv");
dotenv.config();

const app = require("./src/app");
const db = require("./src/config/db");
const { startScheduler } = require("./src/services/scheduler");

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    const connection = await db.getConnection();
    console.log("Database connected successfully.");
    connection.release();

    // Start scheduled posts background publishing daemon
    startScheduler();

    app.listen(PORT, () => {
      console.log(
        `Server running in ${process.env.NODE_ENV || "development"} mode on port ${PORT}`
      );
    });
  } catch (error) {
    console.error("Database connection failed:", error);
    process.exit(1);
  }
}

startServer();