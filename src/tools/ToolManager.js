const PluginManager = require('./PluginManager');

class ToolManager {
  constructor(cronManager = null, enabledTools = null, agentManager = null, io = null) {
    this.tools = new Map();
    this.cronManager = cronManager;
    this.agentManager = agentManager;
    this.enabledTools = enabledTools; // If null, all tools are enabled
    this.io = io;
    
    // Use PluginManager instead of direct tool registration
    this.pluginManager = new PluginManager(io, cronManager, agentManager);
    this.pluginManager.loadAllPlugins().then(() => {
      this.registerPluginTools();
    });
  }

  registerPluginTools() {
    try {
      const allTools = this.pluginManager.getAllTools();
      
      Object.entries(allTools).forEach(([toolName, toolConfig]) => {
        this.registerTool(toolName, toolConfig.handler);
      });
      
      console.log(`Registered ${Object.keys(allTools).length} tools from plugins`);
    } catch (error) {
      console.error('Error registering plugin tools:', error);
      if (this.agentManager) {
        this.agentManager.sendErrorNotification('Tool Manager: Plugin tool kayıt hatası', error.stack);
      }
    }
  }

  registerTool(name, handler) {
    this.tools.set(name, handler);
  }

  async executeTool(toolName, args) {
    // Check if tool is enabled
    // Handle both "toolName" and "plugin.toolName" formats
    const isToolEnabled = this.enabledTools && (
      this.enabledTools.includes(toolName) || 
      this.enabledTools.some(enabled => enabled.endsWith(`.${toolName}`))
    );
    
    if (this.enabledTools && !isToolEnabled) {
      throw new Error(`Tool ${toolName} is not enabled for this agent`);
    }

    try {
      const parsedArgs = this.parseArgs(args);
      return await this.pluginManager.executeTool(toolName, parsedArgs);
    } catch (error) {
      console.error(`Tool execution error: ${toolName}`, error);
      if (this.agentManager) {
        this.agentManager.sendErrorNotification(`Tool Manager: ${toolName} çalıştırma hatası`, error.stack);
      }
      throw new Error(`Tool execution error: ${error.message}`);
    }
  }

  parseArgs(args) {
    try {
      if (typeof args === 'string') {
        return JSON.parse(args);
      }
      return args;
    } catch (error) {
      // If JSON parsing fails, treat as simple string argument
      return { input: args };
    }
  }

  async getCurrentTime(args) {
    const now = new Date();
    return now.toLocaleTimeString('tr-TR');
  }

  async getCurrentDate(args) {
    const now = new Date();
    return now.toLocaleDateString('tr-TR');
  }

  async calculate(args) {
    const { expression } = args;
    try {
      // Safe evaluation of mathematical expressions
      const sanitized = expression.replace(/[^0-9+\-*/().\s]/g, '');
      const result = Function('"use strict"; return (' + sanitized + ')')();
      return String(result);
    } catch (error) {
      throw new Error(`Invalid expression: ${expression}`);
    }
  }

  async getWeather(args) {
    const { city } = args;
    // Simulated weather data (gerçek API entegrasyonu için gerekirse)
    const weatherConditions = ['Güneşli', 'Bulutlu', 'Yağmurlu', 'Karlı', 'Rüzgarlı'];
    const randomCondition = weatherConditions[Math.floor(Math.random() * weatherConditions.length)];
    const randomTemp = Math.floor(Math.random() * 35) + 5; // 5-40 arası
    
    return `${city}: ${randomCondition}, ${randomTemp}°C`;
  }

  async executeShell(args) {
    const { command } = args;

    try {
      const { exec } = require('child_process');
      
      return new Promise((resolve, reject) => {
        exec(command, { 
          timeout: 30000, // 30 saniye timeout
          maxBuffer: 1024 * 1024 * 10 // 10MB buffer
        }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`Komut hatası: ${error.message}`));
          } else {
            let result = stdout.trim();
            if (stderr) {
              result += `\nHata çıktısı: ${stderr.trim()}`;
            }
            resolve(result || 'Komut başarıyla çalıştırıldı, çıktı yok');
          }
        });
      });
    } catch (error) {
      throw new Error(`Shell komutu çalıştırma hatası: ${error.message}`);
    }
  }

  async pythonExecute(args) {
    const { code } = args;
    // Python kodu çalıştır

    try {
      const { exec } = require('child_process');
      
      return new Promise((resolve, reject) => {
        exec(`python -c "${code.replace(/"/g, '\\"')}"`, { 
          timeout: 30000, // 30 saniye timeout
          maxBuffer: 1024 * 1024 * 10 // 10MB buffer
        }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`Python hatası: ${error.message}`));
          } else {
            let result = stdout.trim();
            if (stderr) {
              result += `\nHata çıktısı: ${stderr.trim()}`;
            }
            resolve(result || 'Python kodu başarıyla çalıştırıldı, çıktı yok');
          }
        });
      });
    } catch (error) {
      throw new Error(`Python kodu çalıştırma hatası: ${error.message}`);
    }
  }

  setCronManager(cronManager) {
    this.cronManager = cronManager;
    if (this.pluginManager) {
      this.pluginManager.setCronManager(cronManager);
    }
  }

  getCronManager() {
    return this.cronManager || global.cronManager;
  }

  async executeCron(args) {
    const { taskId } = args;
    const cronMgr = this.getCronManager();
    if (!cronMgr) {
      throw new Error('CronManager bulunamadı');
    }
    
    try {
      const task = cronMgr.getTask(taskId);
      if (task) {
        await task.execute();
        return `Cron görev ${taskId} başarıyla çalıştırıldı`;
      } else {
        throw new Error(`Cron görev ${taskId} bulunamadı`);
      }
    } catch (error) {
      throw new Error(`Cron görevi çalıştırma hatası: ${error.message}`);
    }
  }

  async addCronTask(args) {
    const { agentId, schedule, message, name } = args;
    const cronMgr = this.getCronManager();
    
    if (!cronMgr) {
      throw new Error('CronManager bulunamadı');
    }
    
    try {
      const task = cronMgr.createTask(agentId, schedule, message, name);
      return `Cron görev oluşturuldu: ${task.id} - ${name}`;
    } catch (error) {
      throw new Error(`Cron görevi oluşturma hatası: ${error.message}`);
    }
  }

  async listCronTasks(args) {
    const { agentId } = args;
    const cronMgr = this.getCronManager();
    
    if (!cronMgr) {
      throw new Error('CronManager bulunamadı');
    }
    
    try {
      let tasks;
      if (agentId) {
        tasks = cronMgr.getTasksByAgent(agentId);
      } else {
        tasks = cronMgr.getAllTasks();
      }
      
      if (tasks.length === 0) {
        return 'Henüz cron görevi yok';
      }
      
      const taskList = tasks.map(task => 
        `- ID: ${task.id}\n  Başlık: ${task.name}\n  Agent: ${task.agentId}\n  Zamanlama: ${task.schedule}\n  Mesaj: ${task.message}\n  Durum: ${task.status}\n  Son çalışma: ${task.lastRun || 'Henüz çalışmadı'}\n  Sonraki çalışma: ${task.nextRun || 'Belirlenmedi'}`
      ).join('\n\n');
      
      return `Cron Görevleri (${tasks.length}):\n\n${taskList}`;
    } catch (error) {
      throw new Error(`Cron görevleri listeleme hatası: ${error.message}`);
    }
  }

  async deleteCronTask(args) {
    const { taskId } = args;
    const cronMgr = this.getCronManager();
    
    if (!cronMgr) {
      throw new Error('CronManager bulunamadı');
    }
    
    try {
      const success = cronMgr.deleteTask(taskId);
      if (success) {
        return `Cron görev ${taskId} başarıyla silindi`;
      } else {
        throw new Error(`Cron görev ${taskId} bulunamadı`);
      }
    } catch (error) {
      throw new Error(`Cron görevi silme hatası: ${error.message}`);
    }
  }

  async updateCronTask(args) {
    const { taskId, schedule, message, name } = args;
    const cronMgr = this.getCronManager();
    
    if (!cronMgr) {
      throw new Error('CronManager bulunamadı');
    }
    
    try {
      const task = cronMgr.getTask(taskId);
      if (!task) {
        throw new Error(`Cron görev ${taskId} bulunamadı`);
      }
      
      if (schedule) {
        cronMgr.updateTaskSchedule(taskId, schedule);
      }
      
      if (message) {
        cronMgr.updateTaskMessage(taskId, message);
      }
      
      if (name) {
        task.name = name;
        cronMgr.dataManager.updateCronTask(task);
      }
      
      return `Cron görev ${taskId} başarıyla güncellendi`;
    } catch (error) {
      throw new Error(`Cron görevi güncelleme hatası: ${error.message}`);
    }
  }

  async startCronTask(args) {
    const { taskId } = args;
    const cronMgr = this.getCronManager();
    
    if (!cronMgr) {
      throw new Error('CronManager bulunamadı');
    }
    
    try {
      const success = cronMgr.startTask(taskId);
      if (success) {
        return `Cron görev ${taskId} başarıyla başlatıldı`;
      } else {
        throw new Error(`Cron görev ${taskId} bulunamadı`);
      }
    } catch (error) {
      throw new Error(`Cron görevi başlatma hatası: ${error.message}`);
    }
  }

  async stopCronTask(args) {
    const { taskId } = args;
    const cronMgr = this.getCronManager();

    if (!cronMgr) {
      throw new Error('CronManager bulunamadı');
    }

    try {
      const success = cronMgr.stopTask(taskId);
      if (success) {
        return `Cron görev ${taskId} başarıyla durduruldu`;
      } else {
        throw new Error(`Cron görev ${taskId} bulunamadı`);
      }
    } catch (error) {
      throw new Error(`Cron görevi durdurma hatası: ${error.message}`);
    }
  }

  async listAgents(args) {
    if (!this.agentManager) {
      throw new Error('AgentManager bulunamadı');
    }

    try {
      const agents = this.agentManager.getAllAgents();
      
      if (agents.length === 0) {
        return 'Henüz agent yok';
      }

      const agentList = agents.map(agent =>
        `- ID: ${agent.id}\n  Ad: ${agent.name}\n  Durum: ${agent.status}\n  Prompt: ${agent.prompt.substring(0, 100)}...`
      ).join('\n\n');

      return `Agent Listesi (${agents.length}):\n\n${agentList}`;
    } catch (error) {
      throw new Error(`Agent listesi hatası: ${error.message}`);
    }
  }

  async sendMessageToAgent(args) {
    const { targetAgentId, message, senderAgentId } = args;

    if (!this.agentManager) {
      throw new Error('AgentManager bulunamadı');
    }

    try {
      // Handle both targetAgentId and agentId for compatibility
      const agentId = targetAgentId || args.agentId;
      
      if (!agentId) {
        throw new Error('Agent ID gereklidir (targetAgentId veya agentId)');
      }

      const targetAgent = this.agentManager.getAgent(agentId);
      if (!targetAgent) {
        throw new Error(`Agent ${agentId} bulunamadı`);
      }

      if (targetAgent.status === 'stopped') {
        return 'Agent mesaj gönderilmedi agent aktif değil';
      }

      const success = this.agentManager.sendMessageToAgent(agentId, message, senderAgentId);
      if (success) {
        return `Mesaj ${agentId} ID'li agent'a başarıyla gönderildi`;
      } else {
        return 'Agent mesaj gönderilmedi agent aktif değil';
      }
    } catch (error) {
      throw new Error(`Mesaj gönderme hatası: ${error.message}`);
    }
  }

  async backgroundPythonExecute(args) {
    const { code } = args;

    try {
      const processInfo = this.pythonProcessManager.backgroundExecute(code);
      return `Python süreci başlatıldı: ID=${processInfo.id}, PID=${processInfo.pid}`;
    } catch (error) {
      throw new Error(`Python süreci başlatma hatası: ${error.message}`);
    }
  }

  async listPythonProcesses(args) {
    try {
      const processes = this.pythonProcessManager.getAllProcesses();
      
      if (processes.length === 0) {
        return 'Henüz çalışan Python süreci yok';
      }
      
      const processList = processes.map(p => 
        `- ID: ${p.id}\n  Kod: ${p.code.substring(0, 50)}...\n  Durum: ${p.status}\n  PID: ${p.pid}\n  Başlangıç: ${p.startTime}\n  Bitiş: ${p.endTime || 'Çalışıyor'}\n  Exit Code: ${p.exitCode || 'N/A'}`
      ).join('\n\n');
      
      return `Python Süreçleri (${processes.length}):\n\n${processList}`;
    } catch (error) {
      throw new Error(`Python süreçleri listeleme hatası: ${error.message}`);
    }
  }

  async stopPythonProcess(args) {
    const { processId } = args;

    try {
      const success = this.pythonProcessManager.stopProcess(processId);
      if (success) {
        return `Python süreci ${processId} başarıyla durduruldu`;
      } else {
        throw new Error(`Python süreci ${processId} bulunamadı`);
      }
    } catch (error) {
      throw new Error(`Python süreci durdurma hatası: ${error.message}`);
    }
  }

  async backgroundShellExecute(args) {
    const { command } = args;

    try {
      const processInfo = this.shellProcessManager.backgroundExecute(command);
      return `Shell süreci başlatıldı: ID=${processInfo.id}, PID=${processInfo.pid}`;
    } catch (error) {
      throw new Error(`Shell süreci başlatma hatası: ${error.message}`);
    }
  }

  async listShellProcesses(args) {
    try {
      const processes = this.shellProcessManager.getAllProcesses();
      
      if (processes.length === 0) {
        return 'Henüz çalışan Shell süreci yok';
      }
      
      const processList = processes.map(p => 
        `- ID: ${p.id}\n  Komut: ${p.command.substring(0, 50)}...\n  Durum: ${p.status}\n  PID: ${p.pid}\n  Başlangıç: ${p.startTime}\n  Bitiş: ${p.endTime || 'Çalışıyor'}\n  Exit Code: ${p.exitCode || 'N/A'}`
      ).join('\n\n');
      
      return `Shell Süreçleri (${processes.length}):\n\n${processList}`;
    } catch (error) {
      throw new Error(`Shell süreçleri listeleme hatası: ${error.message}`);
    }
  }

  async stopShellProcess(args) {
    const { processId } = args;

    try {
      const success = this.shellProcessManager.stopProcess(processId);
      if (success) {
        return `Shell süreci ${processId} başarıyla durduruldu`;
      } else {
        throw new Error(`Shell süreci ${processId} bulunamadı`);
      }
    } catch (error) {
      throw new Error(`Shell süreci durdurma hatası: ${error.message}`);
    }
  }

  async openBrowser({ url } = {}) { return this.seleniumProcessManager.openBrowser(url); }
  async listBrowsers() { return this.seleniumProcessManager.listBrowsers(); }
  async getDomStructure({ browserId } = {}) { return this.seleniumProcessManager.getDomStructure(browserId); }
  async clickByText({ text, browserId } = {}) {
    if (!text) throw new Error('text parametresi gereklidir');
    return this.seleniumProcessManager.clickByText(text, browserId);
  }
  async clickElement({ selector, byType, browserId } = {}) {
    if (!selector) throw new Error('selector parametresi gereklidir');
    return this.seleniumProcessManager.clickElement(selector, byType, browserId);
  }
  async typeInInput({ selector, text, byType, browserId } = {}) {
    if (!selector || !text) throw new Error('selector ve text parametreleri gereklidir');
    return this.seleniumProcessManager.typeInInput(selector, text, byType, browserId);
  }
  async closeBrowser({ browserId } = {}) { return this.seleniumProcessManager.closeBrowser(browserId); }

  getAvailableTools() {
    return this.pluginManager ? Object.keys(this.pluginManager.getAllTools()) : Array.from(this.tools.keys());
  }

  getAllPluginsInfo() {
    return this.pluginManager ? this.pluginManager.getAllPluginsInfo() : [];
  }

  getPluginInfo(pluginName) {
    return this.pluginManager ? this.pluginManager.getPluginInfo(pluginName) : null;
  }

  async enablePlugin(pluginName) {
    if (this.pluginManager) {
      await this.pluginManager.enablePlugin(pluginName);
      this.registerPluginTools();
    }
  }

  async disablePlugin(pluginName) {
    if (this.pluginManager) {
      await this.pluginManager.disablePlugin(pluginName);
      this.registerPluginTools();
    }
  }

  async reloadPlugin(pluginName) {
    if (this.pluginManager) {
      await this.pluginManager.reloadPlugin(pluginName);
      this.registerPluginTools();
    }
  }
}

module.exports = ToolManager;
