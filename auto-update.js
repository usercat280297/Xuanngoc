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

// Gửi thông báo Discord với format đẹp
async function sendGameUpdate(gameName, news) {
  // Cắt ngắn content nếu quá dài
  let content = news.contents || news.title || 'A new version of the game has been released on the public branch.';
  if (content.length > 2000) {
    content = content.substring(0, 1997) + '...';
  }

  // Tạo embed message với format giống SteamDB
  const embed = {
    embeds: [{
      title: "Game Update Detected",
      description: `**${gameName}**\n\n${content}`,
      color: 0x6441A5, // Màu tím giống Discord
      url: news.url || `https://store.steampowered.com/app/${news.appid}`,
      timestamp: new Date(news.date * 1000).toISOString(),
      footer: {
        text: "Steam News Monitor"
      },
      // Thêm thumbnail nếu có
      ...(news.image && { 
        image: { 
          url: news.image 
        } 
      })
    }]
  };

  try {
    await axios.post(webhookURL, embed);
    console.log(`✅ Đã gửi thông báo update cho ${gameName}`);
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
      `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=1&maxlength=300`
    );

    const latestNews = res.data.appnews.newsitems[0];
    if (!latestNews) {
      console.log(`ℹ️ Không có tin tức nào cho ${name}`);
      return;
    }

    const newId = latestNews.gid;

    if (!lastNewsIds[name] || newId !== lastNewsIds[name]) {
      await sendGameUpdate(name, latestNews);
      lastNewsIds[name] = newId;
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
  for (const game of games) {
    await checkGameUpdate(game);
  }

  setInterval(async () => {
    for (const game of games) {
      await checkGameUpdate(game);
    }
  }, 10 * 60 * 1000);
})();