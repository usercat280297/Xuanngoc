const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const webhookURL = process.env.WEBHOOK_URL;

// ⚙️ CẤU HÌNH - Tối ưu cho MANY GAMES (10k-70k)
const CONFIG = {
  CHECK_INTERVAL: 12 * 60 * 60 * 1000, // Check tất cả games mỗi 12 giờ
  MESSAGE_INTERVAL: 2 * 60 * 1000,     // Gửi Discord mỗi 2 phút
  STEAM_DELAY: 1200,                     // 1.2s giữa mỗi Steam API call
  STEAMDB_DELAY: 1500,                   // 1.5s delay riêng cho SteamDB API
  MAX_RETRIES: 1,                       // Retry tối đa 3 lần nếu lỗi
  SAVE_STATE_INTERVAL: 1000,            // Lưu state mỗi 1000 games
};

// 🎨 EMOJI CHO TAGS
const TAG_EMOJIS = {
  // Thể loại
  'Action': '⚔️',
  'Adventure': '🗺️',
  'RPG': '🎭',
  'Strategy': '🧠',
  'Simulation': '🎮',
  'Horror': '🧟',
  'Survival': '🏕️',
  'Puzzle': '🧩',
  'Racing': '🏎️',
  'Sports': '⚽',
  'Shooter': '🔫',
  'Fighting': '🥊',
  'Platformer': '🦘',
  'Sandbox': '🏗️',
  'MOBA': '🏆',
  'Battle Royale': '🎯',
  'Card Game': '🃏',
  'Tower Defense': '🗼',
  'Roguelike': '🎲',
  'Metroidvania': '🦇',
  
  // Chế độ chơi
  'Single-player': '🎮',
  'Multiplayer': '👥',
  'Co-op': '🤝',
  'PvP': '⚔️',
  'Online': '🌐',
  'Local Co-op': '🏠',
  'Cross-Platform': '🔄',
  
  // Tính năng
  'Open World': '🌍',
  'Story Rich': '📖',
  'Atmospheric': '🌫️',
  'Indie': '💎',
  'Early Access': '🚧',
  'VR': '🥽',
  'Controller': '🎮',
  'Achievements': '🏅',
  'Steam Cloud': '☁️',
  'Workshop': '🔧',
  'Trading Cards': '🎴',
  
  // Mặc định
  'default': '🏷️'
};

let games = [];
let lastNewsIds = {};
let lastBuildIds = {};
const STATE_FILE = 'last_news_state.json';
const BUILD_STATE_FILE = 'last_build_state.json';

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

// Load news state
try {
  if (fs.existsSync(STATE_FILE)) {
    const stateData = fs.readFileSync(STATE_FILE, 'utf8');
    lastNewsIds = JSON.parse(stateData);
    console.log(`📂 Loaded news state: ${Object.keys(lastNewsIds).length} games`);
  }
} catch (error) {
  console.log("⚠️ Bắt đầu với news state mới");
}

// Load build state
try {
  if (fs.existsSync(BUILD_STATE_FILE)) {
    const buildData = fs.readFileSync(BUILD_STATE_FILE, 'utf8');
    lastBuildIds = JSON.parse(buildData);
    console.log(`📂 Loaded build state: ${Object.keys(lastBuildIds).length} games`);
  }
} catch (error) {
  console.log("⚠️ Bắt đầu với build state mới");
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(lastNewsIds, null, 2));
    fs.writeFileSync(BUILD_STATE_FILE, JSON.stringify(lastBuildIds, null, 2));
  } catch (error) {
    console.error("❌ Lỗi lưu state:", error.message);
  }
}

// 🆕 Lấy Build ID từ SteamDB API
async function getGameBuildId(appId) {
  try {
    // Method 1: Thử lấy từ SteamDB API (public branch)
    const steamDbRes = await axios.get(`https://api.steamdb.info/v1/app/${appId}/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 8000
    });

    const publicBranch = steamDbRes.data?.data?.depots?.branches?.public;
    if (publicBranch?.buildid) {
      return publicBranch.buildid.toString();
    }

    // Method 2: Fallback - Scrape từ SteamDB website
    const htmlRes = await axios.get(`https://steamdb.info/app/${appId}/depots/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 8000
    });

    const buildIdMatch = htmlRes.data.match(/Public Branch.*?BuildID:\s*(\d+)/s);
    if (buildIdMatch && buildIdMatch[1]) {
      return buildIdMatch[1];
    }

    return null;
  } catch (error) {
    try {
      const storeRes = await axios.get(`https://store.steampowered.com/api/appdetails?appids=${appId}`, {
        timeout: 5000
      });
      
      const depots = storeRes.data[appId]?.data?.depots;
      if (depots) {
        for (const depotId in depots) {
          const depot = depots[depotId];
          if (depot?.manifests?.public) {
            return depot.manifests.public.toString();
          }
        }
      }
    } catch (fallbackError) {
      // Ignore
    }
    
    return null;
  }
}

// 🆕 Lấy thông tin chi tiết game từ Steam Store API
async function getGameDetails(appId) {
  try {
    const res = await axios.get(`https://store.steampowered.com/api/appdetails?appids=${appId}`, {
      timeout: 5000
    });
    
    const gameData = res.data[appId]?.data;
    if (!gameData) return null;
    
    return {
      headerImage: gameData.header_image || null,
      genres: gameData.genres?.map(g => g.description) || [],
      categories: gameData.categories?.map(c => c.description) || [],
      developers: gameData.developers || [],
      publishers: gameData.publishers || [],
      releaseDate: gameData.release_date?.date || null
    };
  } catch (error) {
    return null;
  }
}

// 🎨 Tạo tag với emoji
function createTagWithEmoji(tagName) {
  const emoji = TAG_EMOJIS[tagName] || TAG_EMOJIS['default'];
  return `${emoji} ${tagName}`;
}

// 🆕 Tạo payload Discord với đầy đủ thông tin như ảnh mẫu
async function createDiscordPayload(gameName, news, appId, oldBuildId, newBuildId) {
  const gameDetails = await getGameDetails(appId);
  
  // 1. Xử lý nội dung text
  let rawContents = news.contents || '';
  let cleanContents = rawContents.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  
  const updateTitle = news.title || 'New Update Available';
  
  let summary = cleanContents;
  if (summary.length > 300) {
    summary = summary.substring(0, 297) + '...';
  }
  if (!summary) summary = "A new version of the game has been released on the public branch.";

  const now = new Date();
  const timeStr = now.toLocaleTimeString('vi-VN', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false
  });
  
  const newsLink = news.url || `https://store.steampowered.com/news/app/${appId}`;

  // 🆕 Build ID Change với icon
  let buildChangeText = '';
  if (oldBuildId && newBuildId && oldBuildId !== newBuildId) {
    buildChangeText = `\n\n**Build ID Change**\n\`${oldBuildId}\` ➡️ \`${newBuildId}\``;
  }

  // 🆕 Tạo phần Tags đẹp
  let tagsText = '';
  if (gameDetails) {
    const allTags = [];
    
    // Lấy tối đa 6 tags quan trọng nhất
    const importantGenres = gameDetails.genres.slice(0, 3);
    const importantCategories = gameDetails.categories
      .filter(cat => ['Single-player', 'Multiplayer', 'Co-op', 'Online Co-Op', 'PvP'].includes(cat))
      .slice(0, 3);
    
    [...importantGenres, ...importantCategories].forEach(tag => {
      allTags.push(createTagWithEmoji(tag));
    });
    
    if (allTags.length > 0) {
      tagsText = `\n\n${allTags.join(' • ')}`;
    }
  }

  // 🆕 Embed đầy đủ như ảnh mẫu
  const embed = {
    author: {
      name: "Game Update Detected",
      icon_url: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/83/Steam_icon_logo.svg/2048px-Steam_icon_logo.svg.png"
    },
    color: 0x9B59B6, // Màu tím
    
    title: gameName,
    url: newsLink,
    
    description: `${summary}${buildChangeText}${tagsText}`,
    
    image: gameDetails?.headerImage ? { url: gameDetails.headerImage } : undefined,
    
    footer: {
      text: `Hôm nay lúc ${timeStr}`,
      icon_url: "https://cdn.discordapp.com/emojis/843169324686409749.png"
    },
    
    timestamp: new Date().toISOString()
  };

  // 🆕 Thêm fields nếu có thông tin
  embed.fields = [];
  
  if (gameDetails?.developers && gameDetails.developers.length > 0) {
    embed.fields.push({
      name: "👨‍💻 Developer",
      value: gameDetails.developers.slice(0, 2).join(', '),
      inline: true
    });
  }
  
  if (gameDetails?.releaseDate) {
    embed.fields.push({
      name: "📅 Release Date",
      value: gameDetails.releaseDate,
      inline: true
    });
  }

  return {
    embeds: [embed],
    
    components: [{
      type: 1,
      components: [{
        type: 2,
        style: 5,
        label: "View Patch",
        url: newsLink,
        emoji: {
          name: "🔗"
        }
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
    const payload = await createDiscordPayload(
      message.gameName, 
      message.news, 
      message.appId,
      message.oldBuildId,
      message.newBuildId
    );
    await axios.post(webhookURL, payload);
    console.log(`✅ [${messageQueue.length} còn lại] Đã gửi: ${message.gameName}`);
  } catch (error) {
    console.error(`❌ Lỗi gửi ${message.gameName}:`, error.response?.data?.message || error.message);
    
    if (error.response?.status === 429) {
      messageQueue.unshift(message);
      console.log("⏸️ Discord rate limit, retry sau...");
    }
  }
}

// Check game update với Build ID tracking
async function checkGameUpdate(game, index, total) {
  const { name, appId } = game;
  if (!appId) return;

  let retries = 0;
  
  while (retries < CONFIG.MAX_RETRIES) {
    try {
      if (index % 500 === 0) {
        console.log(`⏳ Progress: ${index}/${total} | Queue: ${messageQueue.length} updates`);
        
        if (index % CONFIG.SAVE_STATE_INTERVAL === 0) {
          saveState();
          console.log(`💾 Auto-saved state at ${index} games`);
        }
      }

      // Lấy news
      const res = await axios.get(
        `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=1&maxlength=500`,
        { timeout: 10000 }
      );

      const latestNews = res.data.appnews?.newsitems?.[0];
      if (!latestNews) return;

      const newNewsId = latestNews.gid;
      
      // Lấy Build ID hiện tại
      const currentBuildId = await getGameBuildId(appId);

      // Lần đầu: chỉ lưu, không gửi
      if (!lastNewsIds[name]) {
        lastNewsIds[name] = newNewsId;
        if (currentBuildId) {
          lastBuildIds[name] = currentBuildId;
        }
        return;
      }

      // Có update MỚI: thêm vào queue với Build ID
      if (newNewsId !== lastNewsIds[name]) {
        const oldBuildId = lastBuildIds[name] || null;
        
        console.log(`🆕 New update: ${name} → Added to queue`);
        if (oldBuildId && currentBuildId) {
          console.log(`   📦 Build: ${oldBuildId} → ${currentBuildId}`);
        }
        
        messageQueue.push({
          gameName: name,
          news: latestNews,
          appId: appId,
          oldBuildId: oldBuildId,
          newBuildId: currentBuildId
        });
        
        lastNewsIds[name] = newNewsId;
        if (currentBuildId) {
          lastBuildIds[name] = currentBuildId;
        }
      }
      
      break;

    } catch (error) {
      retries++;
      
      if (error.response?.status === 429) {
        console.log(`⚠️ Steam rate limit at game ${index}, pausing 30s...`);
        await new Promise(resolve => setTimeout(resolve, 30000));
        continue;
      }
      
      if (retries >= CONFIG.MAX_RETRIES) {
        console.log(`⚠️ Skipped ${name} after ${CONFIG.MAX_RETRIES} retries`);
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
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
  console.log("🚀 Steam News Monitor với Build ID Tracking + Enhanced UI!");
  console.log(`📊 Monitoring: ${games.length} games`);
  console.log(`⏰ Check all games mỗi: ${CONFIG.CHECK_INTERVAL / 60 / 60 / 1000} giờ`);
  console.log(`📬 Gửi Discord mỗi: ${CONFIG.MESSAGE_INTERVAL / 60 / 1000} phút`);
  console.log(`⏱️ Steam API delay: ${CONFIG.STEAM_DELAY}ms\n`);

  const estimatedCheckTime = (games.length * CONFIG.STEAM_DELAY) / 1000 / 60;
  console.log(`📅 Thời gian check ALL games: ~${Math.ceil(estimatedCheckTime)} phút (~${(estimatedCheckTime / 60).toFixed(1)} giờ)`);
  console.log(`💡 Tin nhắn sẽ gửi đều đặn mỗi ${CONFIG.MESSAGE_INTERVAL / 60 / 1000} phút!`);
  console.log(`💾 State được lưu tự động mỗi ${CONFIG.SAVE_STATE_INTERVAL} games\n`);

  checkAllGames();
  setInterval(checkAllGames, CONFIG.CHECK_INTERVAL);

  setInterval(processQueue, CONFIG.MESSAGE_INTERVAL);
  
  console.log("✨ Bot đang chạy...\n");
})();