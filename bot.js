const TelegramBot = require("node-telegram-bot-api");
const sqlite3 = require("sqlite3").verbose();

// Thay token bot của bạn vào đây
const TOKEN = "7733831697:AAGSddOxoMeEm12LoxRd3t8ubLM6EnyUf78";
const bot = new TelegramBot(TOKEN, { polling: true });

// Kết nối SQLite Database
const db = new sqlite3.Database("./database.db");

// Tạo bảng nếu chưa có
db.run(`CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact TEXT NOT NULL UNIQUE,
    item TEXT DEFAULT 'Khách hàng mới',
    start_date TEXT DEFAULT '',
    expiry_date TEXT DEFAULT ''
)`);

db.run(`CREATE TABLE IF NOT EXISTS warehouse (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item TEXT NOT NULL,
    info TEXT NOT NULL,
    quantity INTEGER NOT NULL,
	account_info TEXT DEFAULT NULL
)`);

db.run(`CREATE TABLE IF NOT EXISTS customer_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (item_id) REFERENCES warehouse(id)
)`);

// Lệnh thêm khách hàng
bot.onText(/\/addkh (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const contact = match[1].trim();

    try {
        console.log(`➕ Đang thêm khách hàng: ${contact}`);
        await new Promise((resolve, reject) => {
            db.run("INSERT INTO customers (contact) VALUES (?)", [contact], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        bot.sendMessage(chatId, `✅ Đã thêm khách hàng mới: ${contact}`);
    } catch (error) {
        console.error("❌ Lỗi khi thêm khách hàng:", error);
        bot.sendMessage(chatId, "❌ Lỗi khi thêm khách hàng. Có thể khách hàng đã tồn tại.");
    }
});

// Lệnh lấy hàng hóa cho khách hàng, kiểm tra và cập nhật thời gian thuê
bot.onText(/\/gethh (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const itemId = parseInt(match[1], 10);

    try {
        console.log(`🔍 Kiểm tra mặt hàng ID: ${itemId}`);
        const itemRow = await new Promise((resolve, reject) => {
            db.get("SELECT item, quantity FROM warehouse WHERE id = ?", [itemId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!itemRow || itemRow.quantity <= 0) {
            bot.sendMessage(chatId, "🚫 Mặt hàng này không còn trong kho.");
            return;
        }

        console.log("📜 Đang lấy danh sách khách hàng");
        const customers = await new Promise((resolve, reject) => {
            db.all("SELECT id, contact FROM customers", [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        if (customers.length === 0) {
            bot.sendMessage(chatId, "🚫 Không có khách hàng nào trong hệ thống. Hãy thêm khách hàng bằng lệnh /addkh.");
            return;
        }

        let response = `📜 Chọn khách hàng để nhận hàng hóa (${itemRow.item}):\n`;
        customers.forEach((row) => {
            response += `ID: ${row.id} | ${row.contact}\n`;
        });
        response += "\nGửi ID khách hàng muốn nhận hàng.";

        const responseMsg = await bot.sendMessage(chatId, response);
        const customerResponse = await new Promise((resolve) => {
            bot.once("message", resolve);
        });
        const customerId = parseInt(customerResponse.text, 10);
        if (isNaN(customerId)) {
            bot.sendMessage(chatId, "❌ ID khách hàng không hợp lệ.");
            return;
        }

        console.log(`✅ Khách hàng ID: ${customerId} được chọn`);
        await bot.sendMessage(chatId, "Nhập số tháng thuê bao:");
        const monthResponse = await new Promise((resolve) => {
            bot.once("message", resolve);
        });
        const months = parseInt(monthResponse.text, 10);
        if (isNaN(months) || months <= 0) {
            bot.sendMessage(chatId, "❌ Số tháng không hợp lệ.");
            return;
        }

        console.log(`📆 Thời gian thuê: ${months} tháng`);
        const startDate = new Date().toISOString().split("T")[0];
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + months * 30);
        const expiryDateStr = expiryDate.toISOString().split("T")[0];

        console.log("🔎 Kiểm tra đơn hàng trước đó");
        const existingRow = await new Promise((resolve, reject) => {
            db.get("SELECT id, expiry_date FROM customer_items WHERE customer_id = ? AND item_id = ?", [customerId, itemId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (existingRow) {
            console.log("🔄 Cộng dồn thời gian thuê");
            let newExpiryDate = new Date(existingRow.expiry_date);
            newExpiryDate.setDate(newExpiryDate.getDate() + months * 30);
            const newExpiryDateStr = newExpiryDate.toISOString().split("T")[0];
            await new Promise((resolve, reject) => {
                db.run("UPDATE customer_items SET expiry_date = ? WHERE id = ?", [newExpiryDateStr, existingRow.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            bot.sendMessage(chatId, `✅ Đã cộng dồn thời gian thuê mặt hàng ID ${itemId} cho khách hàng ID ${customerId}. Hạn mới: ${newExpiryDateStr}.`);
        } else {
            console.log("➕ Thêm đơn hàng mới");
            await new Promise((resolve, reject) => {
                db.run("INSERT INTO customer_items (customer_id, item_id, start_date, expiry_date) VALUES (?, ?, ?, ?)",
                    [customerId, itemId, startDate, expiryDateStr],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
            bot.sendMessage(chatId, `✅ Khách hàng ID ${customerId} đã nhận mặt hàng ID ${itemId}, thuê trong ${months} tháng. Kho đã cập nhật.`);
        }

        console.log("📉 Trừ 1 sản phẩm trong kho");
        await new Promise((resolve, reject) => {
            db.run("UPDATE warehouse SET quantity = quantity - 1 WHERE id = ?", [itemId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        console.log("✅ Xử lý hoàn tất");
    } catch (error) {
        console.error("❌ LỖI: ", error);
        bot.sendMessage(chatId, "❌ Đã xảy ra lỗi khi xử lý yêu cầu.");
    }
});


// Lệnh kiểm tra danh sách khách hàng và trạng thái thuê hàng
bot.onText(/\/list/, async (msg) => {
    const chatId = msg.chat.id;

    try {
        console.log("📋 Đang lấy danh sách khách hàng...");
        const customers = await new Promise((resolve, reject) => {
            db.all(`SELECT c.id, c.contact, COALESCE(w.item, 'Chưa thuê hàng') AS item, ci.expiry_date 
                    FROM customers c 
                    LEFT JOIN customer_items ci ON c.id = ci.customer_id 
                    LEFT JOIN warehouse w ON ci.item_id = w.id`, 
                [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        if (customers.length === 0) {
            bot.sendMessage(chatId, "🚫 Không có khách hàng nào trong hệ thống.");
            return;
        }

        let response = "📜 Danh sách khách hàng:\n";
        customers.forEach((row) => {
            if (row.expiry_date) {
                // Tính số ngày còn lại
                const today = new Date();
                const expiryDate = new Date(row.expiry_date);
                const daysLeft = Math.max(Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24)), 0);
                response += `ID: ${row.id} | ${row.contact} | ${row.item} | Còn lại: ${daysLeft} ngày\n`;
            } else {
                response += `ID: ${row.id} | ${row.contact} | Khách hàng mới\n`;
            }
        });
        bot.sendMessage(chatId, response);
    } catch (error) {
        console.error("❌ Lỗi khi lấy danh sách khách hàng:", error);
        bot.sendMessage(chatId, "❌ Lỗi khi lấy danh sách khách hàng.");
    }
});

// Lệnh chỉnh sửa số lượng hàng trong kho
bot.onText(/\/edithh (\d+) ([+-]\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const itemId = parseInt(match[1], 10);
    const quantityChange = parseInt(match[2], 10);

    try {
        console.log(`🛠 Chỉnh sửa số lượng hàng ID: ${itemId}, Thay đổi: ${quantityChange} sản phẩm`);
        
        const updatedRows = await new Promise((resolve, reject) => {
            db.run("UPDATE warehouse SET quantity = quantity + ? WHERE id = ?", 
                [quantityChange, itemId], function (err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });

        if (updatedRows > 0) {
            bot.sendMessage(chatId, `✅ Đã cập nhật số lượng hàng ID ${itemId} ${quantityChange > 0 ? 'thêm' : 'giảm'} ${Math.abs(quantityChange)} sản phẩm.`);
        } else {
            bot.sendMessage(chatId, "🚫 Không tìm thấy mặt hàng trong kho.");
        }
    } catch (error) {
        console.error("❌ Lỗi khi chỉnh sửa số lượng hàng:", error);
        bot.sendMessage(chatId, "❌ Lỗi khi chỉnh sửa số lượng hàng.");
    }
});

// Lệnh thêm hàng vào kho
bot.onText(/\/addkho (.+) \| (.+) \| (\d+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const item = match[1].trim();
    const info = match[2].trim();
    const quantity = parseInt(match[3], 10);

    db.get("SELECT id, quantity FROM warehouse WHERE item = ? AND info = ?", [item, info], (err, row) => {
        if (err) {
            bot.sendMessage(chatId, "❌ Lỗi database khi kiểm tra kho hàng.");
            console.error(err);
            return;
        }
        if (row) {
            // Nếu trùng mặt hàng và thông tin, cập nhật số lượng
            const newQuantity = row.quantity + quantity;
            db.run("UPDATE warehouse SET quantity = ? WHERE id = ?", [newQuantity, row.id], (updateErr) => {
                if (updateErr) {
                    bot.sendMessage(chatId, "❌ Lỗi khi cập nhật kho hàng.");
                    console.error(updateErr);
                    return;
                }
                bot.sendMessage(chatId, `✅ Đã cập nhật số lượng ${item} (${info}) lên ${newQuantity} sản phẩm.`);
            });
        } else {
            // Nếu khác thông tin, thêm mới vào kho
            db.run("INSERT INTO warehouse (item, info, quantity) VALUES (?, ?, ?)", [item, info, quantity], (insertErr) => {
                if (insertErr) {
                    bot.sendMessage(chatId, "❌ Lỗi khi thêm hàng vào kho.");
                    console.error(insertErr);
                    return;
                }
                bot.sendMessage(chatId, `✅ Đã thêm ${quantity} ${item} (${info}) vào kho.`);
            });
        }
    });
});

// Lệnh kiểm tra kho hàng tổng hợp
bot.onText(/\/kho$/, (msg) => {
    db.all("SELECT item, SUM(quantity) as total FROM warehouse GROUP BY item", [], (err, rows) => {
        if (err) {
            bot.sendMessage(msg.chat.id, "❌ Lỗi database khi lấy danh sách kho hàng.");
            console.error(err);
            return;
        }
        if (rows.length === 0) {
            bot.sendMessage(msg.chat.id, "🚫 Kho trống.");
            return;
        }
        let response = "📦 Kho hàng:\n";
        rows.forEach((row) => {
            response += `${row.item}: ${row.total} sản phẩm\n`;
        });
        bot.sendMessage(msg.chat.id, response);
    });
});

// Lệnh kiểm tra chi tiết kho hàng theo mặt hàng cụ thể
bot.onText(/\/kho (.+)/, (msg, match) => {
    const chatId = msg.chat.id;
    const item = match[1].trim();

    db.all("SELECT id, info, quantity FROM warehouse WHERE item = ?", [item], (err, rows) => {
        if (err) {
            bot.sendMessage(chatId, "❌ Lỗi database khi lấy thông tin kho hàng.");
            console.error(err);
            return;
        }
        if (rows.length === 0) {
            bot.sendMessage(chatId, `🚫 Không có mặt hàng nào trong kho với tên: ${item}.`);
            return;
        }
        let response = `📦 Chi tiết kho hàng cho ${item}:\n`;
        rows.forEach((row) => {
            response += `ID: ${row.id} | ${row.info} | ${row.quantity} sản phẩm\n`;
        });
        bot.sendMessage(chatId, response);
    });
});

// Lệnh kiểm tra danh sách ID hàng hóa
bot.onText(/\/idhh/, (msg) => {
    db.all("SELECT id, item, info, quantity FROM warehouse", [], (err, rows) => {
        if (err) {
            bot.sendMessage(msg.chat.id, "❌ Lỗi database khi lấy danh sách hàng hóa.");
            console.error(err);
            return;
        }
        if (rows.length === 0) {
            bot.sendMessage(msg.chat.id, "🚫 Không có hàng hóa nào trong kho.");
            return;
        }
        let response = "📦 Danh sách ID hàng hóa:\n";
        rows.forEach((row) => {
            response += `ID: ${row.id} | ${row.item} (${row.info}) | Số lượng: ${row.quantity}\n`;
        });
        bot.sendMessage(msg.chat.id, response);
    });
});

// Lệnh cập nhật tài khoản/mật khẩu của mặt hàng
bot.onText(/\/updatehh (\d+)\s*\|?\s*(.*)?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const itemId = parseInt(match[1], 10);
    const accountInfo = match[2] ? match[2].trim() : null;

    if (!accountInfo) {
        bot.sendMessage(chatId, "⚠️ Bạn chưa nhập thông tin tài khoản/mật khẩu. Nếu không muốn thay đổi, hãy để trống.");
        return;
    }

    try {
        console.log(`🔄 Đang cập nhật thông tin cho mặt hàng ID: ${itemId}`);
        
        const updatedRows = await new Promise((resolve, reject) => {
            db.run("UPDATE warehouse SET account_info = ? WHERE id = ?", 
                [accountInfo, itemId], function (err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });

        if (updatedRows > 0) {
            bot.sendMessage(chatId, `✅ Đã cập nhật thông tin tài khoản/mật khẩu cho mặt hàng ID ${itemId}.`);
        } else {
            bot.sendMessage(chatId, "🚫 Không tìm thấy mặt hàng trong kho.");
        }
    } catch (error) {
        console.error("❌ Lỗi khi cập nhật thông tin mặt hàng:", error);
        bot.sendMessage(chatId, "❌ Lỗi khi cập nhật thông tin mặt hàng.");
    }
});

// Lệnh kiểm tra thông tin tài khoản/mật khẩu của mặt hàng
bot.onText(/\/infohh (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const itemId = parseInt(match[1], 10);

    try {
        console.log(`🔍 Kiểm tra thông tin tài khoản/mật khẩu của mặt hàng ID: ${itemId}`);
        
        const itemInfo = await new Promise((resolve, reject) => {
            db.get("SELECT item, account_info FROM warehouse WHERE id = ?", [itemId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (itemInfo) {
            const accountInfo = itemInfo.account_info ? itemInfo.account_info : "🚫 Chưa có thông tin tài khoản/mật khẩu.";
            bot.sendMessage(chatId, `📜 **Thông tin mặt hàng:**\n🆔 ID: ${itemId}\n📦 Tên: ${itemInfo.item}\n🔑 Tài khoản: ${accountInfo}`);
        } else {
            bot.sendMessage(chatId, "🚫 Không tìm thấy mặt hàng trong kho.");
        }
    } catch (error) {
        console.error("❌ Lỗi khi lấy thông tin mặt hàng:", error);
        bot.sendMessage(chatId, "❌ Lỗi khi lấy thông tin mặt hàng.");
    }
});

// Lệnh xóa khách hàng
bot.onText(/\/removekh (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const customerId = parseInt(match[1], 10);

    try {
        console.log(`🗑 Xóa khách hàng ID: ${customerId}`);
        
        // Xóa khách hàng khỏi bảng customer_items trước
        await new Promise((resolve, reject) => {
            db.run("DELETE FROM customer_items WHERE customer_id = ?", [customerId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Xóa khách hàng khỏi bảng customers
        const deletedRows = await new Promise((resolve, reject) => {
            db.run("DELETE FROM customers WHERE id = ?", [customerId], function (err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });

        if (deletedRows > 0) {
            bot.sendMessage(chatId, `✅ Đã xóa khách hàng ID ${customerId}.`);
        } else {
            bot.sendMessage(chatId, "🚫 Không tìm thấy khách hàng để xóa.");
        }
    } catch (error) {
        console.error("❌ Lỗi khi xóa khách hàng:", error);
        bot.sendMessage(chatId, "❌ Lỗi khi xóa khách hàng.");
    }
});

// Lệnh xóa mặt hàng
bot.onText(/\/removehh (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const itemId = parseInt(match[1], 10);

    try {
        console.log(`🗑 Xóa mặt hàng ID: ${itemId}`);
        
        // Xóa mặt hàng khỏi bảng customer_items trước
        await new Promise((resolve, reject) => {
            db.run("DELETE FROM customer_items WHERE item_id = ?", [itemId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Xóa mặt hàng khỏi bảng warehouse
        const deletedRows = await new Promise((resolve, reject) => {
            db.run("DELETE FROM warehouse WHERE id = ?", [itemId], function (err) {
                if (err) reject(err);
                else resolve(this.changes);
            });
        });

        if (deletedRows > 0) {
            bot.sendMessage(chatId, `✅ Đã xóa mặt hàng ID ${itemId}.`);
        } else {
            bot.sendMessage(chatId, "🚫 Không tìm thấy mặt hàng để xóa.");
        }
    } catch (error) {
        console.error("❌ Lỗi khi xóa mặt hàng:", error);
        bot.sendMessage(chatId, "❌ Lỗi khi xóa mặt hàng.");
    }
});

console.log("🤖 Bot Telegram đang chạy...");