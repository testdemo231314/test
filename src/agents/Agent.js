const crypto = require('crypto');
const ToolManager = require('../tools/ToolManager');

class Agent {
  constructor(id, name, prompt, io, dataManager = null, cronManager = null, agentManager = null, model = 'qwen3:0.6b') {
    this.id = id;
    this.name = name;
    this.prompt = prompt;
    this.io = io;
    this.model = model || 'qwen3:0.6b';
    this.status = 'Hazir';
    this.history = [];
    this.session = [];
    this.currentMessage = null;
    this.isProcessing = false;
    this.cronManager = cronManager;
    this.dataManager = dataManager;
    this.agentManager = agentManager;
    this.enabledTools = null; // Will be set after toolManager is created
    this.toolManager = new ToolManager(cronManager, this.enabledTools, agentManager, io);
    this.enabledTools = this.toolManager.getAvailableTools(); // Default: all tools enabled
    this.responseQueue = [];
    this.messageQueue = [];
    this.createdAt = new Date().toISOString();
    
    // Streaming response buffering
    this.currentResponseBuffer = '';
    this.isStreamingResponse = false;
    this.currentResponseStartTime = null;
    
    // Memory limit
    this.memoryLimit = 1000; // Maximum messages in history
    
    // Live audio session state (for all models)
    this.isLiveSessionActive = false;
  }

  async start() {
    this.normalizeAgentStatus();
    if (this.status === 'Hazir') return;
    
    this.status = 'Hazir';
    this.session = [];
    this.responseQueue = [];
    
    // Reset streaming buffer
    this.currentResponseBuffer = '';
    this.isStreamingResponse = false;
    this.currentResponseStartTime = null;
    
    console.log(`Agent ${this.id} started (ready for first message)`);
    
    // Emit status to client
    this.io.emit('agent-status', {
      agentId: this.id,
      status: 'Hazir'
    });
  }

  stop() {
    this.status = 'closing';
    this.isProcessing = false;
    
    // Reset streaming buffer
    this.currentResponseBuffer = '';
    this.isStreamingResponse = false;
    this.currentResponseStartTime = null;
    
    // Subclasses should override this to handle their specific cleanup
    this._stopModelSession();
    
    // After closing, set status to 'Hazir' (idle state)
    this.status = 'Hazir';
    this.io.emit('agent-status', {
      agentId: this.id,
      status: 'Hazir'
    });

    this.completeCurrentQueueItem();
    this.processNextInQueue();
  }

  _stopModelSession() {
    // Override in subclasses
  }

  // Live Audio Session Methods (base implementation for all models)
  async startLiveSession() {
    // Override in subclasses for model-specific behavior
    this.isLiveSessionActive = true;
    console.log(`Agent ${this.id} live session started`);
  }

  stopLiveSession() {
    // Override in subclasses for model-specific behavior
    this.isLiveSessionActive = false;
    console.log(`Agent ${this.id} live session stopped`);
  }

  handleLiveAudioInput(audioData) {
    // Override in subclasses for model-specific behavior
    console.log(`Agent ${this.id} received audio input`);
  }

  normalizeAgentStatus() {
    if (this.status === 'Hazır' || this.status === 'idle') {
      this.status = 'Hazir';
    }
  }

  isReadyForQueue() {
    this.normalizeAgentStatus();
    const hasProcessingItem = this.messageQueue.some(item => item.status === 'processing' || item.status === 'connection_lost');
    const hasLiveSession = this.isLiveSessionActive;
    return this.status === 'Hazir' && !hasProcessingItem && !hasLiveSession;
  }

  truncateText(text, maxLength = 60) {
    if (!text) return '';
    return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
  }

  getSourceLabel(source) {
    const labels = {
      user: 'Kullanıcı',
      cron: 'Cron',
      agent: 'Agent',
      api: 'API'
    };
    return labels[source] || 'Mesaj';
  }

  buildQueueLabel(content, source, label) {
    if (label) return this.truncateText(label, 80);
    return this.truncateText(content, 80);
  }

  enqueueMessage(content, options = {}) {
    if (this.status === 'stopped') {
      console.log(`Agent ${this.id} durdurulmuş durumda, mesaj kuyruğa alınamadı.`);
      return null;
    }

    this.normalizeAgentStatus();

    const source = options.source || 'user';
    const item = {
      id: crypto.randomUUID(),
      content,
      source,
      label: this.buildQueueLabel(content, source, options.label),
      status: 'waiting',
      addedAt: new Date().toISOString(),
      taskName: options.taskName,
      taskSchedule: options.taskSchedule,
      taskTimestamp: options.taskTimestamp,
      senderAgentId: options.senderAgentId,
      senderAgentName: options.senderAgentName,
      originalMessage: options.originalMessage,
      // Bağlantı yönetimi için yeni alanlar
      connectionLostAt: null,
      originalContent: null,
      reconnectionAttempt: 0,
      reconnectedAt: null
    };

    this.messageQueue.push(item);
    this.broadcastQueueUpdate();

    if (this.isReadyForQueue()) {
      this.processNextInQueue();
    }

    return item.id;
  }

  completeCurrentQueueItem() {
    const processingItem = this.messageQueue.find(item => item.status === 'processing');
    if (processingItem) {
      processingItem.status = 'completed';
    }
    this.messageQueue = this.messageQueue.filter(item => item.status !== 'completed');
    this.broadcastQueueUpdate();
  }

  // Çalışan görevi durdurma metodu
  stopCurrentQueueItem() {
    const processingItem = this.messageQueue.find(item => item.status === 'processing');
    if (!processingItem) {
      return { success: false, message: 'Çalışan görev bulunamadı.' };
    }

    // Görev durumunu 'stopped' olarak işaretle
    processingItem.status = 'stopped';
    processingItem.stoppedAt = new Date().toISOString();

    // Agent durumunu sıfırla
    this.status = 'Hazir';
    this.isProcessing = false;

    // Streaming buffer'ı temizle
    this.currentResponseBuffer = '';
    this.isStreamingResponse = false;
    this.currentResponseStartTime = null;

    // Model session'ı durdur (subclass'lar override edebilir)
    this._stopModelSession();

    // Kuyruk güncellemesi yayınla
    this.broadcastQueueUpdate();

    // Agent durumunu yayınla
    this.io.emit('agent-status', {
      agentId: this.id,
      status: 'Hazir'
    });

    // Durdurulan öğeyi kuyruktan kaldır
    this.messageQueue = this.messageQueue.filter(item => item.status !== 'stopped');

    // Sonraki görevi işle
    if (this.isReadyForQueue()) {
      this.processNextInQueue();
    }

    return { success: true, message: 'Çalışan görev durduruldu ve sonraki göreve geçildi.' };
  }

  async processNextInQueue() {
    if (!this.isReadyForQueue()) return;

    const nextItem = this.messageQueue.find(item => item.status === 'waiting');
    if (!nextItem) return;

    nextItem.status = 'processing';
    this.status = 'Gorev_yapiyor';
    this.broadcastQueueUpdate();
    this.io.emit('agent-status', {
      agentId: this.id,
      status: 'Gorev_yapiyor'
    });

    try {
      // Pass message-specific options
      const messageOptions = {
        source: nextItem.source,
        taskName: nextItem.taskName,
        taskSchedule: nextItem.taskSchedule,
        taskTimestamp: nextItem.taskTimestamp,
        senderAgentId: nextItem.senderAgentId,
        senderAgentName: nextItem.senderAgentName,
        originalMessage: nextItem.originalMessage
      };
      await this._executeMessage(nextItem.content, messageOptions);
    } catch (error) {
      console.error(`Agent ${this.id} queue processing error:`, error);
      this.completeCurrentQueueItem();
      if (this.isReadyForQueue()) {
        this.processNextInQueue();
      }
    }
  }

  getQueueSnapshot() {
    return this.messageQueue.map((item, index) => ({
      id: item.id,
      position: index + 1,
      label: item.label,
      content: this.truncateText(item.content, 100),
      source: item.source,
      sourceLabel: this.getSourceLabel(item.source),
      status: item.status,
      addedAt: item.addedAt,
      connectionLostAt: item.connectionLostAt,
      reconnectionAttempt: item.reconnectionAttempt,
      reconnectedAt: item.reconnectedAt
    }));
  }

  broadcastQueueUpdate() {
    this.io.emit('agent-queue-update', {
      agentId: this.id,
      queue: this.getQueueSnapshot()
    });
  }

  getQueue() {
    return this.getQueueSnapshot();
  }

  clearQueue() {
    const hasProcessing = this.messageQueue.some(item => item.status === 'processing');
    if (hasProcessing) {
      return { success: false, message: 'Agent görev yaparken kuyruk temizlenemez.' };
    }
    this.messageQueue = [];
    this.broadcastQueueUpdate();
    return { success: true };
  }

  removeQueueItem(itemId) {
    const itemIndex = this.messageQueue.findIndex(item => item.id === itemId);
    if (itemIndex === -1) {
      return { success: false, message: 'Kuyruk öğesi bulunamadı.' };
    }

    const item = this.messageQueue[itemIndex];
    if (item.status === 'processing') {
      // Çalışan görevi durdur
      return this.stopCurrentQueueItem();
    }

    this.messageQueue.splice(itemIndex, 1);
    this.broadcastQueueUpdate();
    return { success: true, message: 'Kuyruk öğesi başarıyla silindi.' };
  }

  updateQueueItem(itemId, updates) {
    const item = this.messageQueue.find(item => item.id === itemId);
    if (!item) {
      return { success: false, message: 'Kuyruk öğesi bulunamadı.' };
    }

    if (item.status === 'processing') {
      return { success: false, message: 'İşlenmekte olan görev değiştirilemez.' };
    }

    // Update allowed fields
    if (updates.content !== undefined) {
      item.content = updates.content;
      item.label = this.buildQueueLabel(updates.content, item.source, updates.label);
    }
    if (updates.label !== undefined && updates.content === undefined) {
      item.label = this.buildQueueLabel(item.content, item.source, updates.label);
    }

    this.broadcastQueueUpdate();
    return { success: true, message: 'Kuyruk öğesi başarıyla güncellendi.' };
  }

  async _executeMessage(content, options = {}) {
    if (this.status === 'stopped') {
      console.log(`Agent ${this.id} durdurulmuş durumda, mesaj gönderilemedi.`);
      this.completeCurrentQueueItem();
      return;
    }

    // Use original message for history if this is a cron task, otherwise use full content
    const messageContent = (options.source === 'cron' && options.originalMessage) ? options.originalMessage : content;

    // Set role based on source
    let messageRole = 'user';
    if (options.source === 'cron') {
      messageRole = 'cron';
    } else if (options.source === 'agent') {
      messageRole = 'agent';
    } else if (options.source === 'system') {
      messageRole = 'system';
    }

    // For agent-to-agent messages, ensure we use the agent role
    if (options.senderAgentId) {
      messageRole = 'agent';
    }
    
    this.currentMessage = {
      role: messageRole,
      content: messageContent,
      timestamp: new Date().toISOString(),
      source: options.source || 'user',
      taskName: options.taskName,
      taskSchedule: options.taskSchedule,
      taskTimestamp: options.taskTimestamp,
      senderAgentId: options.senderAgentId,
      senderAgentName: options.senderAgentName,
      originalMessage: options.originalMessage
    };

    this.history.push(this.currentMessage);

    // Apply memory limit
    this.applyMemoryLimit();

    this.io.emit('agent-message', {
      agentId: this.id,
      message: this.currentMessage,
      status: this.status
    });

    // Save to storage
    if (this.dataManager) {
      this.dataManager.saveAgent(this);
    }

    // Reset streaming buffer for new response
    this.currentResponseBuffer = '';
    this.isStreamingResponse = false;
    this.currentResponseStartTime = null;

    // Subclasses should override this to handle model-specific execution
    await this._executeModelMessage(content, options);
  }

  // Abstract method - subclasses must implement
  async _executeModelMessage(content, options = {}) {
    throw new Error('_executeModelMessage must be implemented by subclass');
  }

  sendMessage(content, options = {}) {
    return this.enqueueMessage(content, { source: 'user', ...options });
  }

  receiveMessage(content, options = {}) {
    return this.enqueueMessage(content, { source: 'agent', ...options });
  }

  clearHistory() {
    const workingStatuses = ['running', 'Gorev_yapiyor', 'Yeniden_baglaniyor'];
    if (this.isProcessing || workingStatuses.includes(this.status)) {
      return { success: false, message: 'Agent şu anda görev yapıyor. Görev sırasında sohbet geçmişi temizlenemez.' };
    }
    
    this.history = [];
    this.session = [];
    
    // Reset streaming buffer
    this.currentResponseBuffer = '';
    this.isStreamingResponse = false;
    this.currentResponseStartTime = null;
    
    // Save to storage
    if (this.dataManager) {
      this.dataManager.saveAgent(this);
    }
    
    this.io.emit('agent-history-cleared', {
      agentId: this.id
    });
    
    console.log(`Agent ${this.id} history cleared`);
    return { success: true };
  }

  getHistory() {
    return this.history;
  }

  sortHistoryByTimestamp() {
    this.history.sort((a, b) => {
      const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return timeA - timeB;
    });
    console.log(`Agent ${this.id} history sorted by timestamp`);
  }

  applyMemoryLimit() {
    if (this.history.length > this.memoryLimit) {
      const removedCount = this.history.length - this.memoryLimit;
      this.history = this.history.slice(-this.memoryLimit);
      console.log(`Agent ${this.id} memory limit applied: removed ${removedCount} old messages`);
    }
  }

  updateEnabledTools(enabledTools) {
    this.enabledTools = enabledTools;
    this.toolManager.enabledTools = enabledTools;
  }

  updateModel(model) {
    this.model = model;
    
    // Save to storage
    if (this.dataManager) {
      this.dataManager.saveAgent(this);
    }
    
    // Subclasses should override this to handle model-specific updates
    this._updateModelSession(model);
    
    return { success: true, model: this.model };
  }

  _updateModelSession(model) {
    // Override in subclasses
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      prompt: this.prompt,
      model: this.model,
      provider: this.provider, // Include provider in JSON
      status: this.status,
      sessionLength: this.session.length,
      historyLength: this.history.length,
      isProcessing: this.isProcessing,
      queueLength: this.messageQueue.filter(item => item.status !== 'completed').length,
      enabledTools: this.enabledTools
    };
  }
}

module.exports = Agent;
