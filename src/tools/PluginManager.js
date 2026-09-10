/**
 * PluginManager - Plugin yükleme ve yönetim sistemi
 */

const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const decache = require('decache');

class PluginManager {
  // Static array to track all instances for cleanup
  static instances = [];
  
  constructor(io, cronManager = null, agentManager = null) {
    this.plugins = new Map();
    this.io = io;
    this.cronManager = cronManager;
    this.agentManager = agentManager;
    this.pluginsDir = path.join(__dirname, '../../plugins');
    this.watcher = null;
    this.initializeWatcher();
    
    // Register instance for cleanup
    PluginManager.instances.push(this);
  }

  /**
   * Tüm pluginleri yükler
   */
  async loadAllPlugins() {
    try {
      const pluginDirs = this.getPluginDirectories();
      
      for (const pluginDir of pluginDirs) {
        await this.loadPlugin(pluginDir);
      }
      
      console.log(`Loaded ${this.plugins.size} plugins`);
      return this.plugins;
    } catch (error) {
      console.error('Error loading plugins:', error);
      if (this.agentManager) {
        this.agentManager.sendErrorNotification('Plugin Manager: Tüm pluginleri yükleme hatası', error.stack);
      }
      throw error;
    }
  }

  /**
   * Plugin dizinlerini bulur
   */
  getPluginDirectories() {
    if (!fs.existsSync(this.pluginsDir)) {
      console.log('Plugins directory does not exist');
      return [];
    }

    const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  }

  /**
   * Tek bir plugin yükler
   */
  async loadPlugin(pluginName) {
    try {
      const pluginPath = path.join(this.pluginsDir, pluginName);
      const mainPath = path.join(pluginPath, 'main.js');
      const infoPath = path.join(pluginPath, 'info.json');

      // Check if main.js exists
      if (!fs.existsSync(mainPath)) {
        console.warn(`Plugin ${pluginName} missing main.js, skipping`);
        if (this.agentManager) {
          this.agentManager.sendErrorNotification(`Plugin Manager: ${pluginName} main.js dosyası eksik`, `Plugin dizini: ${pluginPath}`);
        }
        return null;
      }

      // Load info.json if exists
      let config = {
        name: pluginName,
        version: '1.0.0',
        description: '',
        author: 'Unknown',
        category: 'utility',
        enabled: true
      };

      if (fs.existsSync(infoPath)) {
        try {
          const infoData = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
          config = { ...config, ...infoData };
        } catch (error) {
          console.error(`Error parsing info.json for ${pluginName}:`, error);
          if (this.agentManager) {
            this.agentManager.sendErrorNotification(`Plugin Manager: ${pluginName} info.json parse hatası`, error.stack);
          }
        }
      }

      // Decache all JS files in the plugin directory before loading
      const pluginFiles = fs.readdirSync(pluginPath);
      pluginFiles.forEach(file => {
        if (file.endsWith('.js')) {
          const filePath = path.join(pluginPath, file);
          decache(filePath);
        }
      });

      // Load plugin main class
      const PluginClass = require(mainPath);
      
      // Create plugin instance with dependencies
      let pluginInstance;
      try {
        const effectiveCronManager = this.cronManager || global.cronManager;
        if (this.needsCronManager(pluginName)) {
          pluginInstance = new PluginClass(effectiveCronManager);
        } else if (this.needsAgentManager(pluginName)) {
          pluginInstance = new PluginClass(this.agentManager);
        } else {
          pluginInstance = new PluginClass(this.io);
        }
      } catch (error) {
        console.error(`Error creating plugin instance ${pluginName}:`, error);
        if (this.agentManager) {
          this.agentManager.sendErrorNotification(`Plugin Manager: ${pluginName} instance oluşturma hatası`, error.stack);
        }
        return null;
      }

      // Check if plugin is enabled
      const isEnabled = config.enabled !== false;
      if (!isEnabled) {
        console.log(`Plugin ${pluginName} is disabled, loading but not registering tools`);
      }

      // Get tools from plugin
      const tools = isEnabled ? pluginInstance.getTools() : {};

      // Store plugin
      this.plugins.set(pluginName, {
        name: pluginName,
        version: config.version,
        description: config.description,
        author: config.author,
        category: config.category,
        config: config,
        instance: pluginInstance,
        tools: tools,
        enabled: isEnabled,
        toolNames: Object.keys(tools)
      });

      console.log(`Loaded plugin: ${pluginName} v${config.version} ${isEnabled ? '(enabled)' : '(disabled)'}`);
      return this.plugins.get(pluginName);
    } catch (error) {
      console.error(`Error loading plugin ${pluginName}:`, error);
      if (this.agentManager) {
        this.agentManager.sendErrorNotification(`Plugin Manager: ${pluginName} plugin yükleme hatası`, error.stack);
      }
      return null;
    }
  }

  /**
   * Plugin'in hangi dependency'ye ihtiyacı olduğunu belirler
   */
  needsCronManager(pluginName) {
    return ['cron'].includes(pluginName);
  }

  needsAgentManager(pluginName) {
    return ['agent'].includes(pluginName);
  }

  setCronManager(cronManager) {
    this.cronManager = cronManager;
    this.plugins.forEach((plugin, pluginName) => {
      if (this.needsCronManager(pluginName) && plugin.instance) {
        plugin.instance.cronManager = cronManager;
      }
    });
  }

  /**
   * Plugin'i yeniden yükler
   */
  async reloadPlugin(pluginName) {
    this.unloadPlugin(pluginName);
    return await this.loadPlugin(pluginName);
  }

  /**
   * Plugin'i kaldırır
   */
  unloadPlugin(pluginName) {
    const plugin = this.plugins.get(pluginName);
    if (plugin) {
      this.plugins.delete(pluginName);
      console.log(`Unloaded plugin: ${pluginName}`);
      return true;
    }
    return false;
  }

  /**
   * Tüm pluginleri kaldırır
   */
  unloadAllPlugins() {
    const pluginNames = Array.from(this.plugins.keys());
    pluginNames.forEach(name => this.unloadPlugin(name));
    console.log('Unloaded all plugins');
  }

  /**
   * Plugin bilgilerini döndürür
   */
  getPluginInfo(pluginName) {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      return null;
    }

    return {
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      author: plugin.author,
      category: plugin.category,
      tools: plugin.toolNames || Object.keys(plugin.tools),
      enabled: plugin.enabled !== false
    };
  }

  /**
   * Tüm plugin bilgilerini döndürür
   */
  getAllPluginsInfo() {
    return Array.from(this.plugins.values()).map(plugin => ({
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      author: plugin.author,
      category: plugin.category,
      tools: plugin.toolNames || Object.keys(plugin.tools),
      enabled: plugin.enabled !== false
    }));
  }

  /**
   * Plugin'in tool'larını döndürür
   */
  getPluginTools(pluginName) {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      return null;
    }
    return plugin.tools;
  }

  /**
   * Tüm tool'ları döndürür (tüm pluginlerden)
   */
  getAllTools() {
    const allTools = {};
    
    this.plugins.forEach((plugin, pluginName) => {
      Object.entries(plugin.tools).forEach(([toolName, toolConfig]) => {
        allTools[`${pluginName}.${toolName}`] = {
          ...toolConfig,
          plugin: pluginName,
          fullName: `${pluginName}.${toolName}`
        };
      });
    });

    return allTools;
  }

  /**
   * Tool çalıştırır
   */
  async executeTool(toolName, args) {
    // Parse tool name (could be "plugin.tool" or just "tool")
    let pluginName, actualToolName;
    
    if (toolName.includes('.')) {
      [pluginName, actualToolName] = toolName.split('.');
    } else {
      // Find tool in any plugin
      for (const [pname, plugin] of this.plugins.entries()) {
        if (plugin.tools[toolName]) {
          pluginName = pname;
          actualToolName = toolName;
          break;
        }
      }
    }

    if (!pluginName || !actualToolName) {
      throw new Error(`Tool ${toolName} not found`);
    }

    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      throw new Error(`Plugin ${pluginName} not found`);
    }

    const tool = plugin.tools[actualToolName];
    if (!tool) {
      throw new Error(`Tool ${actualToolName} not found in plugin ${pluginName}`);
    }

    try {
      return await tool.handler(args);
    } catch (error) {
      throw new Error(`Tool execution error: ${error.message}`);
    }
  }

  /**
   * Plugin'i etkinleştirir
   */
  async enablePlugin(pluginName) {
    const infoPath = path.join(this.pluginsDir, pluginName, 'info.json');
    
    if (fs.existsSync(infoPath)) {
      const config = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
      config.enabled = true;
      fs.writeFileSync(infoPath, JSON.stringify(config, null, 2));
    }
    
    // Reload the plugin with tools enabled
    await this.reloadPlugin(pluginName);
    return true;
  }

  /**
   * Plugin'i devre dışı bırakır
   */
  async disablePlugin(pluginName) {
    const infoPath = path.join(this.pluginsDir, pluginName, 'info.json');
    
    if (fs.existsSync(infoPath)) {
      const config = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
      config.enabled = false;
      fs.writeFileSync(infoPath, JSON.stringify(config, null, 2));
    }
    
    // Reload the plugin with tools disabled
    await this.reloadPlugin(pluginName);
    return true;
  }

  /**
   * Plugin dosyalarını izleyen watcher'ı başlatır
   */
  initializeWatcher() {
    // Plugins dizinini izle
    this.watcher = chokidar.watch(this.pluginsDir, {
      ignored: /(^|[\/\\])\../, // Gizli dosyaları yoksay
      persistent: true,
      ignoreInitial: true
    });

    // Watcher hatalarını yakala
    this.watcher.on('error', (error) => {
      console.error('Plugin watcher error:', error);
      if (this.agentManager) {
        this.agentManager.sendErrorNotification('Plugin Manager: File watcher hatası', 
          `Watcher hatası: ${error.message}\nDosya: ${error.path || 'Bilinmiyor'}\nKod: ${error.code || 'Bilinmiyor'}`);
      }
    });

    // Tüm dosya değişikliklerini izle
    this.watcher.on('change', async (filePath) => {
      const pluginName = path.basename(path.dirname(filePath));
      const fileName = path.basename(filePath);
      
      // info.json için özel mesaj
      if (fileName === 'info.json') {
        console.log(`Plugin ${pluginName} info.json değişti, kontrol ediliyor...`);
      } else {
        console.log(`Plugin ${pluginName} dosyası değişti: ${fileName}, reloading...`);
      }
      
      try {
        // Decache the old module (if it's a JS file)
        if (filePath.endsWith('.js')) {
          decache(filePath);
        }
        
        // Reload the plugin
        const result = await this.reloadPlugin(pluginName);
        
        if (result) {
          if (fileName === 'info.json') {
            console.log(`Plugin ${pluginName} info.json değişikliği uygulandı`);
          } else {
            console.log(`Plugin ${pluginName} başarıyla yeniden yüklendi`);
          }
          
          // Notify agents about the update
          if (this.agentManager) {
            this.agentManager.broadcastStatus();
          }
        } else {
          console.log(`Plugin ${pluginName} yeniden yükleme başarısız (dosya eksik veya hata)`);
          if (this.agentManager) {
            this.agentManager.sendErrorNotification(`Plugin Manager: ${pluginName} yeniden yükleme başarısız`, `Dosya eksik veya yükleme hatası oluştu`);
          }
        }
      } catch (error) {
        console.error(`Plugin ${pluginName} yeniden yükleme hatası:`, error);
        if (this.agentManager) {
          this.agentManager.sendErrorNotification(`Plugin Manager: ${pluginName} yeniden yükleme hatası`, error.stack);
        }
      }
    });

    // Dosya silinmesini izle
    this.watcher.on('unlink', async (filePath) => {
      const pluginName = path.basename(path.dirname(filePath));
      console.log(`Plugin ${pluginName} dosyası silindi: ${path.basename(filePath)}, unloading plugin...`);
      
      try {
        this.unloadPlugin(pluginName);
        console.log(`Plugin ${pluginName} başarıyla kaldırıldı`);
        
        if (this.agentManager) {
          this.agentManager.broadcastStatus();
          this.agentManager.sendErrorNotification(`Plugin Manager: ${pluginName} dosyası silindi, plugin kaldırıldı`, `Silinen dosya: ${path.basename(filePath)}`);
        }
      } catch (error) {
        console.error(`Plugin ${pluginName} kaldırma hatası:`, error);
        if (this.agentManager) {
          this.agentManager.sendErrorNotification(`Plugin Manager: ${pluginName} kaldırma hatası`, error.stack);
        }
      }
    });

    // Plugin dizini silinmesini izle
    this.watcher.on('unlinkDir', async (dirPath) => {
      const pluginName = path.basename(dirPath);
      console.log(`Plugin directory ${pluginName} deleted, unloading plugin...`);
      
      try {
        this.unloadPlugin(pluginName);
        console.log(`Plugin ${pluginName} unloaded successfully`);
        
        if (this.agentManager) {
          this.agentManager.broadcastStatus();
          this.agentManager.sendErrorNotification(`Plugin Manager: ${pluginName} dizini silindi, plugin kaldırıldı`, `Silinen dizin: ${dirPath}`);
        }
      } catch (error) {
        console.error(`Error unloading plugin ${pluginName}:`, error);
        if (this.agentManager) {
          this.agentManager.sendErrorNotification(`Plugin Manager: ${pluginName} kaldırma hatası`, error.stack);
        }
      }
    });

    // Dosya oluşturulmasını izle
    this.watcher.on('add', async (filePath) => {
      const pluginName = path.basename(path.dirname(filePath));
      console.log(`Plugin ${pluginName} dosyası eklendi: ${path.basename(filePath)}, loading plugin...`);
      
      try {
        // Eğer plugin zaten yüklenmişse, reload yap
        if (this.plugins.has(pluginName)) {
          const result = await this.reloadPlugin(pluginName);
          if (result) {
            console.log(`Plugin ${pluginName} başarıyla yeniden yüklendi`);
          } else {
            console.log(`Plugin ${pluginName} yeniden yükleme başarısız`);
          }
        } else {
          // Yeni plugin olarak yükle
          const result = await this.loadPlugin(pluginName);
          if (result) {
            console.log(`Plugin ${pluginName} başarıyla yüklendi`);
            
            if (this.agentManager) {
              this.agentManager.broadcastStatus();
            }
          }
        }
      } catch (error) {
        console.error(`Plugin ${pluginName} yükleme hatası:`, error);
        if (this.agentManager) {
          this.agentManager.sendErrorNotification(`Plugin Manager: ${pluginName} yükleme hatası`, error.stack);
        }
      }
    });

    // Plugin dizini oluşturulmasını izle
    this.watcher.on('addDir', async (dirPath) => {
      const pluginName = path.basename(dirPath);
      console.log(`Plugin directory ${pluginName} added, loading plugin...`);
      
      try {
        // Plugin dosyalarının oluşmasını bekle
        setTimeout(async () => {
          const result = await this.loadPlugin(pluginName);
          if (result) {
            console.log(`Plugin ${pluginName} loaded successfully`);
            
            if (this.agentManager) {
              this.agentManager.broadcastStatus();
            }
          }
        }, 500); // 500ms bekleme süresi
      } catch (error) {
        console.error(`Error loading plugin ${pluginName}:`, error);
        if (this.agentManager) {
          this.agentManager.sendErrorNotification(`Plugin Manager: ${pluginName} yükleme hatası`, error.stack);
        }
      }
    });

    console.log('Plugin file watcher initialized');
  }

  /**
   * Watcher'ı durdurur
   */
  stopWatcher() {
    if (this.watcher) {
      this.watcher.close();
      console.log('Plugin file watcher stopped');
    }
  }

  /**
   * Tüm plugin manager instance'larını temizler
   */
  static stopAllWatchers() {
    PluginManager.instances.forEach(instance => {
      instance.stopWatcher();
    });
    PluginManager.instances = [];
    console.log('All plugin watchers stopped');
  }
}

module.exports = PluginManager;