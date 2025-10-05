const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || "db-secure",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "bismillah",
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on("connect", () => {
  console.log("✅ Database connected successfully");
});

pool.on("error", (err) => {
  console.error("❌ Unexpected database error:", err);
  process.exit(-1);
});

const testConnection = async () => {
  try {
    const client = await pool.connect();
    const res = await client.query("SELECT NOW()");
    console.log("🕒 Database time:", res.rows[0].now);
    client.release();
  } catch (err) {
    console.error("❌ Database connection failed:", err.message);
  }
};

if (require.main === module) {
  testConnection();
}

module.exports = pool;
