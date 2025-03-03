const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // Bắt buộc nếu Railway yêu cầu SSL
  },
});

// Hàm tạo bảng
async function createTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        contact TEXT NOT NULL UNIQUE,
        item TEXT DEFAULT 'Khách hàng mới',
        start_date TEXT DEFAULT '',
        expiry_date TEXT DEFAULT ''
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS warehouse (
        id SERIAL PRIMARY KEY,
        item TEXT NOT NULL,
        info TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        account_info TEXT DEFAULT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS customer_items (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        start_date TEXT NOT NULL,
        expiry_date TEXT NOT NULL,
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (item_id) REFERENCES warehouse(id)
      );
    `);

    console.log("✅ Tạo bảng thành công!");
  } catch (err) {
    console.error("❌ Lỗi tạo bảng:", err);
  } finally {
    pool.end();
  }
}

// Chạy hàm tạo bảng
createTables();
