const fs = require('fs');

function preFilter() {
  // Đọc file games của bạn
  let allGames;
  
  // Thử đọc từ các nguồn khác nhau
  if (fs.existsSync('games_steamspy_all.json')) {
    allGames = JSON.parse(fs.readFileSync('games_steamspy_all.json', 'utf8'));
    console.log('📂 Đọc từ: games_steamspy_all.json');
  } else if (fs.existsSync('games_all.json')) {
    allGames = JSON.parse(fs.readFileSync('games_all.json', 'utf8'));
    console.log('📂 Đọc từ: games_all.json');
  } else if (fs.existsSync('games_top_100000.json')) {
    allGames = JSON.parse(fs.readFileSync('games_top_100000.json', 'utf8'));
    console.log('📂 Đọc từ: games_top_100000.json');
  } else {
    console.error('❌ Không tìm thấy file games!');
    return;
  }
  
  console.log(`📊 Filtering ${allGames.length} games...\n`);
  
  const validGames = allGames.filter((game, index) => {
    if (index % 10000 === 0) {
      console.log(`⏳ Progress: ${index}/${allGames.length}`);
    }
    
    const name = game.name.toLowerCase();
    
    // ❌ SKIP: Playtest, Beta, Demo
    const skipPatterns = [
      'playtest', 'beta test', 'closed beta', 'open beta',
      'soundtrack', 'ost', 'original soundtrack', 'music',
      'demo', ' demo ', 'tech demo', 'free demo',
      'dedicated server', 'server', 'ds',
      'development tools', 'sdk', 'modding tool', 'editor',
      'artbook', 'art book', 'digital artbook',
      'wallpaper', 'theme pack', 'avatar pack',
      'trailer', 'teaser', 'announcement',
      'prologue', 'chapter 0', 'prelude',
      'free weekend', 'trial', 'test weekend',
      'vr showcase', 'benchmark',
      'companion app', 'mobile companion'
    ];
    
    if (skipPatterns.some(pattern => name.includes(pattern))) {
      return false;
    }
    
    // ❌ SKIP: Tên quá ngắn hoặc quá dài
    if (game.name.length < 2 || game.name.length > 150) {
      return false;
    }
    
    // ❌ SKIP: AppID không hợp lệ
    if (!game.appId || game.appId <= 0) {
      return false;
    }
    
    // ❌ SKIP: Games không có người chơi (nếu có data từ SteamSpy)
    if (game.owners) {
      if (game.owners === '0 .. 0' || game.owners === '0') {
        return false;
      }
    }
    
    // ✅ KEEP: Pattern tốt
    const goodIndicators = [
      // Có review positive/negative (từ SteamSpy)
      game.positive > 0,
      game.negative >= 0,
      // Tên game hợp lệ
      game.name.match(/[a-zA-Z0-9]/),
    ];
    
    return true;
  });
  
  console.log(`\n✅ Kết quả:`);
  console.log(`   • Kept: ${validGames.length} games`);
  console.log(`   • Removed: ${allGames.length - validGames.length} games`);
  console.log(`   • Reduction: ${((1 - validGames.length/allGames.length) * 100).toFixed(1)}%\n`);
  
  // Lưu file
  fs.writeFileSync('games_prefiltered.json', JSON.stringify(validGames, null, 2));
  console.log(`💾 Saved: games_prefiltered.json`);
  
  // Tạo các size khác nhau
  const sizes = [1000, 5000, 10000, 20000, 50000];
  sizes.forEach(size => {
    if (validGames.length >= size) {
      const subset = validGames.slice(0, size);
      fs.writeFileSync(`games_clean_${size}.json`, JSON.stringify(subset, null, 2));
      console.log(`💾 Saved: games_clean_${size}.json`);
    }
  });
  
  console.log(`\n⏱️  Estimated check time với games_prefiltered.json:`);
  console.log(`   • ${validGames.length} games × 0.6s = ~${Math.ceil(validGames.length * 0.6 / 60)} phút (~${(validGames.length * 0.6 / 3600).toFixed(1)} giờ)`);
  console.log(`\n🚀 Next steps:`);
  console.log(`   copy games_prefiltered.json games.json`);
  console.log(`   node auto-update-queue.js\n`);
}

console.log('🔍 Pre-filtering games (NO API calls, instant!)...\n');
const startTime = Date.now();

preFilter();

const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
console.log(`⚡ Completed in ${elapsed} seconds!\n`);