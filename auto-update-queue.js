const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const webhookURL = process.env.WEBHOOK_URL;

// ⚙️ CẤU HÌNH - Tối ưu cho MANY GAMES (10k-70k)
const CONFIG = {
  CHECK_INTERVAL: 12 * 60 * 60 * 1000,
  MESSAGE_INTERVAL: 2 * 60 * 1000,
  STEAM_DELAY: 1000,
  MAX_RETRIES: 1,
  SAVE_STATE_INTERVAL: 1000,
};

let games = [];
let lastNewsIds = {};
const STATE_FILE = 'last_news_state.json';

// Queue chứa các tin nhắn cần gửi
const messageQueue = [];

// Load games
try {
  const raw = fs.readFileSync('games.json', 'utf8');
  games = JSON.parse(raw);
  console.log(`📊 Loaded ${games.length} games`);
} catch (error) {
  console.error("❌ Lỗi khi đọc games.json:", error.message);
  process.exit(1);
}

// Load state
try {
  if (fs.existsSync(STATE_FILE)) {
    const stateData = fs.readFileSync(STATE_FILE, 'utf8');
    lastNewsIds = JSON.parse(stateData);
    console.log(`📂 Loaded state: ${Object.keys(lastNewsIds).length} games`);
  }
} catch (error) {
  console.log("⚠️ Bắt đầu với state mới");
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(lastNewsIds, null, 2));
  } catch (error) {
    console.error("❌ Lỗi lưu state:", error.message);
  }
}

// Lấy hình ảnh game
async function getGameImage(appId) {
  try {
    const res = await axios.get(`https://store.steampowered.com/api/appdetails?appids=${appId}`, {
      timeout: 5000
    });
    return res.data[appId]?.data?.header_image || null;
  } catch (error) {
    return null;
  }
}

// ========== THÊM MỚI: Lấy Build ID từ news content ==========
async function getDetailedBuildInfo(appId) {
  try {
    const res = await axios.get(
      `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=3&maxlength=5000`,
      { timeout: 10000 }
    );
    
    const newsItems = res.data.appnews?.newsitems || [];
    
    // Tìm tin tức có chứa Build ID
    for (const item of newsItems) {
      const content = (item.contents || item.title || '').toLowerCase();
      
      // Pattern: "12345678 → 23456789" hoặc "Build ID: 12345678"
      const changeMatch = content.match(/(\d{7,})\s*(?:→|->|➡️|➡|to|=>)\s*(\d{7,})/i);
      if (changeMatch) {
        return {
          oldBuild: changeMatch[1],
          newBuild: changeMatch[2]
        };
      }
      
      // Pattern: "Build ID: 12345678"
      const singleMatch = content.match(/build\s*id[:\s]+(\d{7,})/i);
      if (singleMatch) {
        return {
          newBuild: singleMatch[1]
        };
      }
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// ========== SỬA LẠI: createDiscordPayload - Giống y chang ảnh mẫu ==========
async function createDiscordPayload(gameName, news, appId) {
  // Lấy ảnh và build info song song
  const [gameImage, buildInfo] = await Promise.all([
    getGameImage(appId),
    getDetailedBuildInfo(appId)
  ]);
  
  // Xử lý mô tả
  let description = news.contents || news.title || 'A new version of the game has been released on the public branch.';
  description = description.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  
  // Loại bỏ Build ID khỏi description
  description = description.replace(/build\s*id[:\s]+\d+/gi, '');
  description = description.replace(/\d{7,}\s*(?:→|->|➡️|➡)\s*\d{7,}/g, '');
  description = description.trim();
  
  if (description.length > 250) {
    description = description.substring(0, 247) + '...';
  }
  
  // Format thời gian: "10:58 CH"
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes().toString().padStart(2, '0');
  const period = hour >= 12 ? 'CH' : 'SA';
  const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
  const timeStr = `${displayHour}:${minute} ${period}`;
  
  const newsLink = news.url || `https://store.steampowered.com/news/app/${appId}`;

  // Tạo embed
  const embed = {
    author: {
      name: "Game Update Detected"
    },
    color: 0x8B7EE8, // Màu tím như ảnh
    title: gameName,
    url: newsLink, // Title có link
    description: description,
    fields: [],
    image: gameImage ? { url: gameImage } : undefined,
    footer: {
      text: `Hôm nay lúc ${timeStr}`
    },
    timestamp: new Date().toISOString()
  };

  // Thêm Build ID field nếu có
  if (buildInfo) {
    if (buildInfo.oldBuild && buildInfo.newBuild) {
      embed.fields.push({
        name: "Build ID Change",
        value: `${buildInfo.oldBuild} ➡️ ${buildInfo.newBuild}`,
        inline: false
      });
    } else if (buildInfo.newBuild) {
      embed.fields.push({
        name: "Build ID",
        value: buildInfo.newBuild,
        inline: false
      });
    }
  }

  return {
    embeds: [embed],
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 5,
        label: "View Patch",
        url: newsLink
      }]
    }]
  };
}

// Gửi 1 tin nhắn từ queue
async function processQueue() {
  if (messageQueue.length === 0) {
    return;
  }

  const message = messageQueue.shift();
  
  try {
    const payload = await createDiscordPayload(message.gameName, message.news, message.appId);
    await axios.post(webhookURL, payload);
    console.log(`✅ [${messageQueue.length} còn lại] Đã gửi: ${message.gameName}`);
  } catch (error) {
    console.error(`❌ Lỗi gửi ${message.gameName}:`, error.response?.data?.message || error.message);
    
    // Nếu lỗi rate limit, đưa message trở lại queue
    if (error.response?.status === 429) {
      messageQueue.unshift(message);
      console.log("⏸️ Discord rate limit, retry sau...");
    }
  }
}

// Check 1 game với retry logic
async function checkGameUpdate(game, index, total) {
  const { name, appId } = game;
  if (!appId) return;

  let retries = 0;
  
  while (retries < CONFIG.MAX_RETRIES) {
    try {
      // Log progress mỗi 500 games (tăng từ 100 vì có nhiều game)
      if (index % 500 === 0) {
        console.log(`⏳ Progress: ${index}/${total} | Queue: ${messageQueue.length} updates`);
        
        // Lưu state định kỳ để tránh mất data
        if (index % CONFIG.SAVE_STATE_INTERVAL === 0) {
          saveState();
          console.log(`💾 Auto-saved state at ${index} games`);
        }
      }

      const res = await axios.get(
        `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=1&maxlength=500`,
        { timeout: 10000 }
      );

      const latestNews = res.data.appnews?.newsitems?.[0];
      if (!latestNews) return;

      const newId = latestNews.gid;

      // Lần đầu: chỉ lưu, không gửi
      if (!lastNewsIds[name]) {
        lastNewsIds[name] = newId;
        return;
      }

      // Có update MỚI: thêm vào queue (không gửi ngay)
      if (newId !== lastNewsIds[name]) {
        console.log(`🆕 New update: ${name} → Added to queue`);
        messageQueue.push({
          gameName: name,
          news: latestNews,
          appId: appId
        });
        lastNewsIds[name] = newId;
      }
      
      // Success - break retry loop
      break;

    } catch (error) {
      retries++;
      
      // Steam rate limit - pause dài hơn
      if (error.response?.status === 429) {
        console.log(`⚠️ Steam rate limit at game ${index}, pausing 30s...`);
        await new Promise(resolve => setTimeout(resolve, 30000));
        continue;
      }
      
      // Lỗi khác - retry hoặc skip
      if (retries >= CONFIG.MAX_RETRIES) {
        // Skip game này sau khi retry hết
        console.log(`⚠️ Skipped ${name} after ${CONFIG.MAX_RETRIES} retries`);
        break;
      }
      
      // Chờ trước khi retry
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  // Delay để tránh Steam rate limit
  await new Promise(resolve => setTimeout(resolve, CONFIG.STEAM_DELAY));
}

// Check tất cả games
async function checkAllGames() {
  const startTime = Date.now();
  console.log(`\n🔄 Bắt đầu check ${games.length} games...`);
  console.log(`📅 Estimated time: ~${Math.ceil(games.length * CONFIG.STEAM_DELAY / 1000 / 60)} phút\n`);
  
  for (let i = 0; i < games.length; i++) {
    await checkGameUpdate(games[i], i + 1, games.length);
  }
  
  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n✅ Hoàn thành check trong ${elapsed} phút`);
  console.log(`📬 ${messageQueue.length} updates trong queue (sẽ gửi dần)`);
  console.log(`⏰ Thời gian gửi hết: ~${(messageQueue.length * CONFIG.MESSAGE_INTERVAL / 1000 / 60).toFixed(0)} phút\n`);
  
  saveState();
}

// Main
(async () => {
  console.log("🚀 Steam News Monitor với Queue System!");
  console.log(`📊 Monitoring: ${games.length} games`);
  console.log(`⏰ Check all games mỗi: ${CONFIG.CHECK_INTERVAL / 60 / 60 / 1000} giờ`);
  console.log(`📬 Gửi Discord mỗi: ${CONFIG.MESSAGE_INTERVAL / 60 / 1000} phút`);
  console.log(`⏱️ Steam API delay: ${CONFIG.STEAM_DELAY}ms\n`);

  // Ước tính
  const estimatedCheckTime = (games.length * CONFIG.STEAM_DELAY) / 1000 / 60;
  console.log(`📅 Thời gian check ALL games: ~${Math.ceil(estimatedCheckTime)} phút (~${(estimatedCheckTime / 60).toFixed(1)} giờ)`);
  console.log(`💡 Tin nhắn sẽ gửi đều đặn mỗi ${CONFIG.MESSAGE_INTERVAL / 60 / 1000} phút!`);
  console.log(`💾 State được lưu tự động mỗi ${CONFIG.SAVE_STATE_INTERVAL} games\n`);

  // Worker 1: Check games định kỳ
  checkAllGames(); // Chạy ngay lần đầu
  setInterval(checkAllGames, CONFIG.CHECK_INTERVAL);

  // Worker 2: Gửi tin nhắn từ queue đều đặn
  setInterval(processQueue, CONFIG.MESSAGE_INTERVAL);
  
  console.log("✨ Bot đang chạy...\n");
})();