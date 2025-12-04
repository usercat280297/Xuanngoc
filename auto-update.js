const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const webhookURL = process.env.WEBHOOK_URL;
const steamAPIKey = process.env.STEAM_API_KEY;
const games = JSON.parse(fs.readFileSync('games.json', 'utf8'));
let lastNewsIds = {};

// Tìm AppID từ tên game
async function getAppIdByName(gameName) {
  try {
    const res = await axios.get("https://api.steampowered.com/ISteamApps/GetAppList/v2/");
    const apps = res.data.applist.apps;
    const app = apps.find(app => app.name.toLowerCase() === gameName.toLowerCase());
    return app ? app.appid : null;
  } catch (error) {
    console.error(`❌ Lỗi khi tra AppID cho ${gameName}:`, error.message);
    return null;
  }
}

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
    console.error("❌ Lỗi khi gửi webhook:", error.message);
  }
}

// Kiểm tra tin tức mới
async function checkGameUpdate(gameName) {
  const appId = await getAppIdByName(gameName);
  if (!appId) {
    console.error(`⚠️ Không tìm thấy AppID cho ${gameName}`);
    return;
  }

  try {
    const res = await axios.get(
      `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=1&maxlength=300&key=${steamAPIKey}`
    );

    const latestNews = res.data.appnews.newsitems[0];
    const newId = latestNews.gid;

    if (!lastNewsIds[gameName] || newId !== lastNewsIds[gameName]) {
      await sendGameUpdate(gameName, latestNews);
      lastNewsIds[gameName] = newId;
    }
  } catch (error) {
    console.error(`❌ Lỗi khi kiểm tra ${gameName}:`, error.message);
  }
}

// Chạy lần đầu và lặp lại mỗi 10 phút
(async () => {
  for (const game of games) {
    await checkGameUpdate(game.name);
  }

  setInterval(async () => {
    for (const game of games) {
      await checkGameUpdate(game.name);
    }
  }, 10 * 60 * 1000);
})();
