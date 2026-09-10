const GoogleLiveAgent = require('./GoogleLive');
const GoogleLLMAgent = require('./GoogleLLM');
const OllamaAgent = require('../models/ollama/OllamaAgent');
const DataManager = require('../storage/DataManager');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class AgentManager {
  constructor(io, apiKey, cronManager = null) {
    this.agents = new Map();
    this.io = io;
    this.apiKey = apiKey;
    this.dataManager = new DataManager('./data', this);
    this.cronManager = cronManager;
    this.errorNotificationAgentIds = [];
    this.recentErrors = new Map(); // Son hataları tut (duplicate kontrolü için)
    this.loadSystemSettings();
    this.loadAgentsFromStorage();
    
    // Log API key status
    if (!this.apiKey) {
      console.warn('AgentManager initialized without API key - Google models will not work');
    } else {
      console.log('AgentManager initialized with API key');
    }
  }

  /**
   * API key'i günceller
   */
  updateApiKey(newApiKey) {
    this.apiKey = newApiKey;
    console.log('AgentManager API key updated:', newApiKey ? '***SET***' : '***EMPTY***');
    
    // Tüm Google agent'ların API key'lerini güncelle
    this.agents.forEach((agent, id) => {
      if (agent instanceof GoogleLiveAgent || agent instanceof GoogleLLMAgent) {
        agent.updateApiKey(newApiKey);
        console.log(`Agent ${id} API key updated`);
      }
    });
  }

  _getModelProvider(model) {
    // ModelManager'dan provider bilgisini al
    if (global.modelManager) {
      const allModels = global.modelManager.getAllModels();
      const modelInfo = allModels.find(m => m.id === model);
      if (modelInfo) {
        return modelInfo.provider;
      }
    }
    
    // Fallback: ModelManager yoksa basit kontrol
    // Sadece açıkça ollama: ile başlayanları ollama olarak kabul et
    if (model.startsWith('ollama:')) {
      return 'ollama';
    }
    
    // Google modelleri için alt provider'ı belirle
    // Live API modelleri genellikle "-live-preview" ile biter
    // LLM modelleri farklı isimlendirme kullanır
    if (model.includes('gemini')) {
      // Google modelleri - varsayılan olarak google provider
      return 'google';
    }
    
    // Diğer durumlarda varsayılan olarak google
    return 'google';
  }

  /**
   * Tüm mevcut modelleri ModelManager'dan al
   */
  getAllAvailableModels() {
    if (global.modelManager) {
      return global.modelManager.getAllModels();
    }
    return [];
  }

  /**
   * Belirli bir provider'ın modellerini al
   */
  getProviderModels(providerId) {
    if (global.modelManager) {
      return global.modelManager.getProviderModels(providerId);
    }
    return [];
  }

  /**
   * Tüm provider'ları al
   */
  getAllProviders() {
    if (global.modelManager) {
      return global.modelManager.getAllProviders();
    }
    return {};
  }

  createAgent(name, prompt, useLiveAPI = true, model = 'qwen3:0.6b', provider = null) {
    const id = crypto.randomUUID();
    
    // Eğer provider belirtilmemişse, model ID'sinden provider'ı tespit et
    let detectedProvider = provider;
    if (!detectedProvider) {
      detectedProvider = this._getModelProvider(model);
    }
    
    let agent;
    if (detectedProvider === 'ollama') {
      agent = new OllamaAgent(id, name, prompt, this.io, this.dataManager, this.cronManager, this, model);
    } else {
      // Google provider'ı için model tipini belirle
      // Live API modelleri genellikle "-live-preview" ile biter
      // LLM modelleri farklı isimlendirme kullanır
      const isLiveModel = model.includes('-live-preview') || model.includes('-live');
      
      if (isLiveModel) {
        agent = new GoogleLiveAgent(id, name, prompt, this.io, this.apiKey, this.dataManager, this.cronManager, this, model);
      } else {
        agent = new GoogleLLMAgent(id, name, prompt, this.io, this.apiKey, this.dataManager, this.cronManager, this, model);
      }
    }
    
    // Provider bilgisini agent'a kaydet
    agent.provider = detectedProvider;
    
    agent.createdAt = new Date().toISOString();
    this.agents.set(id, agent);

    this.dataManager.saveAgent(agent);

    this.io.emit('agent-created', {
      agent: agent.toJSON()
    });

    return agent;
  }

  deleteAgent(id) {
    const agent = this.agents.get(id);
    if (agent) {
      agent.stop();
      this.agents.delete(id);
      
      // Delete using agent name instead of ID
      this.dataManager.deleteAgent(agent.name);
      
      this.io.emit('agent-deleted', {
        agentId: id
      });
      
      return true;
    }
    return false;
  }

  getAgent(id) {
    return this.agents.get(id);
  }

  getAllAgents() {
    return Array.from(this.agents.values()).map(agent => agent.toJSON());
  }

  startAgent(id) {
    const agent = this.agents.get(id);
    if (agent) {
      agent.status = 'Hazir';
      if (this.dataManager) {
        this.dataManager.saveAgent(agent);
      }
      this.io.emit('agent-status', {
        agentId: id,
        status: 'Hazir'
      });
      this.broadcastStatus();
      return true;
    }
    return false;
  }

  stopAgent(id) {
    const agent = this.agents.get(id);
    if (agent) {
      agent.status = 'stopped';
      if (this.dataManager) {
        this.dataManager.saveAgent(agent);
      }
      this.io.emit('agent-status', {
        agentId: id,
        status: 'stopped'
      });
      this.broadcastStatus();
      return true;
    }
    return false;
  }

  updateAgent(id, { name, prompt, model, provider }) {
    const agent = this.agents.get(id);
    if (agent) {
      const currentModel = agent.model;
      const currentProvider = this._getModelProvider(currentModel);
      const currentIsOllama = currentProvider === 'ollama';
      
      // Determine new provider and model type
      let newProvider = provider;
      let newModel = model;
      
      // If provider is specified but model is not, get default model for that provider
      if (newProvider && !newModel && global.modelManager) {
        const defaultModel = global.modelManager.getDefaultModel(newProvider);
        if (defaultModel) {
          newModel = defaultModel.id;
        }
      }
      
      // If model is specified but provider is not, detect provider from model
      if (newModel && !newProvider) {
        newProvider = this._getModelProvider(newModel);
      }
      
      // Fall back to current provider if still no provider
      if (!newProvider) {
        newProvider = currentProvider;
      }
      
      const newIsOllama = newProvider === 'ollama';
      
      // Determine current and new Google model types
      const currentIsLiveModel = currentModel.includes('-live-preview') || currentModel.includes('-live');
      const newIsLiveModel = newModel.includes('-live-preview') || newModel.includes('-live');
      
      // If model type changed (Ollama ↔ Google or Google Live ↔ Google LLM), recreate the agent
      if (currentIsOllama !== newIsOllama || (!currentIsOllama && !newIsOllama && currentIsLiveModel !== newIsLiveModel)) {
        console.log(`Model type changed for agent ${id}, recreating agent`);
        
        // Stop the old agent
        agent.stop();
        this.agents.delete(id);
        
        // Create new agent with correct type
        let newAgent;
        if (newIsOllama) {
          newAgent = new OllamaAgent(id, name || agent.name, prompt || agent.prompt, this.io, this.dataManager, this.cronManager, this, newModel || currentModel);
        } else {
          // Google provider'ı için model tipini belirle
          if (newIsLiveModel) {
            newAgent = new GoogleLiveAgent(id, name || agent.name, prompt || agent.prompt, this.io, this.apiKey, this.dataManager, this.cronManager, this, newModel || currentModel);
          } else {
            newAgent = new GoogleLLMAgent(id, name || agent.name, prompt || agent.prompt, this.io, this.apiKey, this.dataManager, this.cronManager, this, newModel || currentModel);
          }
        }
        
        // Copy properties from old agent
        newAgent.createdAt = agent.createdAt;
        newAgent.history = agent.history;
        newAgent.session = agent.session;
        newAgent.enabledTools = agent.enabledTools;
        newAgent.memoryLimit = agent.memoryLimit;
        newAgent.provider = newProvider;
        
        this.agents.set(id, newAgent);
        
        if (this.dataManager) {
          this.dataManager.saveAgent(newAgent);
        }
        
        this.io.emit('agent-updated', {
          agent: newAgent.toJSON()
        });
        this.broadcastStatus();
        return true;
      }
      
      // Otherwise, just update properties
      if (name) agent.name = name;
      if (prompt) agent.prompt = prompt;
      if (newModel) agent.updateModel(newModel);
      if (newProvider) agent.provider = newProvider;
      if (this.dataManager) {
        this.dataManager.saveAgent(agent);
      }
      this.io.emit('agent-updated', {
        agent: agent.toJSON()
      });
      this.broadcastStatus();
      return true;
    }
    return false;
  }

  async restartAgent(id) {
    const agent = this.agents.get(id);
    if (agent) {
      // Restart the agent by stopping and starting it
      // This works for both GoogleAgent and OllamaAgent
      await agent.stop();
      await agent.start();
      return true;
    }
    return false;
  }

  sendMessageToAgent(id, content, senderAgentId = null) {
    const agent = this.agents.get(id);
    if (!agent || agent.status === 'stopped') {
      return false;
    }

    if (senderAgentId) {
      const senderAgent = this.agents.get(senderAgentId);
      const finalMessage = senderAgent
        ? `[${senderAgent.name} (ID: ${senderAgentId})'dan mesaj]: ${content}`
        : content;
      agent.receiveMessage(finalMessage, {
        label: senderAgent
          ? `${senderAgent.name}: ${content.substring(0, 50)}`
          : content.substring(0, 60),
        source: 'agent',
        senderAgentId: senderAgentId,
        senderAgentName: senderAgent ? senderAgent.name : null,
        originalMessage: content
      });
    } else {
      agent.sendMessage(content);
    }

    return true;
  }

  getAgentQueue(id) {
    const agent = this.agents.get(id);
    if (agent) {
      return agent.getQueue();
    }
    return null;
  }

  removeQueueItem(agentId, itemId) {
    const agent = this.agents.get(agentId);
    if (agent) {
      return agent.removeQueueItem(itemId);
    }
    return { success: false, message: 'Agent bulunamadı.' };
  }

  stopQueueItem(agentId, itemId) {
    const agent = this.agents.get(agentId);
    if (agent) {
      return agent.stopCurrentQueueItem();
    }
    return { success: false, message: 'Agent bulunamadı.' };
  }

  updateQueueItem(agentId, itemId, updates) {
    const agent = this.agents.get(agentId);
    if (agent) {
      return agent.updateQueueItem(itemId, updates);
    }
    return { success: false, message: 'Agent bulunamadı.' };
  }

  clearAgentQueue(agentId) {
    const agent = this.agents.get(agentId);
    if (agent) {
      return agent.clearQueue();
    }
    return { success: false, message: 'Agent bulunamadı.' };
  }

  getAgentHistory(id) {
    const agent = this.agents.get(id);
    if (agent) {
      return agent.getHistory();
    }
    return null;
  }

  clearAgentHistory(id) {
    const agent = this.agents.get(id);
    if (agent) {
      const result = agent.clearHistory();
      return result;
    }
    return { success: false, message: 'Agent bulunamadı' };
  }

  getAgentStatus(id) {
    const agent = this.agents.get(id);
    if (agent) {
      return agent.toJSON();
    }
    return null;
  }

  broadcastStatus() {
    const agents = this.getAllAgents();
    this.io.emit('agents-status', {
      agents: agents
    });
  }

  loadAgentsFromStorage() {
    try {
      const agentsData = this.dataManager.loadAgents();
      agentsData.forEach(agentData => {
        const model = agentData.model || 'qwen3:0.6b';
        const provider = agentData.provider || this._getModelProvider(model);
        
        let agent;
        if (provider === 'ollama') {
          agent = new OllamaAgent(
            agentData.id,
            agentData.name,
            agentData.prompt,
            this.io,
            this.dataManager,
            this.cronManager,
            this,
            model
          );
        } else {
          // Google provider'ı için model tipini belirle
          const isLiveModel = model.includes('-live-preview') || model.includes('-live');
          
          if (isLiveModel) {
            agent = new GoogleLiveAgent(
              agentData.id,
              agentData.name,
              agentData.prompt,
              this.io,
              this.apiKey,
              this.dataManager,
              this.cronManager,
              this,
              model
            );
          } else {
            agent = new GoogleLLMAgent(
              agentData.id,
              agentData.name,
              agentData.prompt,
              this.io,
              this.apiKey,
              this.dataManager,
              this.cronManager,
              this,
              model
            );
          }
        }
        
        agent.createdAt = agentData.createdAt;
        agent.history = agentData.history || [];
        agent.session = agentData.session || [];
        agent.status = 'Hazir';
        
        // GoogleLLM için varsayılan tool'ları ekleyelim
        if (agent instanceof GoogleLLMAgent) {
          const defaultTools = ['datetime.getCurrentTime', 'datetime.getCurrentDate'];
          const storedTools = agentData.enabledTools || agent.toolManager.getAvailableTools();
          
          // DateTime tool'larını ekle, yoksa
          defaultTools.forEach(tool => {
            if (!storedTools.includes(tool)) {
              storedTools.push(tool);
            }
          });
          
          agent.enabledTools = storedTools;
        } else {
          agent.enabledTools = agentData.enabledTools || agent.toolManager.getAvailableTools();
        }
        
        agent.memoryLimit = agentData.memoryLimit || 1000;
        
        this.agents.set(agent.id, agent);
      });
      console.log(`Loaded ${agentsData.length} agents from storage`);
    } catch (error) {
      console.error('Error loading agents from storage:', error);
    }
  }

  saveAllAgentsToStorage() {
    try {
      this.dataManager.saveAgents(Array.from(this.agents.values()));
    } catch (error) {
      console.error('Error saving agents to storage:', error);
    }
  }

  setCronManager(cronManager) {
    this.cronManager = cronManager;
    // Update all existing agents' toolManager with cronManager
    this.agents.forEach(agent => {
      agent.cronManager = cronManager;
      if (agent.toolManager) {
        if (typeof agent.toolManager.setCronManager === 'function') {
          agent.toolManager.setCronManager(cronManager);
        } else {
          agent.toolManager.cronManager = cronManager;
        }
        agent.toolManager.agentManager = this;
      }
    });
  }

  // Plugin Management Methods
  getAllPluginsInfo() {
    // Get plugins info from the first available agent's ToolManager
    const agent = this.agents.values().next().value;
    if (agent && agent.toolManager && agent.toolManager.pluginManager) {
      return agent.toolManager.pluginManager.getAllPluginsInfo();
    }
    
    // Fallback: create temporary ToolManager if no agent exists
    const ToolManager = require('../tools/ToolManager');
    const tempToolManager = new ToolManager(this.cronManager, null, this, this.io);
    return tempToolManager.pluginManager.getAllPluginsInfo();
  }

  getPluginInfo(pluginName) {
    const agent = this.agents.values().next().value;
    if (agent && agent.toolManager) {
      return agent.toolManager.getPluginInfo(pluginName);
    }
    return null;
  }

  async enablePlugin(pluginName) {
    const promises = Array.from(this.agents.values()).map(agent => {
      if (agent.toolManager) {
        return agent.toolManager.enablePlugin(pluginName);
      }
    });
    await Promise.all(promises);
  }

  async disablePlugin(pluginName) {
    const promises = Array.from(this.agents.values()).map(agent => {
      if (agent.toolManager) {
        return agent.toolManager.disablePlugin(pluginName);
      }
    });
    await Promise.all(promises);
  }

  async reloadPlugin(pluginName) {
    const promises = Array.from(this.agents.values()).map(agent => {
      if (agent.toolManager) {
        return agent.toolManager.reloadPlugin(pluginName);
      }
    });
    await Promise.all(promises);
  }

  enableTool(agentId, toolName) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }

    if (!agent.enabledTools.includes(toolName)) {
      agent.enabledTools.push(toolName);
      agent.updateEnabledTools(agent.enabledTools);
      this.dataManager.saveAgent(agent);
      this.io.emit('agent-tools-updated', {
        agentId: agentId,
        enabledTools: agent.enabledTools
      });
    }
    return true;
  }

  disableTool(agentId, toolName) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }

    const index = agent.enabledTools.indexOf(toolName);
    if (index > -1) {
      agent.enabledTools.splice(index, 1);
      agent.updateEnabledTools(agent.enabledTools);
      this.dataManager.saveAgent(agent);
      this.io.emit('agent-tools-updated', {
        agentId: agentId,
        enabledTools: agent.enabledTools
      });
    }
    return true;
  }

  getEnabledTools(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return null;
    }
    return agent.enabledTools;
  }

  getAvailableTools() {
    // Get all available tools from ToolManager
    // Create a temporary ToolManager to get all available tools
    const ToolManager = require('../tools/ToolManager');
    const tempToolManager = new ToolManager(this.cronManager, null, this, this.io);
    return tempToolManager.getAvailableTools();
  }

  loadSystemSettings() {
    try {
      const settingsPath = path.join(__dirname, '../../data/system-settings.json');
      if (fs.existsSync(settingsPath)) {
        const settingsData = fs.readFileSync(settingsPath, 'utf8');
        const settings = JSON.parse(settingsData);
        this.errorNotificationAgentIds = settings.errorNotification?.agentIds || [];
      }
    } catch (error) {
      console.error('Sistem ayarları yüklenirken hata:', error);
      this.errorNotificationAgentIds = [];
    }
  }

  // Safe method to send error notification (won't cause infinite loops)
  safeSendErrorNotification(errorMessage, errorDetails = '') {
    try {
      if (this.errorNotificationAgentIds.length === 0) return;
      
      // Create error hash for duplicate detection
      const errorHash = crypto.createHash('md5').update(errorMessage + errorDetails).digest('hex');
      const now = Date.now();
      
      // Check if same error was sent in last 30 seconds
      if (this.recentErrors.has(errorHash)) {
        const lastSent = this.recentErrors.get(errorHash);
        if (now - lastSent < 30000) { // 30 seconds
          console.log('Duplicate error suppressed:', errorMessage.substring(0, 50));
          return;
        }
      }
      
      // Store error timestamp
      this.recentErrors.set(errorHash, now);
      
      // Clean up old errors (older than 1 minute)
      this.recentErrors.forEach((timestamp, hash) => {
        if (now - timestamp > 60000) {
          this.recentErrors.delete(hash);
        }
      });
      
      const timestamp = new Date().toISOString();
      
      // Parse error details to extract file and code if available
      let file = null;
      let code = null;
      let description = errorDetails;
      
      if (errorDetails) {
        // Try to extract file path from error details
        const fileMatch = errorDetails.match(/Dosya:\s*(.+)/i);
        if (fileMatch) {
          file = fileMatch[1].trim();
        }
        
        // Try to extract error code from error details
        const codeMatch = errorDetails.match(/Kod:\s*(.+)/i);
        if (codeMatch) {
          code = codeMatch[1].trim();
          // Remove code from description if found
          description = errorDetails.replace(/Kod:\s*.+/i, '').trim();
        }
        
        // Remove file from description if found
        if (file) {
          description = description.replace(/Dosya:\s*.+/i, '').trim();
        }
      }
      
      // If no code found, use error message as description
      if (!code && !description) {
        description = errorMessage;
      }
      
      // Create structured system error message
      const systemErrorMessage = {
        role: 'system',
        type: 'error',
        title: errorMessage,
        description: description || errorMessage,
        file: file,
        code: code,
        timestamp: timestamp
      };
      
      const formattedMessage = JSON.stringify(systemErrorMessage, null, 2);
      
      this.errorNotificationAgentIds.forEach(agentId => {
        const agent = this.agents.get(agentId);
        if (agent && agent.status !== 'stopped') {
          try {
            agent.receiveMessage(formattedMessage, {
              label: `Sistem Hatası: ${errorMessage.substring(0, 50)}`,
              source: 'system',
              timestamp: timestamp,
              isSystemError: true,
              errorData: systemErrorMessage
            });
          } catch (error) {
            console.error(`Agent ${agentId}'e hata bildirimi gönderilemedi:`, error);
          }
        }
      });
    } catch (error) {
      console.error('Hata bildirimi gönderirken hata:', error);
    }
  }

  saveSystemSettings() {
    try {
      const settingsPath = path.join(__dirname, '../../data/system-settings.json');
      const settings = {
        errorNotification: {
          agentIds: this.errorNotificationAgentIds
        }
      };
      
      // Ensure data directory exists
      const dataDir = path.dirname(settingsPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      return true;
    } catch (error) {
      console.error('Sistem ayarları kaydedilirken hata:', error);
      return false;
    }
  }

  addErrorNotificationAgent(agentId) {
    if (!this.errorNotificationAgentIds.includes(agentId)) {
      this.errorNotificationAgentIds.push(agentId);
      this.saveSystemSettings();
      return true;
    }
    return false;
  }

  removeErrorNotificationAgent(agentId) {
    const index = this.errorNotificationAgentIds.indexOf(agentId);
    if (index > -1) {
      this.errorNotificationAgentIds.splice(index, 1);
      this.saveSystemSettings();
      return true;
    }
    return false;
  }

  getErrorNotificationAgents() {
    return this.errorNotificationAgentIds;
  }

  sendErrorNotification(errorMessage, errorDetails = '') {
    // Use the safe version to prevent infinite loops
    this.safeSendErrorNotification(errorMessage, errorDetails);
  }

  sendSuccessNotification(successMessage, successDetails = '') {
    // Send success notification to error notification agents
    this.errorNotificationAgentIds.forEach(agentId => {
      const agent = this.agents.get(agentId);
      if (agent && agent.status !== 'stopped') {
        agent.receiveMessage(`✅ SİSTEM BİLDİRİMİ: ${successMessage}\n\nDetaylar: ${successDetails}`, {
          label: `Sistem Başarısı: ${successMessage.substring(0, 50)}`,
          source: 'system',
          priority: 'info'
        });
      }
    });
  }

  // True Live Mode Methods
  setAgentTrueLiveMode(agentId, enabled) {
    const agent = this.agents.get(agentId);
    if (agent && agent.setTrueLiveMode) {
      agent.setTrueLiveMode(enabled);
      return true;
    }
    return false;
  }

  async startAgentTrueLiveSession(agentId, clientSocket) {
    const agent = this.agents.get(agentId);
    if (agent && agent.startTrueLiveSession) {
      return await agent.startTrueLiveSession(clientSocket);
    }
    return false;
  }

  stopAgentTrueLiveSession(agentId) {
    const agent = this.agents.get(agentId);
    if (agent && agent.stopTrueLiveSession) {
      agent.stopTrueLiveSession();
      return true;
    }
    return false;
  }

  handleAgentTrueLiveAudioInput(agentId, audioData) {
    const agent = this.agents.get(agentId);
    if (agent && agent.handleTrueLiveAudioInput) {
      agent.handleTrueLiveAudioInput(audioData);
      return true;
    }
    return false;
  }

  handleAgentTrueLiveTextInput(agentId, text) {
    const agent = this.agents.get(agentId);
    if (agent && agent.handleTrueLiveTextInput) {
      agent.handleTrueLiveTextInput(text);
      return true;
    }
    return false;
  }

  async cleanup(waitForCompletion = false) {
    console.log('AgentManager temizleniyor...');
    
    // Önce agent verilerini kaydet
    if (this.dataManager && this.agents.size > 0) {
      try {
        this.dataManager.saveAgents(Array.from(this.agents.values()));
        console.log(`${this.agents.size} agent verisi kaydedildi`);
      } catch (err) {
        console.error('Agent verileri kaydedilirken hata:', err);
      }
    }
    
    // Eğer waitForCompletion isteniyorsa, çalışan agent'ların bitmesini bekle (sonsuz)
    if (waitForCompletion) {
      console.log('Çalışan agent\'ların bitmesi bekleniyor (sonsuz bekleme)...');
      let stillWorking = true;
      
      while (stillWorking) {
        stillWorking = false;
        
        this.agents.forEach((agent, id) => {
          const isProcessing = agent.isProcessing || agent.status === 'Gorev_yapiyor';
          const hasQueue = agent.messageQueue.some(item => item.status !== 'completed');
          const hasLiveSession = agent.isLiveSessionActive;
          
          if (isProcessing || hasQueue || hasLiveSession) {
            stillWorking = true;
            console.log(`Agent ${id} (${agent.name}) hala çalışıyor (processing: ${isProcessing}, queue: ${hasQueue}, liveSession: ${hasLiveSession})`);
          }
        });
        
        if (stillWorking) {
          console.log('Agent\'lar hala çalışıyor, 1 saniye bekleniyor...');
          // 1 saniye bekle (async)
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      console.log('Tüm agent\'lar görevlerini tamamladı.');
    }
    
    // Tüm agent'ları durdur
    this.agents.forEach((agent, id) => {
      try {
        // True live session'ı da durdur
        if (agent.stopTrueLiveSession) {
          agent.stopTrueLiveSession();
        }
        agent.stop();
      } catch (err) {
        console.error(`Agent ${id} durdurulurken hata:`, err);
      }
    });
    
    // Agent'ları temizle
    this.agents.clear();
    
    // DataManager'ı temizle
    if (this.dataManager) {
      try {
        this.dataManager.cleanup();
      } catch (err) {
        console.error('DataManager temizlenirken hata:', err);
      }
    }
    
    console.log('AgentManager başarıyla temizlendi');
  }
}

module.exports = AgentManager;