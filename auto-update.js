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

// Gửi thông báo Discord với format đẹp giống SteamDB
async function sendGameUpdate(gameName, news, appId) {
  // Lấy hình ảnh game
  const gameImage = await getGameImage(appId);

  // Cắt ngắn content nếu quá dài
  let description = news.contents || news.title || 'A new version of the game has been released on the public branch.';
  
  // Xóa HTML tags nếu có
  description = description.replace(/<[^>]*>/g, '');
  
  if (description.length > 400) {
    description = description.substring(0, 397) + '...';
  }

  // Tạo link đến bài viết gốc
  const newsLink = news.url || `https://store.steampowered.com/news/app/${appId}`;

  // Tạo embed message
  const embed = {
    embeds: [{
      title: "Game Update Detected",
      color: 0x9370DB, // Màu tím đẹp
      fields: [
        {
          name: gameName,
          value: description + `\n\n🔗 [View Patch](${newsLink})`,
          inline: false
        }
      ],
      image: gameImage ? { url: gameImage } : undefined,
      footer: {
        text: "Steam News Monitor • Hôm nay lúc " + new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })
      },
      timestamp: new Date().toISOString()
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
      `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=1&maxlength=500`
    );

    const latestNews = res.data.appnews.newsitems[0];
    if (!latestNews) {
      console.log(`ℹ️ Không có tin tức nào cho ${name}`);
      return;
    }

    const newId = latestNews.gid;

    if (!lastNewsIds[name] || newId !== lastNewsIds[name]) {
      await sendGameUpdate(name, latestNews, appId);
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
    console.log("🔄 Đang kiểm tra updates...");
    for (const game of games) {
      await checkGameUpdate(game);
    }
  }, 10 * 60 * 1000);
})();