const axios = require('axios');
const fs = require('fs');

console.log("🚀 Fetching Steam games from GitHub sources...\n");

async function fetchFromGitHub() {
  const sources = [
    {
      name: "SteamCMD AppID List",
      url: "https://raw.githubusercontent.com/dgibbs64/SteamCMD-AppID-List/master/steamcmd_appid.json"
    },
    {
      name: "Steam App List (Alternative)",
      url: "https://raw.githubusercontent.com/lutris/lutris/master/share/steam/applist.json"
    }
  ];

  for (const source of sources) {
    try {
      console.log(`📡 Trying: ${source.name}...`);
      
      const response = await axios.get(source.url, {
        timeout: 60000,
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      });

      let allApps = [];
      const data = response.data;

      // Xử lý các format khác nhau
      if (data.applist && data.applist.apps) {
        allApps = data.applist.apps;
      } else if (Array.isArray(data)) {
        allApps = data;
      } else if (typeof data === 'object') {
        // Format: { "appid": "name", ... }
        allApps = Object.entries(data).map(([appid, name]) => ({
          appid: parseInt(appid),
          name: name
        }));
      }

      if (allApps.length > 0) {
        console.log(`✅ Success! Got ${allApps.length} apps\n`);
        return allApps;
      }

    } catch (error) {
      console.log(`❌ Failed: ${error.message}`);
    }
  }

  return null;
}

async function fetchFromSteamAPI() {
  const endpoints = [
    'http://api.steampowered.com/ISteamApps/GetAppList/v0002/?format=json',
    'http://api.steampowered.com/ISteamApps/GetAppList/v1/?format=json',
    'https://steamcommunity.com/ISteamApps/GetAppList/v0002/?format=json'
  ];

  for (const url of endpoints) {
    try {
      console.log(`📡 Trying: ${url}...`);
      
      const response = await axios.get(url, {
        timeout: 60000,
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      });

      const allApps = response.data.applist.apps;
      if (allApps && allApps.length > 0) {
        console.log(`✅ Success! Got ${allApps.length} apps\n`);
        return allApps;
      }

    } catch (error) {
      console.log(`❌ Failed: ${error.message}`);
    }
  }

  return null;
}

function processAndSave(allApps) {
  console.log("\n🔧 Processing (MAXIMUM mode)...");
  
  const games = allApps
    .filter(app => {
      if (!app.name || app.name.trim() === '') return false;
      const name = app.name.toLowerCase();
      
      // CHỈ loại bỏ Steamworks
      return (
        !name.includes('steamworks common redistributables') &&
        !name.includes('steam linux runtime') &&
        !name.startsWith('proton ') &&
        (app.appid || app.appId) > 0
      );
    })
    .map(app => ({
      name: app.name,
      appId: app.appid || app.appId
    }))
    .sort((a, b) => b.appId - a.appId);

  console.log(`✅ Kept: ${games.length} items`);
  console.log(`📋 Bao gồm: Games + DLC + Soundtrack + Demo + Beta + Tools\n`);

  // Lưu files
  fs.writeFileSync('games_all.json', JSON.stringify(games, null, 2));
  console.log(`💾 Saved: games_all.json (${games.length} items)`);

  const sizes = [1000, 2000, 5000, 10000, 20000, 30000, 50000, 100000];
  sizes.forEach(size => {
    if (games.length >= size) {
      const subset = games.slice(0, size);
      fs.writeFileSync(`games_top_${size}.json`, JSON.stringify(subset, null, 2));
      console.log(`💾 Saved: games_top_${size}.json`);
    }
  });

  console.log("\n🎉 HOÀN THÀNH!\n");
  console.log("📊 Thống kê:");
  console.log(`   • Tổng số items: ${games.length}`);
  console.log(`   • File lớn nhất: games_all.json\n`);
  
  console.log("⏱️  Ước tính thời gian check:");
  console.log(`   • Với 0.6s/item: ~${Math.ceil(games.length * 0.6 / 60)} phút (~${(games.length * 0.6 / 3600).toFixed(1)} giờ)`);
  console.log(`   • Với 0.8s/item: ~${Math.ceil(games.length * 0.8 / 60)} phút (~${(games.length * 0.8 / 3600).toFixed(1)} giờ)\n`);
  
  console.log("🚀 Bước tiếp theo:");
  console.log("   copy games_all.json games.json");
  console.log("   node auto-update-queue.js\n");
}

// Main
(async () => {
  let allApps = null;

  // Thử GitHub trước
  console.log("🔍 Trying GitHub repositories...\n");
  allApps = await fetchFromGitHub();
  
  // Nếu thất bại, thử Steam API alternative endpoints
  if (!allApps) {
    console.log("\n🔍 Trying Steam API alternative endpoints...\n");
    allApps = await fetchFromSteamAPI();
  }

  if (!allApps || allApps.length === 0) {
    console.error("\n❌ TẤT CẢ NGUỒN ĐỀU THẤT BẠI!\n");
    console.log("🔧 Giải pháp cuối cùng:\n");
    console.log("1. Tải file từ SteamDB:");
    console.log("   https://steamdb.info/apps/");
    console.log("   → Export as JSON\n");
    console.log("2. Hoặc dùng danh sách có sẵn:");
    console.log("   https://github.com/dgibbs64/SteamCMD-AppID-List");
    console.log("   → Download steamcmd_appid.json");
    console.log("   → Đổi tên thành steam_raw.json");
    console.log("   → Chạy: node parse-manual.js\n");
    process.exit(1);
  }

  processAndSave(allApps);
})();