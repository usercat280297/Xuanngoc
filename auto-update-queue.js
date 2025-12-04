// Lấy Build ID từ Steam API
async function getBuildID(appId) {
  try {
    // Dùng Steam Store API để lấy thông tin chi tiết
    const res = await axios.get(
      `https://store.steampowered.com/api/appdetails?appids=${appId}`,
      { timeout: 5000 }
    );
    
    const data = res.data[appId]?.data;
    if (!data) return null;
    
    // Lấy buildid từ depot hoặc content_descriptors
    const buildId = data.steam_appid ? data.steam_appid.toString() : null;
    
    return buildId;
  } catch (error) {
    return null;
  }
}

// Lấy Build ID từ SteamCMD/Depot API (chính xác hơn)
async function getDetailedBuildInfo(appId) {
  try {
    // Dùng API public của SteamDB hoặc parse từ news content
    const res = await axios.get(
      `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=3&maxlength=5000`,
      { timeout: 10000 }
    );
    
    const newsItems = res.data.appnews?.newsitems || [];
    
    // Tìm tin tức có chứa Build ID
    for (const item of newsItems) {
      const content = item.contents || item.title || '';
      
      // Pattern matching: tìm "Build ID" hoặc số build
      const patterns = [
        /build\s*id[:\s]+(\d{7,})/gi,
        /buildid[:\s]+(\d{7,})/gi,
        /build[:\s]+(\d{7,})/gi,
        /(\d{7,})\s*(?:→|->|➡️|➡|to)\s*(\d{7,})/gi
      ];
      
      for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match) {
          // Nếu tìm thấy pattern "old → new"
          const fullMatch = content.match(/(\d{7,})\s*(?:→|->|➡️|➡|to)\s*(\d{7,})/i);
          if (fullMatch) {
            return {
              oldBuild: fullMatch[1],
              newBuild: fullMatch[2]
            };
          }
          
          // Nếu chỉ có 1 build ID
          const singleMatch = content.match(/(\d{7,})/);
          if (singleMatch) {
            return {
              newBuild: singleMatch[1]
            };
          }
        }
      }
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// Tạo payload Discord - CHUẨN Y CHANG MẪU + BUILD ID
async function createDiscordPayload(gameName, news, appId) {
  // Lấy ảnh và build info song song
  const [gameImage, buildInfo] = await Promise.all([
    getGameImage(appId),
    getDetailedBuildInfo(appId)
  ]);
  
  // Mô tả
  let description = news.contents || news.title || 'A new version of the game has been released on the public branch.';
  description = description.replace(/<[^>]*>/g, '').trim();
  
  // Loại bỏ Build ID khỏi description nếu có
  description = description.replace(/build\s*id[:\s]+\d+/gi, '').trim();
  description = description.replace(/\d{7,}\s*(?:→|->|➡️|➡)\s*\d{7,}/g, '').trim();
  
  if (description.length > 250) {
    description = description.substring(0, 247) + '...';
  }
  
  // Thời gian format: "10:58 CH"
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
    color: 0x8B7EE8,
    title: gameName,
    url: newsLink, // ← TITLE CÓ LINK
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
      // Có cả old và new build
      embed.fields.push({
        name: "Build ID Change",
        value: `${buildInfo.oldBuild} ➡️ ${buildInfo.newBuild}`,
        inline: false
      });
    } else if (buildInfo.newBuild) {
      // Chỉ có new build
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