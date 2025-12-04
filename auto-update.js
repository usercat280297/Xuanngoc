const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const webhookURL = process.env.WEBHOOK_URL;
// XÓA dòng này: const steamAPIKey = process.env.STEAM_API_KEY;

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

// Gửi thông báo Discord
async function sendGameUpdate(gameName, news) {
  const embed = {
    embeds: [{
      title: `🎮 ${gameName} Update`,
      description: news.title,
      url: news.url,
      color: 0x5865F2,
      footer: { text: "Steam Web API Monitor" }
    }]
  };

  try {
    await axios.post(webhookURL, embed);
    console.log(`✅ Đã gửi thông báo update cho ${gameName}`);
  } catch (error) {
    console.error(`❌ Lỗi khi gửi webhook cho ${gameName}:`, error.message);
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
    // BỎ &key=${steamAPIKey}
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