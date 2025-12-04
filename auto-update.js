const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const webhookURL = process.env.WEBHOOK_URL;

let games = [];
try {
  const raw = fs.readFileSync('games.json', 'utf8');
  games = JSON.parse(raw);
  if (!Array.isArray(games) || games.length === 0) {
    throw new Error("games.json không chứa danh sách hợp lệ.");
  }
} catch (error) {
  console.error("❌ Lỗi khi đọc games.json:", error.message);
  process.exit(1);
}

let lastNewsIds = {};

// File lưu trạng thái
const STATE_FILE = 'last_news_state.json';

// Đọc trạng thái cũ (nếu có)
try {
  if (fs.existsSync(STATE_FILE)) {
    const stateData = fs.readFileSync(STATE_FILE, 'utf8');
    lastNewsIds = JSON.parse(stateData);
    console.log("📂 Đã load trạng thái từ file:", Object.keys(lastNewsIds).length, "game");
  }
} catch (error) {
  console.log("⚠️ Không thể đọc file trạng thái, bắt đầu mới");
  lastNewsIds = {};
}

// Lưu trạng thái vào file
function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(lastNewsIds, null, 2));
    console.log("💾 Đã lưu trạng thái");
  } catch (error) {
    console.error("❌ Lỗi khi lưu trạng thái:", error.message);
  }
}

// Lấy hình ảnh header từ Steam Store
async function getGameImage(appId) {
  try {
    const res = await axios.get(`https://store.steampowered.com/api/appdetails?appids=${appId}`);
    const gameData = res.data[appId]?.data;
    if (gameData && gameData.header_image) {
      return gameData.header_image;
    }
  } catch (error) {
    console.log(`⚠️ Không lấy được ảnh cho AppID ${appId}`);
  }
  return null;
}

// Gửi thông báo Discord với format đẹp + button
async function sendGameUpdate(gameName, news, appId) {
  // Lấy hình ảnh game
  const gameImage = await getGameImage(appId);

  // Cắt ngắn content nếu quá dài
  let description = news.contents || news.title || 'A new version of the game has been released on the public branch.';
  
  // Xóa HTML tags nếu có
  description = description.replace(/<[^>]*>/g, '');
  
  // Format text đẹp hơn
  if (description.length > 350) {
    description = description.substring(0, 347) + '...';
  }
  
  // Thêm format in nghiêng cho mô tả
  description = `*${description}*`;

  // Tạo link đến bài viết gốc
  const newsLink = news.url || `https://store.steampowered.com/news/app/${appId}`;

  // Format thời gian đẹp
  const now = new Date();
  const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false });
  
  // Tạo embed message với button
  const payload = {
    embeds: [{
      author: {
        name: "Game Update Detected",
        icon_url: "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/593110/0bbb630d63262dd66d2fdd0f7d37e8661a410075.jpg"
      },
      color: 0x8B7EE8,
      description: `**${gameName}**\n\n${description}`,
      image: gameImage ? { url: gameImage } : undefined,
      footer: {
        text: `Steam News Monitor • Hôm nay lúc ${timeStr}`,
        icon_url: "https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/steamworks_docs/english/steam_icon.png"
      },
      timestamp: new Date().toISOString()
    }],
    // Thêm button "View Patch" với emoji đẹp
    components: [
      {
        type: 1, // Action Row
        components: [
          {
            type: 2, // Button
            style: 5, // Link style
            label: "View Patch",
            url: newsLink
          }
        ]
      }
    ]
  };

  try {
    await axios.post(webhookURL, payload);
    console.log(`✅ Đã gửi thông báo update cho ${gameName}`);
    
    // Thêm delay 1 giây giữa các message để tránh spam
    await new Promise(resolve => setTimeout(resolve, 1000));
  } catch (error) {
    console.error(`❌ Lỗi khi gửi webhook cho ${gameName}:`, error.response?.data || error.message);
  }
}

// Kiểm tra tin tức mới
async function checkGameUpdate(game) {
  const { name, appId } = game;
  if (!appId) {
    console.error(`⚠️ Không tìm thấy AppID cho ${name}`);
    return;
  }

  try {
    const res = await axios.get(
      `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=1&maxlength=500`
    );

    const latestNews = res.data.appnews.newsitems[0];
    if (!latestNews) {
      console.log(`ℹ️ Không có tin tức nào cho ${name}`);
      return;
    }

    const newId = latestNews.gid;

    // Nếu chưa có trong state -> Lần đầu chạy, chỉ lưu không gửi
    if (!lastNewsIds[name]) {
      console.log(`📌 Lần đầu check ${name}, lưu trạng thái (không gửi tin nhắn)`);
      lastNewsIds[name] = newId;
      saveState();
      return;
    }

    // Nếu có update MỚI -> Gửi tin nhắn
    if (newId !== lastNewsIds[name]) {
      console.log(`🆕 ${name} có update mới!`);
      await sendGameUpdate(name, latestNews, appId);
      lastNewsIds[name] = newId;
      saveState();
    } else {
      console.log(`⏸ Không có update mới cho ${name}`);
    }
  } catch (error) {
    console.error(`❌ Lỗi khi kiểm tra ${name}:`, error.message);
  }
}

// Chạy lần đầu và lặp lại mỗi 10 phút
(async () => {
  console.log("🚀 Bot khởi động...");
  
  // Check từng game, mỗi game là 1 message riêng
  for (const game of games) {
    await checkGameUpdate(game);
  }

  setInterval(async () => {
    console.log("🔄 Đang kiểm tra updates...");
    for (const game of games) {
      await checkGameUpdate(game);
    }
  }, 10 * 60 * 1000);
})();