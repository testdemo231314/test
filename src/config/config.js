/**
 * ConfigManager - Uygulama ayarlarını yöneten sınıf
 */

const fs = require('fs');
const path = require('path');

class ConfigManager {
  constructor() {
    this.configPath = path.join(__dirname, '../../data/config.json');
    this.config = this.loadConfig();
  }

  /**
   * Config dosyasını yükler
   */
  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        return JSON.parse(data);
      } else {
        // Varsayılan config oluştur
        const defaultConfig = this.getDefaultConfig();
        this.saveConfig(defaultConfig);
        return defaultConfig;
      }
    } catch (error) {
      console.error('Config yüklenirken hata:', error);
      return this.getDefaultConfig();
    }
  }

  /**
   * Varsayılan config
   */
  getDefaultConfig() {
    return {
      server: {
        port: 3000,
        host: 'localhost'
      },
      apiKeys: {
        google: '',
        gemini: ''
      },
      backup: {
        enabled: true,
        interval: 5,
        maxBackups: 3
      },
      language: 'tr'
    };
  }

  /**
   * Config dosyasını kaydeder
   */
  saveConfig(config = this.config) {
    try {
      // data dizini yoksa oluştur
      const dataDir = path.dirname(this.configPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
      this.config = config;
      return true;
    } catch (error) {
      console.error('Config kaydedilirken hata:', error);
      return false;
    }
  }

  /**
   * Config değerini alır
   */
  get(key) {
    const keys = key.split('.');
    let value = this.config;
    
    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k];
      } else {
        return undefined;
      }
    }
    
    return value;
  }

  /**
   * Config değerini ayarlar
   */
  set(key, value) {
    const keys = key.split('.');
    let obj = this.config;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in obj) || typeof obj[k] !== 'object') {
        obj[k] = {};
      }
      obj = obj[k];
    }
    
    obj[keys[keys.length - 1]] = value;
    return this.saveConfig();
  }

  /**
   * Config değerini siler
   */
  delete(key) {
    const keys = key.split('.');
    let obj = this.config;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (!(k in obj) || typeof obj[k] !== 'object') {
        return false;
      }
      obj = obj[k];
    }
    
    const lastKey = keys[keys.length - 1];
    if (lastKey in obj) {
      delete obj[lastKey];
      return this.saveConfig();
    }
    
    return false;
  }

  /**
   * Tüm config'i döndürür
   */
  getAll() {
    return { ...this.config };
  }

  /**
   * Config'i günceller
   */
  update(newConfig) {
    this.config = { ...this.config, ...newConfig };
    return this.saveConfig();
  }

  /**
   * Config'i sıfırlar (varsayılan değerlere döner)
   */
  reset() {
    this.config = this.getDefaultConfig();
    return this.saveConfig();
  }

  /**
   * API Key kontrolü
   */
  hasApiKey(provider = 'google') {
    const key = this.get(`apiKeys.${provider}`);
    return key && key.length > 0;
  }

  /**
   * API Key al
   */
  getApiKey(provider = 'google') {
    return this.get(`apiKeys.${provider}`) || '';
  }

  /**
   * API Key ayarla
   */
  setApiKey(provider, key) {
    return this.set(`apiKeys.${provider}`, key);
  }

  /**
   * API Key sil
   */
  deleteApiKey(provider) {
    return this.delete(`apiKeys.${provider}`);
  }

  /**
   * Port al
   */
  getPort() {
    return this.get('server.port') || 3000;
  }

  /**
   * Port ayarla
   */
  setPort(port) {
    return this.set('server.port', parseInt(port));
  }

  /**
   * Host al
   */
  getHost() {
    return this.get('server.host') || 'localhost';
  }

  /**
   * Host ayarla
   */
  setHost(host) {
    return this.set('server.host', host);
  }

  /**
   * Backup ayarları al
   */
  getBackupSettings() {
    return this.get('backup') || {
      enabled: true,
      interval: 5,
      maxBackups: 3
    };
  }

  /**
   * Backup ayarlarını güncelle
   */
  setBackupSettings(settings) {
    return this.set('backup', settings);
  }

  /**
   * Backup enabled kontrolü
   */
  isBackupEnabled() {
    return this.get('backup.enabled') !== false;
  }

  /**
   * Backup interval al
   */
  getBackupInterval() {
    return this.get('backup.interval') || 5;
  }

  /**
   * Backup max backups al
   */
  getMaxBackups() {
    return this.get('backup.maxBackups') || 3;
  }
}

// Singleton instance
let configManagerInstance = null;

/**
 * ConfigManager singleton instance'ını döndürür
 */
function getConfigManager() {
  if (!configManagerInstance) {
    configManagerInstance = new ConfigManager();
  }
  return configManagerInstance;
}

module.exports = { ConfigManager, getConfigManager };
