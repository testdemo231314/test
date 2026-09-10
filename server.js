const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const chokidar = require('chokidar');
const decache = require('decache');
const { getConfigManager } = require('./src/config/config');
const { getLang } = require('./src/config/lang');
const packageJson = require('./package.json');

// Config manager'ı başlat
const configManager = getConfigManager();

// Lang sistemini başlat
const lang = getLang();

// Dil ayarını config'den yükle
const savedLanguage = configManager.get('language') || 'tr';
lang.setLanguage(savedLanguage);

// Hot reload için sistem modülleri
let AgentManager = require('./src/agents/AgentManager');
let CronManager = require('./src/cron/CronManager');
let BackupManager = require('./src/sistem/BackupManager');
let ModelManager = require('./src/models/ModelManager');
let UpdateManager = require('./src/sistem/UpdateManager');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});



// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path} - ${new Date().toISOString()}`);
  next();
});

// Dosya hata kontrolü fonksiyonu (hot reload için)
async function checkFileSyntax(filePath) {
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    await execAsync(`node --check "${filePath}"`);
    return { success: true, error: null };
  } catch (error) {
    const fullError = error.stderr || error.stdout || error.message;
    return { 
      success: false, 
      error: fullError 
    };
  }
}

// Hot reload fonksiyonu
async function reloadSystemModule(modulePath, moduleName, sendNotification = true) {
  try {
    console.log(`${moduleName} değişti, kontrol ediliyor...`);
    
    // Dosya syntax kontrolü
    const syntaxCheck = await checkFileSyntax(modulePath);
    if (!syntaxCheck.success) {
      console.log('hata var');
      if (global.agentManager && sendNotification) {
        global.agentManager.sendErrorNotification(
          `${moduleName} Hata`,
          `Dosya: ${modulePath}\nHata: ${syntaxCheck.error}`
        );
      }
      return null;
    }
    
    console.log(`${moduleName} yükleniyor...`);
    decache(modulePath);
    const newModule = require(modulePath);
    console.log(`${moduleName} yüklendi`);
    
    // Başarılı reload olduğunda mesaj gönder (sadece istenirse)
    if (global.agentManager && sendNotification) {
      global.agentManager.sendSuccessNotification(
        `${moduleName} Güncellendi`,
        `${moduleName} başarıyla güncellendi.`
      );
    }
    
    return newModule;
  } catch (err) {
    console.log('hata var');
    // Runtime hatası için tam stack trace gönder
    const fullError = `${err.message}\n${err.stack}`;
    if (global.agentManager && sendNotification) {
      global.agentManager.sendErrorNotification(
        `${moduleName} Hata`,
        `Dosya: ${modulePath}\nHata: ${fullError}`
      );
    }
    return null;
  }
}

// AgentManager hot reload
async function reloadAgentManager(waitForCompletion = true) {
  const newAgentManagerModule = await reloadSystemModule('./src/agents/AgentManager', 'AgentManager', false);
  
  if (newAgentManagerModule) {
    if (global.agentManager) {
      await global.agentManager.cleanup(waitForCompletion);
    }
    
    AgentManager = newAgentManagerModule;
    const apiKey = configManager.getApiKey('gemini') || configManager.getApiKey('google');
    const newAgentManager = new AgentManager(io, apiKey);
    
    if (global.cronManager) {
      newAgentManager.setCronManager(global.cronManager);
    }
    
    global.agentManager = newAgentManager;
    console.log('AgentManager yüklendi');
    return true;
  } else {
    console.log('AgentManager yüklenmedi');
    return false;
  }
}

// CronManager hot reload
async function reloadCronManager() {
  const newCronManagerModule = await reloadSystemModule('./src/cron/CronManager', 'CronManager', false);
  
  if (newCronManagerModule && global.agentManager) {
    if (global.cronManager) {
      global.cronManager.cleanup();
    }
    
    CronManager = newCronManagerModule;
    const newCronManager = new CronManager(io, global.agentManager);
    
    global.agentManager.setCronManager(newCronManager);
    global.cronManager = newCronManager;
    
    // Durdurulan cron task'larını yeniden başlat
    if (global.stoppedCronTaskIds && global.stoppedCronTaskIds.length > 0) {
      console.log(`${global.stoppedCronTaskIds.length} cron task yeniden başlatılıyor...`);
      global.stoppedCronTaskIds.forEach(taskId => {
        const task = newCronManager.getTask(taskId);
        if (task) {
          try {
            task.start();
            console.log(`Cron task ${taskId} (${task.name}) yeniden başlatıldı`);
          } catch (err) {
            console.error(`Cron task ${taskId} başlatılırken hata:`, err);
          }
        } else {
          console.error(`Cron task ${taskId} bulunamadı`);
        }
      });
      global.stoppedCronTaskIds = null; // Temizle
    }
    
    console.log('CronManager yüklendi');
    return true;
  } else {
    console.log('CronManager yüklenmedi');
    return false;
  }
}

// ModelManager hot reload
async function reloadModelManager() {
  const newModelManagerModule = await reloadSystemModule('./src/models/ModelManager', 'ModelManager', false);
  
  if (newModelManagerModule) {
    if (global.modelManager) {
      // ModelManager doesn't need cleanup, just reload
    }
    
    ModelManager = newModelManagerModule;
    const newModelManager = new ModelManager();
    
    global.modelManager = newModelManager;
    console.log('ModelManager yüklendi');
    return true;
  } else {
    console.log('ModelManager yüklenmedi');
    return false;
  }
}

// Tüm sistemi yeniden yükle
async function reloadAllSystem(modulePath = null, moduleName = null, waitForCompletion = true) {
  console.log('=== TÜM SİSTEM YENİDEN YÜKLENİYOR ===');
  if (waitForCompletion) {
    console.log('=== GRACEFUL SHUTDOWN AKTİF - Çalışan agent\'ların bitmesi bekleniyor (sonsuz) ===');
  }
  
  // Eğer spesifik bir modül verildiyse, önce onu kontrol et
  if (modulePath && moduleName) {
    console.log(`${moduleName} kontrol ediliyor...`);
    const reloadedModule = await reloadSystemModule(modulePath, moduleName, true);
    if (!reloadedModule) {
      console.log(`${moduleName} yüklenemedi, tüm sistem reload iptal ediliyor`);
      return false;
    }
  }
  
  const agentManagerSuccess = await reloadAgentManager(waitForCompletion);
  if (!agentManagerSuccess) {
    console.log('=== İPTAL EDİLDİ ===');
    return false;
  }
  
  const cronManagerSuccess = await reloadCronManager();
  if (!cronManagerSuccess) {
    console.log('=== İPTAL EDİLDİ ===');
    return false;
  }
  
  const modelManagerSuccess = await reloadModelManager();
  if (!modelManagerSuccess) {
    console.log('=== İPTAL EDİLDİ ===');
    return false;
  }
  
  console.log('=== BAŞARIYLA YÜKLENDİ ===');
  
  // Tüm sistem başarıyla yüklendiğinde tek bir bildirim gönder
  if (global.agentManager) {
    const waitMessage = waitForCompletion ? 'Çalışan agent\'ların bitmesi beklendi (sonsuz bekleme).' : 'Zorla kapatma yapıldı.';
    global.agentManager.sendSuccessNotification(
      'Sistem Güncellendi',
      `Tüm sistem başarıyla yeniden yüklendi.\n${waitMessage}`
    );
  }
  
  return true;
}

// Initialize Agent Manager
const apiKey = configManager.getApiKey('gemini') || configManager.getApiKey('google');
global.agentManager = new AgentManager(io, apiKey);

// Initialize Cron Manager
global.cronManager = new CronManager(io, global.agentManager);

// Set cronManager in agentManager after initialization
global.agentManager.setCronManager(global.cronManager);

// Initialize BackupManager
let backupManager = new BackupManager(configManager, global.agentManager);
global.backupManager = backupManager;

// Initialize ModelManager
global.modelManager = new ModelManager();

// Initialize UpdateManager
global.updateManager = new UpdateManager(configManager, global.agentManager, io);

// Start backup system
backupManager.start();

// Store reference to main plugin manager for cleanup
let mainPluginManager = null;

// Initialize system file watcher
const systemWatcher = chokidar.watch(__dirname, {
  ignored: [
    /(^|[\/\\])\../,            // Gizli dosyaları yoksay
    /node_modules/,              // node_modules'i yoksay
    /\.swp|\.swo|\.tmp/         // geçici dosyaları yoksay
  ],
  persistent: true,
  ignoreInitial: true
});

systemWatcher.on('change', async (filePath) => {
  console.log(`System file changed: ${filePath}`);
  const relativePath = path.relative(__dirname, filePath);
  console.log(`  Relative path: ${relativePath}`);
  
  // Windows'ta path'leri normalize et (ters slash'leri düz slash'e çevir)
  const normalizedPath = relativePath.replace(/\\/g, '/');
  console.log(`  Normalized path: ${normalizedPath}`);
  
  // Hangi dosya değiştiğine göre sadece o dosyayı reload et
  if (normalizedPath.startsWith('src/')) {
    // Diğer src/ dosyaları için tek tek reload
    const fileName = normalizedPath.split('/').pop();
    const moduleName = fileName.replace('.js', '');
    console.log(`${moduleName} değişti, yeniden yükleniyor...`);
    await reloadAllSystem(`./${normalizedPath}`, moduleName);
  }
  
  // data/models.json değişirse ModelManager'ı reload et
  if (normalizedPath === 'data/models.json') {
    console.log('models.json değişti, ModelManager yeniden yükleniyor...');
    await reloadModelManager();
    if (global.agentManager) {
      global.agentManager.sendSuccessNotification(
        'Modeller Güncellendi',
        'Model listesi başarıyla güncellendi.'
      );
    }
  }
  
  // server.js değişirse de tüm sistemi yeniden yükle
  if (normalizedPath === 'server.js') {
    console.log('server.js değişti, tüm sistem yeniden yükleniyor...');
    await reloadAllSystem();
  }
});

systemWatcher.on('add', (filePath) => {
  console.log(`System file added: ${filePath}`);
  const relativePath = path.relative(__dirname, filePath);
  const normalizedPath = relativePath.replace(/\\/g, '/');
  console.log(`  Relative path: ${normalizedPath}`);
});

systemWatcher.on('unlink', (filePath) => {
  console.log(`System file deleted: ${filePath}`);
  const relativePath = path.relative(__dirname, filePath);
  const normalizedPath = relativePath.replace(/\\/g, '/');
  console.log(`  Relative path: ${normalizedPath}`);
});

systemWatcher.on('addDir', (dirPath) => {
  console.log(`System directory added: ${dirPath}`);
  const relativePath = path.relative(__dirname, dirPath);
  const normalizedPath = relativePath.replace(/\\/g, '/');
  console.log(`  Relative path: ${normalizedPath}`);
});

systemWatcher.on('unlinkDir', (dirPath) => {
  console.log(`System directory deleted: ${dirPath}`);
  const relativePath = path.relative(__dirname, dirPath);
  const normalizedPath = relativePath.replace(/\\/g, '/');
  console.log(`  Relative path: ${normalizedPath}`);
});

// System watcher hatalarını yakala
systemWatcher.on('error', (error) => {
  console.error('System watcher error:', error);
  if (agentManager) {
    agentManager.sendErrorNotification('System File Watcher: Hata', 
      `Watcher hatası: ${error.message}\nDosya: ${error.path || 'Bilinmiyor'}\nKod: ${error.code || 'Bilinmiyor'}`);
  }
});

console.log('System file watcher initialized');

// Global hata yakalama (after agentManager is initialized)
process.on('uncaughtException', (error) => {
  console.error('Beklenmedik hata:', error);
  // Hata bildirimi gönder
  agentManager.sendErrorNotification(`Uncaught Exception: ${error.message}`, error.stack);
  
  // Kritik hata kontrolü - sadece sistem tamamen çökerse kurtarma devreye girsin
  if (isCriticalError(error)) {
    console.error('KRİTİK HATA TESPİT EDİLDİ - Otomatik kurtarma başlatılıyor...');
    performSystemRecovery();
  }
  // Hata olsa bile sunucuyu çalıştırmaya devam et (kritik değilse)
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('İşlenmemiş Promise reddi:', reason);
  // Hata bildirimi gönder
  const errorMessage = reason instanceof Error ? reason.message : String(reason);
  const errorDetails = reason instanceof Error ? reason.stack : '';
  agentManager.sendErrorNotification(`Unhandled Rejection: ${errorMessage}`, errorDetails);
  
  // Kritik hata kontrolü
  if (reason instanceof Error && isCriticalError(reason)) {
    console.error('KRİTİK HATA TESPİT EDİLDİ - Otomatik kurtarma başlatılıyor...');
    performSystemRecovery();
  }
  // Hata olsa bile sunucuyu çalıştırmaya devam et (kritik değilse)
});

/**
 * Kritik hata kontrolü - sadece sistem tamamen çökerse true döner
 */
function isCriticalError(error) {
  const criticalPatterns = [
    /EADDRINUSE/,           // Port zaten kullanımda
    /EACCES/,               // Erişim izni hatası
    /ENOMEM/,               // Bellek hatası
    /EPIPE/,                // Broken pipe
    /ECONNRESET/,           // Bağlantı resetlendi
    /ECONNREFUSED/,         // Bağlantı reddedildi
    /ETIMEDOUT/,            // Zaman aşımı
    /Fatal Error/,          // Fatal Node.js hataları
    /Segmentation fault/,   // Segmentasyon hatası
    /System crash/,         // Sistem çökmesi
    /OutOfMemory/           // Bellek yetersizliği
  ];
  
  const errorMessage = error.message || String(error);
  return criticalPatterns.some(pattern => pattern.test(errorMessage));
}

/**
 * Otomatik sistem kurtarma işlemi
 */
function performSystemRecovery() {
  try {
    console.log('Sistem kurtarma işlemi başlatılıyor...');
    
    const fs = require('fs');
    const path = require('path');
    const { execSync } = require('child_process');
    
    const backupDir = path.join(__dirname, 'system-backups');
    
    // En son yedeği bul
    if (!fs.existsSync(backupDir)) {
      console.error('Yedek dizini bulunamadı!');
      agentManager.sendErrorNotification('Kurtarma başarısız', 'Yedek dizini bulunamadı');
      return;
    }
    
    const backups = fs.readdirSync(backupDir)
      .filter(dir => dir.startsWith('backup-'))
      .sort()
      .reverse();
    
    if (backups.length === 0) {
      console.error('Yedek bulunamadı!');
      agentManager.sendErrorNotification('Kurtarma başarısız', 'Yedek bulunamadı');
      return;
    }
    
    const latestBackup = backups[0];
    const backupPath = path.join(backupDir, latestBackup);
    
    console.log(`Kurtarma için yedek kullanılıyor: ${latestBackup}`);
    
    // Kaynak dizinler
    const sourceDirs = ['src', 'public', 'plugins', 'data'];
    
    // Dizini kopyalama fonksiyonu
    const copyDirectory = (source, dest) => {
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
      }
      
      const entries = fs.readdirSync(source, { withFileTypes: true });
      entries.forEach(entry => {
        const srcPath = path.join(source, entry.name);
        const destPath = path.join(dest, entry.name);
        
        if (entry.isDirectory()) {
          copyDirectory(srcPath, destPath);
        } else {
          fs.copyFileSync(srcPath, destPath);
        }
      });
    };
    
    // Ana dosyaları geri yükle
    sourceDirs.forEach(dir => {
      const sourcePath = path.join(backupPath, dir);
      const destPath = path.join(__dirname, dir);
      
      if (fs.existsSync(sourcePath)) {
        // Hedef dizini temizle
        if (fs.existsSync(destPath)) {
          fs.rmSync(destPath, { recursive: true, force: true });
        }
        // Kopyala
        copyDirectory(sourcePath, destPath);
        console.log(`${dir} dizini geri yüklendi`);
      }
    });
    
    // Server.js ve package.json'u geri yükle
    if (fs.existsSync(path.join(backupPath, 'server.js'))) {
      fs.copyFileSync(path.join(backupPath, 'server.js'), path.join(__dirname, 'server.js'));
      console.log('server.js geri yüklendi');
    }
    
    if (fs.existsSync(path.join(backupPath, 'package.json'))) {
      fs.copyFileSync(path.join(backupPath, 'package.json'), path.join(__dirname, 'package.json'));
      console.log('package.json geri yüklendi');
    }
    
    console.log('Sistem dosyaları başarıyla geri yüklendi');
    agentManager.sendSuccessNotification(
      'Sistem kurtarma başarılı',
      `Yedekten geri yükleme tamamlandı: ${latestBackup}\nSistem yeniden başlatılıyor...`
    );
    
    // Sistemi yeniden başlat
    console.log('Sistem yeniden başlatılıyor...');
    setTimeout(() => {
      process.exit(1); // Sistemi yeniden başlatmak için çık
    }, 2000);
    
  } catch (error) {
    console.error('Kurtarma işlemi hatası:', error);
    agentManager.sendErrorNotification('Kurtarma işlemi başarısız', error.stack);
  }
}

// BackupManager üzerinden yönetilen global fonksiyonlar (geriye uyumluluk için)
global.checkFileError = async function(file) {
  if (global.backupManager) {
    return await global.backupManager.checkFileError(file);
  }
  return { success: false, error: 'BackupManager bulunamadı' };
};

global.checkAllFiles = async function() {
  if (global.backupManager) {
    return await global.backupManager.checkAllFiles();
  }
  return [];
};

// Restart backup system when settings change
const restartBackupSystem = () => {
  console.log('Backup sistemi yeniden başlatılıyor...');
  if (global.backupManager) {
    global.backupManager.restart();
  }
};

// API Routes
app.get('/api/agents', (req, res) => {
  const agents = agentManager.getAllAgents();
  res.json({ agents });
});

app.post('/api/agents', (req, res) => {
  const { name, prompt, useLiveAPI, model, provider, enabledTools } = req.body;
  
  if (!name || !prompt) {
    return res.status(400).json({ error: 'Name and prompt are required' });
  }
  
  // Force useLiveAPI to true for live model usage
  const agent = agentManager.createAgent(name, prompt, true, model || 'qwen3:0.6b', provider);
  
  // Set enabled tools if provided
  if (enabledTools && Array.isArray(enabledTools)) {
    agent.enabledTools = enabledTools;
    if (agent.dataManager) {
      agent.dataManager.saveAgent(agent);
    }
  }
  
  res.json({ agent: agent.toJSON() });
});

// Version API Route
app.get('/api/version', (req, res) => {
  try {
    res.json({ 
      version: packageJson.version,
      name: packageJson.name,
      description: packageJson.description
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Language API Routes
app.get('/api/language', (req, res) => {
  try {
    res.json({ 
      currentLanguage: lang.getLanguage(),
      availableLanguages: lang.getAvailableLanguages()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/language', (req, res) => {
  try {
    const { language } = req.body;
    if (!language) {
      return res.status(400).json({ error: 'Language is required' });
    }
    
    lang.setLanguage(language);
    configManager.set('language', language);
    
    res.json({ 
      success: true,
      currentLanguage: lang.getLanguage(),
      availableLanguages: lang.getAvailableLanguages()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Config API Routes
app.get('/api/config', (req, res) => {
  try {
    const config = configManager.getAll();
    // Return config without actual API keys for security
    const maskedConfig = {
      ...config,
      apiKeys: {
        google: '',
        gemini: '',
        hasGoogleKey: !!config.apiKeys.google,
        hasGeminiKey: !!config.apiKeys.gemini
      }
    };
    res.json({ config: maskedConfig });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/config/api-keys/:provider', (req, res) => {
  try {
    const { provider } = req.params;
    const apiKey = configManager.getApiKey(provider);
    if (apiKey) {
      res.json({ key: apiKey });
    } else {
      res.status(404).json({ error: 'API key not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/config', (req, res) => {
  try {
    const newConfig = req.body;
    configManager.update(newConfig);
    res.json({ success: true, config: configManager.getAll() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/config/api-keys', (req, res) => {
  try {
    const { provider, key } = req.body;
    if (!provider || !key) {
      return res.status(400).json({ error: 'Provider and key are required' });
    }
    configManager.setApiKey(provider, key);
    
    // Eğer Google veya Gemini API key güncellendiyse, AgentManager'ı güncelle
    if (provider === 'google' || provider === 'gemini') {
      const newApiKey = configManager.getApiKey('gemini') || configManager.getApiKey('google');
      if (global.agentManager) {
        global.agentManager.updateApiKey(newApiKey);
      }
    }
    
    res.json({ success: true, message: `API key for ${provider} updated` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/config/api-keys/:provider', (req, res) => {
  try {
    const { provider } = req.params;
    configManager.deleteApiKey(provider);
    
    // Eğer Google veya Gemini API key silindiyse, AgentManager'ı güncelle
    if (provider === 'google' || provider === 'gemini') {
      const newApiKey = configManager.getApiKey('gemini') || configManager.getApiKey('google');
      if (global.agentManager) {
        global.agentManager.updateApiKey(newApiKey);
      }
    }
    
    res.json({ success: true, message: `API key for ${provider} deleted` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/config/server', (req, res) => {
  try {
    const { port, host } = req.body;
    if (port !== undefined) {
      configManager.setPort(port);
    }
    if (host !== undefined) {
      configManager.setHost(host);
    }
    res.json({ success: true, config: configManager.get('server') });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Dinamik server restart endpoint
app.post('/api/server/restart', async (req, res) => {
  try {
    const { port, host } = req.body;
    
    if (!port || !host) {
      return res.status(400).json({ error: 'Port and host are required' });
    }
    
    // Yeni konfigürasyonu kaydet
    configManager.setPort(port);
    configManager.setHost(host);
    
    console.log(`🔄 Server konfigürasyonu değiştiriliyor: ${HOST}:${PORT} -> ${host}:${port}`);
    
    res.json({ 
      success: true, 
      message: 'Server konfigürasyonu güncellendi, yeniden başlatılıyor...',
      newConfig: { host, port },
      redirectUrl: `http://${host}:${port}`,
      estimatedTime: 10000 // 10 saniye tahmini süre
    });
    
    // Server durumunu izlemek için Socket.IO event'i
    io.emit('server-restarting', { 
      message: 'Server yeniden başlatılıyor',
      newUrl: `http://${host}:${port}`,
      estimatedTime: 10000
    });
    
    // Server'ı hemen kapat ve yeniden başlat
    console.log('🛑 Server kapatılıyor...');
    
    // Tüm socket bağlantılarını kapat
    io.close();
    
    // Server'ı zorla kapat
    server.closeAllConnections();
    
    setTimeout(() => {
      server.close(() => {
        console.log('✅ Server kapatıldı');
        
        // Yeni konfigürasyonla yeniden başlat
        server.listen(port, host, () => {
          console.log(`🚀 Server yeni konfigürasyonla başlatıldı: http://${host}:${port}`);
          console.log('✅ Server hazır, kullanıcılar yönlendirilebilir');
          
          // Server hazır olduğunda bildir
          io.emit('server-ready', {
            message: 'Server hazır',
            url: `http://${host}:${port}`
          });
        }).on('error', (error) => {
          console.error('❌ Server başlatma hatası:', error);
          // Hata durumunda eski konfigürasyonla geri dön
          configManager.setPort(PORT);
          configManager.setHost(HOST);
          console.log('🔄 Eski konfigürasyona geri dönülüyor');
          
          io.emit('server-error', {
            message: 'Server başlatma hatası',
            error: error.message
          });
        });
      });
    }, 1000); // 1 saniye bekleme ile kapatmayı garantile
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Server durum kontrol endpoint'i
app.get('/api/server/status', (req, res) => {
  res.json({ 
    status: 'running',
    host: HOST,
    port: PORT,
    url: `http://${HOST}:${PORT}`,
    timestamp: new Date().toISOString()
  });
});

app.put('/api/config/backup', (req, res) => {
  try {
    const settings = req.body;
    console.log('Received backup settings:', settings);
    console.log('Settings types:', {
      enabled: typeof settings.enabled,
      interval: typeof settings.interval,
      maxBackups: typeof settings.maxBackups
    });
    
    configManager.setBackupSettings(settings);
    const savedSettings = configManager.getBackupSettings();
    console.log('Saved backup settings:', savedSettings);
    
    // Restart backup system with new settings
    restartBackupSystem();
    
    res.json({ success: true, config: savedSettings });
  } catch (error) {
    console.error('Error saving backup settings:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/agents/:id', (req, res) => {
  const { id } = req.params;
  const success = agentManager.deleteAgent(id);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

app.post('/api/agents/:id/start', (req, res) => {
  const { id } = req.params;
  const success = agentManager.startAgent(id);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

app.post('/api/agents/:id/stop', (req, res) => {
  const { id } = req.params;
  const success = agentManager.stopAgent(id);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

app.put('/api/agents/:id', (req, res) => {
  const { id } = req.params;
  const { name, prompt, model, provider } = req.body;
  const success = agentManager.updateAgent(id, { name, prompt, model, provider });
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

app.post('/api/agents/:id/message', (req, res) => {
  const { id } = req.params;
  const { content } = req.body;
  
  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }
  
  const success = agentManager.sendMessageToAgent(id, content);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

app.get('/api/agents/:id/history', (req, res) => {
  const { id } = req.params;
  const history = agentManager.getAgentHistory(id);
  
  if (history !== null) {
    res.json({ history });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

app.delete('/api/agents/:id/history', (req, res) => {
  const { id } = req.params;
  const result = agentManager.clearAgentHistory(id);
  
  if (result.success) {
    res.json({ success: true });
  } else {
    res.status(400).json({ error: result.message });
  }
});

app.get('/api/agents/:id/status', (req, res) => {
  const { id } = req.params;
  const status = agentManager.getAgentStatus(id);
  
  if (status !== null) {
    res.json({ status });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

app.get('/api/agents/:id/queue', (req, res) => {
  const { id } = req.params;
  const queue = agentManager.getAgentQueue(id);

  if (queue !== null) {
    res.json({ queue });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

app.delete('/api/agents/:id/queue/:itemId', (req, res) => {
  const { id, itemId } = req.params;
  const result = agentManager.removeQueueItem(id, itemId);

  if (result.success) {
    res.json({ success: true, message: result.message });
  } else {
    res.status(400).json({ error: result.message });
  }
});

app.put('/api/agents/:id/queue/:itemId', (req, res) => {
  const { id, itemId } = req.params;
  const { content, label } = req.body;
  const result = agentManager.updateQueueItem(id, itemId, { content, label });

  if (result.success) {
    res.json({ success: true, message: result.message });
  } else {
    res.status(400).json({ error: result.message });
  }
});

app.post('/api/agents/:id/queue/:itemId/stop', (req, res) => {
  const { id, itemId } = req.params;
  const result = agentManager.stopQueueItem(id, itemId);

  if (result.success) {
    res.json({ success: true, message: result.message });
  } else {
    res.status(400).json({ error: result.message });
  }
});

app.delete('/api/agents/:id/queue', (req, res) => {
  const { id } = req.params;
  const result = agentManager.clearAgentQueue(id);

  if (result.success) {
    res.json({ success: true, message: 'Kuyruk başarıyla temizlendi.' });
  } else {
    res.status(400).json({ error: result.message });
  }
});

// Cron Task Routes
app.get('/api/cron-tasks', (req, res) => {
  const tasks = cronManager.getAllTasks();
  res.json({ tasks });
});

app.post('/api/cron-tasks', (req, res) => {
  const { agentId, schedule, message, name } = req.body;
  
  if (!agentId || !schedule || !message || !name) {
    return res.status(400).json({ error: 'agentId, schedule, message, and name are required' });
  }
  
  const task = cronManager.createTask(agentId, schedule, message, name);
  res.json({ task: task.toJSON() });
});

app.delete('/api/cron-tasks/:id', (req, res) => {
  const { id } = req.params;
  const success = cronManager.deleteTask(id);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Task not found' });
  }
});

app.post('/api/cron-tasks/:id/start', (req, res) => {
  const { id } = req.params;
  const success = cronManager.startTask(id);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Task not found' });
  }
});

app.post('/api/cron-tasks/:id/stop', (req, res) => {
  const { id } = req.params;
  const success = cronManager.stopTask(id);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Task not found' });
  }
});

app.post('/api/cron-tasks/:id/pause', (req, res) => {
  const { id } = req.params;
  const success = cronManager.pauseTask(id);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Task not found' });
  }
});

app.post('/api/cron-tasks/:id/resume', (req, res) => {
  const { id } = req.params;
  const success = cronManager.resumeTask(id);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Task not found' });
  }
});

app.put('/api/cron-tasks/:id/schedule', (req, res) => {
  const { id } = req.params;
  const { schedule } = req.body;
  
  if (!schedule) {
    return res.status(400).json({ error: 'schedule is required' });
  }
  
  const success = cronManager.updateTaskSchedule(id, schedule);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Task not found' });
  }
});

app.put('/api/cron-tasks/:id/message', (req, res) => {
  const { id } = req.params;
  const { message } = req.body;
  
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }
  
  const success = cronManager.updateTaskMessage(id, message);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Task not found' });
  }
});

app.get('/api/agents/:id/cron-tasks', (req, res) => {
  const { id } = req.params;
  const tasks = cronManager.getTasksByAgent(id);
  res.json({ tasks });
});

// Tool Management Routes
app.get('/api/tools', (req, res) => {
  const tools = agentManager.getAvailableTools();
  res.json({ tools });
});

app.get('/api/agents/:id/tools', (req, res) => {
  const { id } = req.params;
  const enabledTools = agentManager.getEnabledTools(id);
  
  if (enabledTools !== null) {
    res.json({ enabledTools });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

app.post('/api/agents/:id/tools/enable', (req, res) => {
  const { id } = req.params;
  const { toolName } = req.body;
  
  if (!toolName) {
    return res.status(400).json({ error: 'toolName is required' });
  }
  
  const success = agentManager.enableTool(id, toolName);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

app.post('/api/agents/:id/tools/disable', (req, res) => {
  const { id } = req.params;
  const { toolName } = req.body;
  
  if (!toolName) {
    return res.status(400).json({ error: 'toolName is required' });
  }
  
  const success = agentManager.disableTool(id, toolName);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Agent not found' });
  }
});

// Model Management Routes
app.get('/api/models', (req, res) => {
  try {
    const models = global.modelManager.getAllModels();
    const providers = global.modelManager.getAllProviders();
    res.json({ models, providers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/models/providers', (req, res) => {
  try {
    const providers = global.modelManager.getAllProviders();
    res.json({ providers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/models/providers/:providerId', (req, res) => {
  try {
    const { providerId } = req.params;
    const provider = global.modelManager.getProvider(providerId);
    if (!provider) {
      return res.status(404).json({ error: 'Provider not found' });
    }
    res.json({ provider });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/models/providers/:providerId/models', (req, res) => {
  try {
    const { providerId } = req.params;
    const models = global.modelManager.getProviderModels(providerId);
    res.json({ models });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/models/providers', (req, res) => {
  try {
    const { providerId, name } = req.body;
    if (!providerId || !name) {
      return res.status(400).json({ error: 'providerId and name are required' });
    }
    
    const result = global.modelManager.addProvider(providerId, name);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({ success: true, provider: result.provider });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/models/providers/:providerId', (req, res) => {
  try {
    const { providerId } = req.params;
    const result = global.modelManager.deleteProvider(providerId);
    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/models/providers/:providerId/models', (req, res) => {
  try {
    const { providerId } = req.params;
    const { id, name, description, default: isDefault, supportsThinking } = req.body;
    
    if (!id || !name) {
      return res.status(400).json({ error: 'id and name are required' });
    }
    
    const result = global.modelManager.addModel(providerId, { id, name, description, default: isDefault, supportsThinking });
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    
    res.json({ success: true, model: result.model });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/models/providers/:providerId/models/:modelId', (req, res) => {
  try {
    const { providerId, modelId } = req.params;
    const { id, name, description, default: isDefault, supportsThinking } = req.body;
    
    const result = global.modelManager.updateModel(providerId, modelId, { id, name, description, default: isDefault, supportsThinking });
    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }
    
    res.json({ success: true, model: result.model });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/models/providers/:providerId/models/:modelId', (req, res) => {
  try {
    const { providerId, modelId } = req.params;
    const result = global.modelManager.deleteModel(providerId, modelId);
    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/models/providers/:providerId/models/:modelId/default', (req, res) => {
  try {
    const { providerId, modelId } = req.params;
    const result = global.modelManager.setDefaultModel(providerId, modelId);
    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }
    
    res.json({ success: true, model: result.model });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/models/providers/:providerId/default', (req, res) => {
  try {
    const { providerId } = req.params;
    const model = global.modelManager.getDefaultModel(providerId);
    if (!model) {
      return res.status(404).json({ error: 'No default model found' });
    }
    res.json({ model });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Agent model selection endpoint - Get all available models for agent creation
app.get('/api/agents/available-models', (req, res) => {
  try {
    const models = agentManager.getAllAvailableModels();
    const providers = agentManager.getAllProviders();
    res.json({ models, providers });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get agent true-live status
app.get('/api/agents/:id/true-live-status', (req, res) => {
  const { id } = req.params;
  const agent = agentManager.getAgent(id);
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const trueLiveMode = !!(agent.isTrueLiveMode || agent.trueLiveMode);
  const isLiveSessionActive = !!agent.isLiveSessionActive;
  const connectionStatus = agent.connectionStatus || (isLiveSessionActive ? 'connected' : 'disconnected');
  const uptime = agent.uptimeSeconds || 0;

  res.json({ 
    trueLiveMode,
    isTrueLiveMode: trueLiveMode,
    isLiveSessionActive,
    connectionStatus,
    uptime
  });
});

// Error Notification Management Routes
app.get('/api/error-notification-agents', (req, res) => {
  const agentIds = agentManager.getErrorNotificationAgents();
  res.json({ agentIds });
});

app.post('/api/error-notification-agents/:agentId', (req, res) => {
  const { agentId } = req.params;
  
  // Check if agent exists
  const agent = agentManager.getAgent(agentId);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const success = agentManager.addErrorNotificationAgent(agentId);
  
  if (success) {
    res.json({ success: true, message: 'Agent added to error notifications' });
  } else {
    res.status(400).json({ error: 'Agent already in error notifications' });
  }
});

app.delete('/api/error-notification-agents/:agentId', (req, res) => {
  const { agentId } = req.params;
  const success = agentManager.removeErrorNotificationAgent(agentId);
  
  if (success) {
    res.json({ success: true, message: 'Agent removed from error notifications' });
  } else {
    res.status(404).json({ error: 'Agent not in error notifications' });
  }
});

app.post('/api/test-error-notification', (req, res) => {
  const { message, details } = req.body;
  const testMessage = message || 'Test hata mesajı';
  const testDetails = details || 'Bu bir testtir';
  
  agentManager.sendErrorNotification(testMessage, testDetails);
  
  res.json({ success: true, message: 'Test error notification sent' });
});

// Update Management Routes
app.get('/api/update/check', async (req, res) => {
  try {
    const updateInfo = await global.updateManager.checkForUpdates();
    res.json(updateInfo);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/update/status', (req, res) => {
  try {
    const status = global.updateManager.getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/update/start', async (req, res) => {
  try {
    // Güncelleme işlemini arka planda başlat
    global.updateManager.performUpdate().then(result => {
      // Sonuç Socket.IO üzerinden bildirilecek
    }).catch(error => {
      console.error('Güncelleme hatası:', error);
    });
    
    res.json({ success: true, message: 'Güncelleme başlatıldı' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/update/github-config', (req, res) => {
  try {
    const { owner, repo } = req.body;
    if (!owner || !repo) {
      return res.status(400).json({ error: 'Owner and repo are required' });
    }
    
    global.updateManager.setGitHubRepository(owner, repo);
    res.json({ success: true, message: 'GitHub repository configuration updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Plugin Management Routes
app.get('/api/plugins', (req, res) => {
  const plugins = agentManager.getAllPluginsInfo();
  res.json({ plugins });
});

// True Live Mode Routes
app.post('/api/agents/:id/true-live-mode', (req, res) => {
  const { id } = req.params;
  const { enabled } = req.body;
  
  const success = agentManager.setAgentTrueLiveMode(id, enabled);
  
  if (success) {
    res.json({ success: true, enabled });
  } else {
    res.status(404).json({ error: 'Agent not found or does not support true live mode' });
  }
});

app.post('/api/agents/:id/start-true-live-session', async (req, res) => {
  const { id } = req.params;
  
  try {
    const success = await agentManager.startAgentTrueLiveSession(id, null);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Agent not found or does not support true live mode' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/agents/:id/stop-true-live-session', (req, res) => {
  const { id } = req.params;
  
  const success = agentManager.stopAgentTrueLiveSession(id);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Agent not found or does not support true live mode' });
  }
});

app.get('/api/plugins/:name', (req, res) => {
  const { name } = req.params;
  const plugin = agentManager.getPluginInfo(name);
  
  if (plugin) {
    res.json({ plugin });
  } else {
    res.status(404).json({ error: 'Plugin not found' });
  }
});

app.post('/api/plugins/:name/enable', async (req, res) => {
  const { name } = req.params;
  
  try {
    await agentManager.enablePlugin(name);
    res.json({ success: true, message: `Plugin ${name} enabled` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/plugins/:name/disable', async (req, res) => {
  const { name } = req.params;
  
  try {
    await agentManager.disablePlugin(name);
    res.json({ success: true, message: `Plugin ${name} disabled` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/plugins/:name/reload', async (req, res) => {
  const { name } = req.params;
  
  try {
    await agentManager.reloadPlugin(name);
    res.json({ success: true, message: `Plugin ${name} reloaded` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 404 handler
app.use((req, res, next) => {
  // Ignore Chrome DevTools and other system requests
  const ignoredPaths = [
    '/.well-known/',
    '/favicon.ico',
    '/robots.txt'
  ];
  
  const shouldIgnore = ignoredPaths.some(path => req.originalUrl.startsWith(path));
  
  if (shouldIgnore) {
    return res.status(404).end();
  }
  
  const error = new Error(`Not Found - ${req.originalUrl}`);
  error.status = 404;
  next(error);
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Express error:', err);
  
  // Don't send error notifications for ignored paths
  const ignoredPaths = [
    '/.well-known/',
    '/favicon.ico',
    '/robots.txt'
  ];
  
  const shouldIgnore = ignoredPaths.some(path => req.originalUrl?.startsWith(path));
  
  if (!shouldIgnore) {
    // Send error notification
    const errorMessage = err.message || 'Unknown error';
    const errorDetails = err.stack || '';
    agentManager.sendErrorNotification(`Express Error: ${errorMessage}`, errorDetails);
  }
  
  res.status(err.status || 500);
  res.json({
    error: {
      message: err.message || 'Unknown error',
      status: err.status || 500
    }
  });
});

// Socket.IO Connection Handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Send current agents status to new client
  socket.emit('agents-status', {
    agents: agentManager.getAllAgents()
  });
  
  // Create Agent
  socket.on('create-agent', ({ name, prompt, model, enabledTools }) => {
    const agent = agentManager.createAgent(name, prompt, true, model || 'gemini-3.1-flash-live-preview');
    
    // Set enabled tools if provided
    if (enabledTools && Array.isArray(enabledTools)) {
      agent.enabledTools = enabledTools;
      if (agent.dataManager) {
        agent.dataManager.saveAgent(agent);
      }
    }
    
    socket.emit('agent-created', { agent: agent.toJSON() });
  });
  
  // Delete Agent
  socket.on('delete-agent', ({ agentId }) => {
    agentManager.deleteAgent(agentId);
  });
  
  // Start Agent
  socket.on('start-agent', ({ agentId }) => {
    agentManager.startAgent(agentId);
  });
  
  // Stop Agent
  socket.on('stop-agent', ({ agentId }) => {
    agentManager.stopAgent(agentId);
  });
  
  // Update Agent (name, prompt, model)
  socket.on('update-agent', ({ agentId, name, prompt, model }) => {
    agentManager.updateAgent(agentId, { name, prompt, model });
  });
  
  // Restart Agent (triggered by agent reconnection)
  socket.on('agent-reconnected', async ({ agentId }) => {
    console.log(`Agent ${agentId} reconnected, restarting via server`);
    await agentManager.restartAgent(agentId);
  });
  
  // Restart Agent (triggered by agent reconnection)
  socket.on('agent-reconnected', ({ agentId }) => {
    console.log(`Agent ${agentId} reconnected, restarting via server`);
    agentManager.restartAgent(agentId);
  });
  
  // Send Message to Agent
  socket.on('send-message', ({ agentId, content }) => {
    agentManager.sendMessageToAgent(agentId, content);
  });
  
  // Get Agent History
  socket.on('get-history', ({ agentId }) => {
    const history = agentManager.getAgentHistory(agentId);
    socket.emit('agent-history', { agentId, history });
  });

  // Clear Agent History
  socket.on('clear-history', ({ agentId }) => {
    const result = agentManager.clearAgentHistory(agentId);
    if (!result.success) {
      socket.emit('agent-error', { 
        agentId, 
        error: result.message 
      });
    }
  });
  
  // Request Status Update
  socket.on('request-status', () => {
    agentManager.broadcastStatus();
  });

  // Request Agent Queue
  socket.on('request-agent-queue', ({ agentId }) => {
    const queue = agentManager.getAgentQueue(agentId);
    if (queue !== null) {
      socket.emit('agent-queue-update', { agentId, queue });
    }
  });
  
  // Cron Task Events
  socket.on('create-cron-task', ({ agentId, schedule, message, name }) => {
    const task = cronManager.createTask(agentId, schedule, message, name);
    socket.emit('cron-task-created', { task: task.toJSON() });
  });
  
  socket.on('delete-cron-task', ({ taskId }) => {
    cronManager.deleteTask(taskId);
  });
  
  socket.on('start-cron-task', ({ taskId }) => {
    cronManager.startTask(taskId);
  });
  
  socket.on('stop-cron-task', ({ taskId }) => {
    cronManager.stopTask(taskId);
  });
  
  socket.on('pause-cron-task', ({ taskId }) => {
    cronManager.pauseTask(taskId);
  });
  
  socket.on('resume-cron-task', ({ taskId }) => {
    cronManager.resumeTask(taskId);
  });
  
  socket.on('update-cron-task-schedule', ({ taskId, schedule }) => {
    cronManager.updateTaskSchedule(taskId, schedule);
  });
  
  socket.on('update-cron-task-message', ({ taskId, message }) => {
    cronManager.updateTaskMessage(taskId, message);
  });
  
  socket.on('update-cron-task', ({ taskId, name, agentId, schedule, message }) => {
    cronManager.updateTaskSchedule(taskId, schedule);
    cronManager.updateTaskMessage(taskId, message);
    if (name) cronManager.updateTaskName(taskId, name);
    if (agentId) cronManager.updateTaskAgent(taskId, agentId);
  });
  
  socket.on('request-cron-tasks', () => {
    cronManager.broadcastStatus();
  });
  
  // Python Process Management
  socket.on('request-python-processes', () => {
    // Broadcast all Python processes status
    const agents = agentManager.getAllAgents();
    agents.forEach(agent => {
      if (agent.toolManager && agent.toolManager.pythonProcessManager) {
        const processes = agent.toolManager.pythonProcessManager.getAllProcesses();
        socket.emit('python-processes-status', {
          agentId: agent.id,
          processes: processes
        });
      }
    });
  });
  
  // Shell Process Management
  socket.on('request-shell-processes', () => {
    // Broadcast all Shell processes status
    const agents = agentManager.getAllAgents();
    agents.forEach(agent => {
      if (agent.toolManager && agent.toolManager.shellProcessManager) {
        const processes = agent.toolManager.shellProcessManager.getAllProcesses();
        socket.emit('shell-processes-status', {
          agentId: agent.id,
          processes: processes
        });
      }
    });
  });
  
  // Live Session Management (works for all models)
  socket.on('start-live-session', ({ agentId }) => {
    const agent = agentManager.getAgent(agentId);
    if (agent && typeof agent.startLiveSession === 'function') {
      agent.startLiveSession(socket);
      socket.emit('live-session-started', { agentId });
    }
  });

  socket.on('stop-live-session', ({ agentId }) => {
    const agent = agentManager.getAgent(agentId);
    if (agent && typeof agent.stopLiveSession === 'function') {
      agent.stopLiveSession();
      socket.emit('live-session-stopped', { agentId });
    }
  });

  socket.on('live-audio-input', ({ agentId, audioData }) => {
    const agent = agentManager.getAgent(agentId);
    if (agent && typeof agent.handleLiveAudioInput === 'function') {
      agent.handleLiveAudioInput(audioData);
    }
  });

  // Manual Reconnect Handler
  socket.on('manual-reconnect-live', async ({ agentId }) => {
    const agent = agentManager.getAgent(agentId);
    if (agent && typeof agent.manualReconnect === 'function') {
      try {
        await agent.manualReconnect();
        socket.emit('live-connection-status', {
          agentId,
          status: 'connecting',
          message: 'Manuel yeniden bağlanma başlatıldı'
        });
      } catch (error) {
        socket.emit('live-connection-status', {
          agentId,
          status: 'disconnected',
          message: 'Manuel yeniden bağlanma başarısız: ' + error.message
        });
      }
    }
  });

  // Test Disconnect Handler (for testing)
  socket.on('test-disconnect-live', ({ agentId }) => {
    const agent = agentManager.getAgent(agentId);
    if (agent && agent.liveSession) {
      console.log('Test disconnect requested for agent:', agentId);
      // Simulate connection drop
      if (typeof agent._handleConnectionDrop === 'function') {
        agent._handleConnectionDrop('Test kesintisi (kullanıcı tarafından test edildi)');
      }
    }
  });

  // True Live Mode - Buton kontrolü ile çalışan özel live mod
  socket.on('set-true-live-mode', ({ agentId, enabled }) => {
    const success = agentManager.setAgentTrueLiveMode(agentId, enabled);
    socket.emit('true-live-mode-set', { agentId, enabled, success });
  });

  socket.on('start-true-live-session', ({ agentId }) => {
    agentManager.startAgentTrueLiveSession(agentId, socket).then(success => {
      socket.emit('true-live-session-started', { agentId, success });
    }).catch(error => {
      socket.emit('true-live-session-error', { agentId, error: error.message });
    });
  });

  socket.on('stop-true-live-session', ({ agentId }) => {
    const success = agentManager.stopAgentTrueLiveSession(agentId);
    socket.emit('true-live-session-stopped', { agentId, success });
  });

  socket.on('true-live-audio-input', ({ agentId, audioData }) => {
    agentManager.handleAgentTrueLiveAudioInput(agentId, audioData);
  });

  socket.on('true-live-text-input', ({ agentId, text }) => {
    agentManager.handleAgentTrueLiveTextInput(agentId, text);
  });

  // Update Management Events
  socket.on('check-update', async () => {
    try {
      const updateInfo = await global.updateManager.checkForUpdates();
      socket.emit('update-check-result', updateInfo);
    } catch (error) {
      socket.emit('update-error', { error: error.message });
    }
  });

  socket.on('start-update', async () => {
    try {
      await global.updateManager.performUpdate();
    } catch (error) {
      socket.emit('update-error', { error: error.message });
    }
  });

  socket.on('get-update-status', () => {
    const status = global.updateManager.getStatus();
    socket.emit('update-status', status);
  });

  socket.on('set-github-config', ({ owner, repo }) => {
    try {
      global.updateManager.setGitHubRepository(owner, repo);
      socket.emit('github-config-set', { success: true });
    } catch (error) {
      socket.emit('update-error', { error: error.message });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });

  // Error handling for socket
  socket.on('error', (error) => {
    console.error('Socket error:', error);
    agentManager.sendErrorNotification('Socket bağlantı hatası', error.stack);
  });
});

// Start Server
const PORT = configManager.getPort();
const HOST = configManager.getHost();

// Dinamik server konfigürasyonu değiştirme
let currentServerConfig = { port: PORT, host: HOST };

app.post('/api/server/restart', async (req, res) => {
  try {
    const { port, host } = req.body;
    
    if (!port || !host) {
      return res.status(400).json({ error: 'Port and host are required' });
    }
    
    // Yeni konfigürasyonu kaydet
    configManager.setPort(port);
    configManager.setHost(host);
    
    console.log(`🔄 Server konfigürasyonu değiştiriliyor: ${currentServerConfig.host}:${currentServerConfig.port} -> ${host}:${port}`);
    
    // Yeni konfigürasyonu güncelle
    currentServerConfig = { port, host };
    
    res.json({ 
      success: true, 
      message: 'Server konfigürasyonu güncellendi',
      newConfig: { host, port },
      redirectUrl: `http://${host}:${port}`
    });
    
    // Server'ı kapat ve yeniden başlat
    setTimeout(() => {
      console.log('🛑 Server kapatılıyor...');
      server.close(() => {
        console.log('✅ Server kapatıldı');
        
        // Yeni konfigürasyonla yeniden başlat
        server.listen(port, host, () => {
          console.log(`🚀 Server yeni konfigürasyonla başlatıldı: http://${host}:${port}`);
        }).on('error', (error) => {
          console.error('❌ Server başlatma hatası:', error);
          // Hata durumunda eski konfigürasyonla geri dön
          configManager.setPort(currentServerConfig.port);
          configManager.setHost(currentServerConfig.host);
        });
      });
    }, 5000); // 5 saniye sonra kapat ve yeniden başlat
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`AzerClaw server running on http://${HOST}:${PORT}`);
  console.log(`Google API Key: ${configManager.hasApiKey('google') ? 'Set' : 'Not set'}`);
  console.log(`Gemini API Key: ${configManager.hasApiKey('gemini') ? 'Set' : 'Not set'}`);
  console.log(`Backup: ${configManager.isBackupEnabled() ? 'Enabled' : 'Disabled'} (${configManager.getBackupInterval()} min interval, max ${configManager.getMaxBackups()} backups)`);
}).on('error', (error) => {
  console.error('Server error:', error);
  agentManager.sendErrorNotification('Sunucu başlatma hatası', error.stack);
  
  // Kritik sunucu hatası durumunda kurtarma
  if (isCriticalError(error)) {
    console.error('KRİTİK SUNUCU HATASI - Otomatik kurtarma başlatılıyor...');
    performSystemRecovery();
  }
});

// Sunucu çökme durumunda kurtarma
process.on('exit', (code) => {
  if (code !== 0 && code !== 130) { // 130 = SIGINT (Ctrl+C)
    console.log(`Sunucu abnormal şekilde çıktı. Kod: ${code}`);
    // Kurtarma işlemi zaten kritik hata yakalayıcıda tetiklenmiş olacak
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  agentManager.sendErrorNotification('SIGTERM sinyali alındı - Sunucu kapanıyor', 'Graceful shutdown initiated');
  
  // Stop all plugin watchers
  const PluginManager = require('./src/tools/PluginManager');
  PluginManager.stopAllWatchers();
  
  // Stop system watcher
  if (systemWatcher) {
    systemWatcher.close();
    console.log('System file watcher stopped');
  }
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  agentManager.sendErrorNotification('SIGINT sinyali alındı - Sunucu kapanıyor', 'Graceful shutdown initiated');
  
  // Stop all plugin watchers
  const PluginManager = require('./src/tools/PluginManager');
  PluginManager.stopAllWatchers();
  
  // Stop system watcher
  if (systemWatcher) {
    systemWatcher.close();
    console.log('System file watcher stopped');
  }
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});