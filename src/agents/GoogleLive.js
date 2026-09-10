const { GoogleGenAI, Modality, Type } = require('@google/genai');
const Agent = require('./Agent');

class GoogleLiveAgent extends Agent {
  constructor(id, name, prompt, io, apiKey, dataManager = null, cronManager = null, agentManager = null, model = 'gemini-3.1-flash-live-preview') {
    super(id, name, prompt, io, dataManager, cronManager, agentManager, model);
    this.apiKey = apiKey;
    this.liveSession = null;
    this.isLiveSessionActive = false;
    this.clientSocket = null;
    this.mainAgent = null; // Ana agent referansı
    
    // Memory limit
    this.memoryLimit = 1000; // Maximum messages in history
    
    // Streaming response buffering (GoogleAgent.js formatında)
    this.currentResponseBuffer = '';
    this.isStreamingResponse = false;
    this.currentResponseStartTime = null;
    
    // ===== GELİŞMİŞ BAĞLANTI YÖNETİMİ SİSTEMİ =====
    // Connection status types
    this.connectionStatus = 'disconnected'; // 'connected', 'connecting', 'reconnecting', 'disconnected', 'offline'
    this.autoReconnect = true;
    this.reconnectAttempt = 0;
    this.reconnectCountdown = 0;
    this.pingMs = null;
    this.isOnline = true;
    this.disconnectReason = null;
    this.uptimeSeconds = 0;
    
    // Flags & Timers
    this.shouldMaintainConnection = false;
    this.isUserInitiatedDisconnect = false;
    this.reconnectTimeout = null;
    this.reconnectCountdownInterval = null;
    this.pingInterval = null;
    this.lastPongReceived = 0;
    this.uptimeInterval = null;
    this.isConnectingToLiveSession = false;
    
    // Network event listeners setup
    this._setupNetworkListeners();
  }
  
  // ===== NETWORK EVENT LISTENERS =====
  _setupNetworkListeners() {
    // SADECE live session aktifken çalışsın
    if (!this.isLiveSessionActive) {
      return;
    }
    
    // Online event handler
    this.handleOnline = () => {
      this.isOnline = true;
      console.log('İnternet geri geldi. Otomatik yeniden bağlanılıyor...');
      
      if (this.shouldMaintainConnection && 
          this.connectionStatus !== 'connected' && 
          this.connectionStatus !== 'connecting') {
        
        // Temizle ve yeniden bağlan
        this._clearReconnectTimers();
        this.startLiveSession(this.clientSocket, true);
      }
      
      // Frontend'e bildir
      this.io.emit('live-connection-status', {
        agentId: this.id,
        status: 'online',
        message: 'İnternet bağlantısı geri geldi'
      });
    };
    
    // Offline event handler
    this.handleOffline = () => {
      this.isOnline = false;
      this.connectionStatus = 'offline';
      console.log('İnternet bağlantısı kesildi. Çevrimdışı.');
      
      // Temizle
      this._clearReconnectTimers();
      
      // Frontend'e bildir
      this.io.emit('live-connection-status', {
        agentId: this.id,
        status: 'offline',
        message: 'İnternet bağlantısı kayboldu. İnternet geri geldiğinde otomatik bağlanılacak.'
      });
      
      // Live session'ı kapat
      if (this.liveSession) {
        try {
          this.liveSession.close();
        } catch (error) {
          console.error('Live session kapatılırken hata:', error);
        }
        this.liveSession = null;
        this.isLiveSessionActive = false;
      }
    };
    
    // Event listeners'ı ekle (tarayıcı tarafında çalışır, Node.js tarafında gerekirse)
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
    }
  }
  
  // ===== RECONNECT TIMERS TEMİZLEME =====
  _clearReconnectTimers() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.reconnectCountdownInterval) {
      clearInterval(this.reconnectCountdownInterval);
      this.reconnectCountdownInterval = null;
    }
  }
  
  // ===== UPTIME TRACKING =====
  _startUptimeTracking() {
    this.uptimeSeconds = 0;
    if (this.uptimeInterval) {
      clearInterval(this.uptimeInterval);
    }
    
    this.uptimeInterval = setInterval(() => {
      this.uptimeSeconds++;
      
      // Frontend'e uptime güncellemesi gönder
      this.io.emit('live-connection-status', {
        agentId: this.id,
        status: this.connectionStatus,
        uptime: this.uptimeSeconds,
        ping: this.pingMs
      });
    }, 1000);
  }
  
  _stopUptimeTracking() {
    if (this.uptimeInterval) {
      clearInterval(this.uptimeInterval);
      this.uptimeInterval = null;
    }
    this.uptimeSeconds = 0;
  }
  
  _formatUptime(totalSec) {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  
  // ===== PING/PONG HEARTBEAT SİSTEMİ =====
  _startHeartbeat() {
    // Google Live API zaten kendi bağlantı yönetimini yapıyor
    // Ek heartbeat sistemi gerekmeyebilir, çakışmayı önlemek için devre dışı
    console.log('Google Live API uses its own connection management, skipping custom heartbeat');
    this.lastPongReceived = Date.now();
    
    // Heartbeat'i devre dışı bırak - Google Live API kendi bağlantı yönetimini yapıyor
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
  
  _stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.pingMs = null;
  }
  
  _handlePong(timestamp) {
    // Google Live API kendi bağlantı yönetimini kullandığı için ping/pong gerekmiyor
    // Ancak frontend uyumluluğu için boş implementasyon
    console.log('Pong received (Google Live API uses its own connection management)');
    this.lastPongReceived = Date.now();
  }
  
  // ===== BAĞLANTI KOPMASI HANDLER =====
  _handleConnectionDrop(reason = 'Bağlantı beklenmedik bir şekilde koptu') {
    console.log(`Agent ${this.id} connection drop: ${reason}`);
    
    // Çalışan kuyruk görevini tespit et ve güncelle
    this._handleQueueTaskOnConnectionLost();
    
    // Session'ı temizle (zaten kapalı olabilir, kontrol et)
    if (this.liveSession) {
      try {
        this.liveSession.close();
      } catch (error) {
        console.error('Live session kapatılırken hata:', error);
      }
      this.liveSession = null;
    }
    
    this.isLiveSessionActive = false;
    this.clientSocket = null;
    
    // Heartbeat ve uptime'ı durdur
    this._stopHeartbeat();
    this._stopUptimeTracking();
    
    // Network listeners'ı temizle
    this._cleanupNetworkListeners();
    
    // Status güncelle
    this.status = 'Hazır';
    this.io.emit('agent-status', {
      agentId: this.id,
      status: 'Hazır'
    });
    
    // Ana agent'ın status'ünü de güncelle
    if (this.mainAgent) {
      this.mainAgent.status = 'Hazır';
    }
    
    // Eğer kullanıcı manuel kapatmadıysa auto-reconnect
    if (!this.isUserInitiatedDisconnect && this.shouldMaintainConnection && this.autoReconnect) {
      this._startAutoReconnect(reason);
    } else {
      // Kullanıcı manuel kapattı veya auto-reconnect kapalı
      this.connectionStatus = 'disconnected';
      this._clearReconnectTimers();
      
      this.io.emit('live-connection-status', {
        agentId: this.id,
        status: 'disconnected',
        message: 'Bağlantı kapalı. Sesli konuşmak için mikrofonu başlatın.',
        reason: reason
      });
    }
  }
  
  // ===== BAĞLANTI KOPMASINDA KUYRUK GÖREVİ YÖNETİMİ =====
  _handleQueueTaskOnConnectionLost() {
    // Çalışan kuyruk görevini bul
    const processingItem = this.messageQueue.find(item => item.status === 'processing');
    
    if (processingItem) {
      console.log(`Agent ${this.id} connection lost during processing queue item: ${processingItem.id}`);
      
      // Görev durumunu 'connection_lost' olarak işaretle
      processingItem.status = 'connection_lost';
      processingItem.connectionLostAt = new Date().toISOString();
      processingItem.originalContent = processingItem.content; // Orijinal içeriği sakla
      
      // Görev içeriğini güncelle - bağlantı kopup yeniden geldiğinde gönderilecek mesaj
      const reconnectionMessage = `Bu görev bağlantı koptu, şimdi yeniden sana gönderildi. İlk kez görüyorsan görevi yap, görüyordun sa kaldığın yerden devam et, bitirdiysen bunu yok say. Orijinal görev: ${processingItem.content}`;
      
      processingItem.content = reconnectionMessage;
      processingItem.label = this.buildQueueLabel(reconnectionMessage, processingItem.source, `⚠️ Bağlantı koptu: ${processingItem.label}`);
      
      // Kuyruk güncellemesini yayınla
      this.broadcastQueueUpdate();
      
      console.log(`Agent ${this.id} queue item marked as connection_lost and will be resent on reconnection`);
    }
  }
  
  // ===== BAĞLANTI GERİ GELDİĞİNDE KUYRUK GÖREVÜ YENİDEN GÖNDERME =====
  _handleQueueTaskOnReconnection() {
    // Bağlantı kopup bekleyen görevleri bul
    const connectionLostItems = this.messageQueue.filter(item => item.status === 'connection_lost');
    
    if (connectionLostItems.length > 0) {
      console.log(`Agent ${this.id} found ${connectionLostItems.length} connection_lost queue items to resend`);
      
      connectionLostItems.forEach(item => {
        // Görev durumunu 'waiting' olarak güncelle
        item.status = 'waiting';
        item.reconnectionAttempt = (item.reconnectionAttempt || 0) + 1;
        item.reconnectedAt = new Date().toISOString();
        
        console.log(`Agent ${this.id} queue item ${item.id} marked for reprocessing (attempt #${item.reconnectionAttempt})`);
      });
      
      // Kuyruk güncellemesini yayınla
      this.broadcastQueueUpdate();
      
      // İlk görevi işlemeye başla
      if (this.isReadyForQueue()) {
        this.processNextInQueue();
      }
    }
  }
  
  // ===== GÖREVİN DAHA ÖNCE TAMAMLANIP TAMAMLANMADIĞINI KONTROL ET =====
  _checkIfTaskAlreadyCompleted(taskContent) {
    if (!taskContent || this.history.length === 0) {
      return false;
    }
    
    // Orijinal görev içeriğini al (bağlantı kopup eklenen mesajın içindeki orijinal görev)
    const originalTask = this._extractOriginalTask(taskContent);
    if (!originalTask) {
      return false;
    }
    
    // History'de benzer bir görev tamamlanmış mı kontrol et
    // Son 10 mesajı kontrol et (performans için)
    const recentHistory = this.history.slice(-10);
    
    for (const message of recentHistory) {
      if (message.role === 'assistant' && message.content) {
        // Assistant'ın verdiği yanıtın görevle ilgili olup olmadığını kontrol et
        // Basit bir benzerlik kontrolü - daha gelişmiş bir algoritma eklenebilir
        if (this._isTaskRelatedToResponse(originalTask, message.content)) {
          console.log(`Agent ${this.id} task appears to be already completed based on history`);
          return true;
        }
      }
    }
    
    return false;
  }
  
  // ===== BAĞLANTI KUPUK EKLENEN MESAJDAN ORİJİNAL GÖREVİ ÇIKAR =====
  _extractOriginalTask(content) {
    if (!content) return null;
    
    // Bağlantı kopup eklenen mesaj formatı:
    // "Bu görev bağlantı koptu, şimdi yeniden sana gönderildi. İlk kez görüyorsan görevi yap, görüyordun sa kaldığın yerden devam et, bitirdiysen bunu yok say. Orijinal görev: {orijinal_görev}"
    
    const match = content.match(/Orijinal görev:\s*(.+)$/);
    if (match && match[1]) {
      return match[1].trim();
    }
    
    // Eğer format bulunamazsa, orijinal içeriği döndür
    return content;
  }
  
  // ===== GÖREVİN YANITLA İLGİLİ OLUP OLMADIĞINI KONTROL ET =====
  _isTaskRelatedToResponse(task, response) {
    if (!task || !response) return false;
    
    // Basit anahtar kelime eşleşmesi
    const taskLower = task.toLowerCase();
    const responseLower = response.toLowerCase();
    
    // Görevdeki anahtar kelimeleri yanıtta ara
    const taskWords = taskLower.split(/\s+/).filter(word => word.length > 3); // 3 karakterden uzun kelimeler
    
    let matchCount = 0;
    for (const word of taskWords) {
      if (responseLower.includes(word)) {
        matchCount++;
      }
    }
    
    // %50'den fazla kelime eşleşiyorsa görevin ilgili olduğunu varsay
    const threshold = Math.max(2, Math.floor(taskWords.length * 0.5));
    return matchCount >= threshold;
  }
  
  // ===== AUTO-RECONNECT MANTIĞI =====
  _startAutoReconnect(reason) {
    if (this.isUserInitiatedDisconnect || !this.shouldMaintainConnection) {
      console.log(`Agent ${this.id} skipping auto-reconnect (disconnect was intentional or connection maintenance disabled)`);
      return;
    }

    if (!this.isOnline) {
      this.connectionStatus = 'offline';
      this.io.emit('live-connection-status', {
        agentId: this.id,
        status: 'offline',
        message: 'İnternet bağlantısı kesildi. Çevrimdışı.',
        reason: reason
      });
      return;
    }
    
    this.connectionStatus = 'reconnecting';
    const nextAttempt = this.reconnectAttempt + 1;
    this.reconnectAttempt = nextAttempt;
    
    // Agent status güncelle: Yeniden bağlanırken "Bekleniyor"
    this.status = 'Bekleniyor';
    this.io.emit('agent-status', {
      agentId: this.id,
      status: 'Bekleniyor'
    });
    
    // Ana agent status güncelle
    if (this.mainAgent) {
      this.mainAgent.status = 'Bekleniyor';
    }
    
    // Backoff delay: 2s, 3s, 4s, 5s (capped at 6s)
    const delaySec = Math.min(2 + (nextAttempt - 1), 6);
    this.reconnectCountdown = delaySec;
    
    this.io.emit('live-connection-status', {
      agentId: this.id,
      status: 'reconnecting',
      message: `Bağlantı koptu. ${delaySec} saniye içinde otomatik yeniden bağlanılıyor (Deneme #${nextAttempt})...`,
      countdown: this.reconnectCountdown,
      attempt: nextAttempt,
      reason: reason
    });
    
    // Countdown başlat
    if (this.reconnectCountdownInterval) {
      clearInterval(this.reconnectCountdownInterval);
    }
    
    let count = delaySec;
    this.reconnectCountdownInterval = setInterval(() => {
      count -= 1;
      if (count <= 0) {
        clearInterval(this.reconnectCountdownInterval);
        this.reconnectCountdownInterval = null;
      } else {
        this.reconnectCountdown = count;
        this.io.emit('live-connection-status', {
          agentId: this.id,
          status: 'reconnecting',
          message: `Bağlantı koptu. ${count} saniye içinde otomatik yeniden bağlanılıyor (Deneme #${nextAttempt})...`,
          countdown: count,
          attempt: nextAttempt
        });
      }
    }, 1000);
    
    // Timeout ile yeniden bağlan
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    
    this.reconnectTimeout = setTimeout(() => {
      console.log(`Auto-reconnect executing (Attempt #${nextAttempt})...`);
      this.startLiveSession(this.clientSocket, true);
    }, delaySec * 1000);
  }

  async _executeModelMessage(content, options = {}) {
    // Kuyruk sistemi üzerinden gelen mesajları live session'a gönder
    console.log(`Agent ${this.id} _executeModelMessage called with content: ${content}`);
    console.log(`Agent ${this.id} source: ${options.source}`);
    console.log(`Agent ${this.id} live session active: ${this.isLiveSessionActive}`);
    console.log(`Agent ${this.id} live session exists: ${!!this.liveSession}`);
    
    // Bağlantı kopup gelen görev kontrolü
    const processingItem = this.messageQueue.find(item => item.status === 'processing');
    if (processingItem && processingItem.reconnectionAttempt > 0) {
      console.log(`Agent ${this.id} processing reconnection task (attempt #${processingItem.reconnectionAttempt})`);
      
      // Görevin daha önce tamamlanıp tamamlanmadığını kontrol et
      // History'de benzer bir görev var mı kontrol et
      const isAlreadyCompleted = this._checkIfTaskAlreadyCompleted(processingItem.originalContent || processingItem.content);
      
      if (isAlreadyCompleted) {
        console.log(`Agent ${this.id} task was already completed, skipping reconnection task`);
        // Görevi tamamlanmış olarak işaretle ve geç
        this.completeCurrentQueueItem();
        return;
      }
    }
    
    // History ve frontend güncellemesi base Agent.js'te yapılıyor, burası boş
    // Duplicate message önlemek için history'ye ekleme yapmıyoruz
    
    if (this.liveSession && this.isLiveSessionActive) {
      console.log(`Agent ${this.id} sending queued message to live session`);

      try {
        // Live session'a gönder (cron formatını koruyarak)
        this.liveSession.sendRealtimeInput({
          text: content // Cron formatında mesaj gönder
        });
        console.log(`Agent ${this.id} queued message sent successfully with cron format`);

        // Mesaj gönderildi ama live session asenkron olarak yanıt verecek
        // generationComplete'da completeCurrentQueueItem çağrılacak
      } catch (error) {
        console.error(`Agent ${this.id} error sending queued message:`, error);
        // Hata durumunda kuyruk görevini tamamla
        this.completeCurrentQueueItem();
      }
    } else {
      console.log(`Agent ${this.id} no active live session, cannot send queued message`);
      console.log(`Agent ${this.id} waiting for live session to be active`);
      // Session yoksa kuyruk görevini TAMAMLAMA - beklemeye devam et
      // Görevi waiting durumunda bırak, session aktif olduğunda tekrar denenecek

      // Hata durumunda kuyruk görevini tamamla
      if (options.source === 'cron') {
        console.log(`Agent ${this.id} cron task cannot be executed without live session, completing queue item`);
        this.completeCurrentQueueItem();
        this.processNextInQueue();
      }
    }
  }

  completeCurrentQueueItem() {
    console.log(`Agent ${this.id} completeCurrentQueueItem called`);
    console.log(`Agent ${this.id} queue before:`, this.messageQueue.map(item => ({ id: item.id, status: item.status })));

    const processingItem = this.messageQueue.find(item => item.status === 'processing');
    if (processingItem) {
      console.log(`Agent ${this.id} marking item as completed: ${processingItem.id}`);
      processingItem.status = 'completed';
    }

    this.messageQueue = this.messageQueue.filter(item => item.status !== 'completed');
    console.log(`Agent ${this.id} queue after filtering, length: ${this.messageQueue.length}`);
    console.log(`Agent ${this.id} queue after:`, this.messageQueue.map(item => ({ id: item.id, status: item.status })));

    // Ana agent'ın kuyruğunu güncelle ve broadcast et
    if (this.mainAgent) {
      this.mainAgent.messageQueue = this.messageQueue;
      this.mainAgent.broadcastQueueUpdate();
      console.log(`Agent ${this.id} updated main agent queue and broadcasted`);

      // Ana agent'ın history'sini güncelle
      this.mainAgent.history = this.history;
      if (this.mainAgent.dataManager) {
        this.mainAgent.dataManager.saveAgent(this.mainAgent);
      }
    } else {
      // Ana agent yoksa kendi broadcast et
      this.broadcastQueueUpdate();
      console.log(`Agent ${this.id} broadcasted queue update (no main agent)`);
    }

    // Kuyrukta başka bekleyen veya çalışan görev var mı kontrol et
    const hasMoreItems = this.messageQueue.some(item => item.status === 'waiting' || item.status === 'processing');

    if (hasMoreItems) {
      // Otomatik olarak sıradaki görevi işle (sadece live session aktifse)
      if (this.isLiveSessionActive) {
        setTimeout(() => {
          this.processNextInQueue();
        }, 100);
      }
    } else {
      // Tüm görevler bitti!
      if (!this.isTrueLiveMode) {
        this.status = 'Hazır';
        this.io.emit('agent-status', {
          agentId: this.id,
          status: 'Hazır'
        });
        if (this.mainAgent) {
          this.mainAgent.status = 'Hazır';
        }

        // True Live mod kapalıysa oturumu otomatik kapat
        if (this.isLiveSessionActive) {
          console.log(`Agent ${this.id} all queue tasks completed and True Live mode is OFF. Closing live session automatically.`);
          setTimeout(() => {
            this.stopLiveSession(true);
          }, 100);
        }
      } else {
        // True Live modu açık, status Canlı olarak kalsın
        this.status = 'Canlı';
        this.io.emit('agent-status', {
          agentId: this.id,
          status: 'Canlı'
        });
        if (this.mainAgent) {
          this.mainAgent.status = 'Canlı';
        }
      }
    }
  }

  processNextInQueue() {
    console.log(`Agent ${this.id} processNextInQueue called`);
    console.log(`Agent ${this.id} queue length: ${this.messageQueue.length}`);
    console.log(`Agent ${this.id} queue items:`, this.messageQueue.map(item => ({ id: item.id, status: item.status, label: item.label })));
    
    // Eğer şu an çalışan bir görev varsa sıradakine geçme (sıralı çalışma garantisi)
    const currentlyProcessing = this.messageQueue.some(item => item.status === 'processing');
    if (currentlyProcessing) {
      console.log(`Agent ${this.id} queue item is already processing, waiting for it to complete`);
      return;
    }

    const nextItem = this.messageQueue.find(item => item.status === 'waiting');
    if (nextItem) {
      console.log(`Agent ${this.id} found waiting item: ${nextItem.id}, marking as processing`);
      nextItem.status = 'processing';
      nextItem.startedAt = new Date().toISOString();
      
      // Live modda status "Canlı" kalsın
      this.status = 'Canlı';
      this.io.emit('agent-status', {
        agentId: this.id,
        status: 'Canlı'
      });
      
      // Ana agent'ın status'ünü de güncelle
      if (this.mainAgent) {
        this.mainAgent.status = 'Canlı';
      }
      
      // Ana agent'ın kuyruğunu güncelle
      if (this.mainAgent) {
        this.mainAgent.messageQueue = this.messageQueue;
        this.mainAgent.broadcastQueueUpdate();
      } else {
        this.broadcastQueueUpdate();
      }
      
      // Live session'a gönder
      this._executeModelMessage(nextItem.content, {
        source: nextItem.source,
        taskName: nextItem.taskName,
        taskSchedule: nextItem.taskSchedule,
        taskTimestamp: nextItem.taskTimestamp,
        senderAgentId: nextItem.senderAgentId,
        senderAgentName: nextItem.senderAgentName,
        originalMessage: nextItem.originalMessage
      });
    } else {
      console.log(`Agent ${this.id} no waiting item found in queue`);
      
      // Live modda status "Canlı" kalsın
      this.status = 'Canlı';
      this.io.emit('agent-status', {
        agentId: this.id,
        status: 'Canlı'
      });
      
      // Ana agent'ın status'ünü de güncelle
      if (this.mainAgent) {
        this.mainAgent.status = 'Canlı';
        this.mainAgent.io.emit('agent-status', {
          agentId: this.mainAgent.id,
          status: 'Canlı'
        });
      }
    }
  }
  
  // Override enqueueMessage to auto-process when live session is active
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
      originalMessage: options.originalMessage
    };

    this.messageQueue.push(item);
    this.broadcastQueueUpdate();

    // Ana agent'ın kuyruğunu güncelle
    if (this.mainAgent) {
      this.mainAgent.messageQueue = this.messageQueue;
      this.mainAgent.broadcastQueueUpdate();
    }

    // Eğer şu an canlı oturum başlatılıyorsa, mesaja müdahale etme (oturum açılınca işlenecek)
    if (this.isConnectingToLiveSession) {
      console.log(`Agent ${this.id} live session is connecting, item queued`);
      return item.id;
    }

    // Live session aktif değilse, görevi işlemek için otomatik olarak live session başlat
    if (!this.isLiveSessionActive) {
      console.log(`Agent ${this.id} live session not active, starting automatic live session for queued item`);
      this.isConnectingToLiveSession = true;
      this.startLiveSession(this.clientSocket).finally(() => {
        this.isConnectingToLiveSession = false;
      }).catch(err => {
        console.error(`Agent ${this.id} error starting automatic live session:`, err);
      });
    } else {
      const hasProcessingItem = this.messageQueue.some(item => item.status === 'processing');
      if (!hasProcessingItem) {
        console.log(`Agent ${this.id} live session active and no processing item, auto-processing queue item`);
        setTimeout(() => {
          this.processNextInQueue();
        }, 100);
      } else {
        console.log(`Agent ${this.id} live session active but has processing item, item will wait`);
      }
    }

    return item.id;
  }
  
  // API Key güncellemesi (AgentManager tarafından çağrılır)
  updateApiKey(newApiKey) {
    this.apiKey = newApiKey;
    console.log(`GoogleLiveAgent ${this.id} API key updated:`, newApiKey ? '***SET***' : '***EMPTY***');
  }

  async start() {
    await super.start();
    console.log(`GoogleLiveAgent ${this.id} started (ready for live session)`);
    
    // Kuyruk işlemcisini başlatma - ana agent'ın kuyruğunu kullanacağız
  }

  async startLiveSession(clientSocket, isAutoReconnect = false) {
    try {
      if (this.isLiveSessionActive) {
        console.log(`Agent ${this.id} live session already active`);
        this.isConnectingToLiveSession = false;
        return true; // Zaten aktif, başarılı say
      }

      // Auto-reconnect olmayan durumlarda reset
      if (!isAutoReconnect) {
        this.reconnectAttempt = 0;
        this.disconnectReason = null;
        this.isUserInitiatedDisconnect = false;
      } else {
        // Auto-reconnect durumunda bağlantı kopup gelen görevleri işle
        this._handleQueueTaskOnReconnection();
      }
      
      // Reconnect timers'ı temizle
      this._clearReconnectTimers();

      // Connection ayarla
      this.shouldMaintainConnection = true;
      this.connectionStatus = isAutoReconnect ? 'reconnecting' : 'connecting';
      
      // Agent status güncelle: Yeniden bağlanırken "Bekleniyor"
      this.status = 'Bekleniyor';
      this.io.emit('agent-status', {
        agentId: this.id,
        status: 'Bekleniyor'
      });
      
      // Ana agent status güncelle
      if (this.mainAgent) {
        this.mainAgent.status = 'Bekleniyor';
      }
      
      // Frontend'e bağlanıyor bildirimi
      this.io.emit('live-connection-status', {
        agentId: this.id,
        status: this.connectionStatus,
        message: isAutoReconnect ? 'Yeniden bağlanılıyor...' : 'Bağlanıyor...'
      });


      console.log(`Agent ${this.id} starting Google Live session`);

      const ai = new GoogleGenAI({
        apiKey: this.apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      // Tool tanımlarını hazırla
      const tools = this._getToolDeclarations();

      // Sistem promptunu hazırla
      const systemInstruction = this._buildSystemInstruction();

      // Google Live session başlat (test kodundaki gibi)
      const session = await ai.live.connect({
        model: this.model,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: systemInstruction,
          tools: tools
        },
        callbacks: {
          onmessage: async (message) => {
            await this._handleLiveMessage(message, clientSocket);
          },
          onerror: (err) => {
            console.warn('Gemini Live session error:', err?.message || err);
            // Google Live API kendi bağlantı yönetimini yapıyor, hata durumunda auto-reconnect başlat
            if (!this.isUserInitiatedDisconnect && this.shouldMaintainConnection && this.autoReconnect) {
              console.log('Google Live API error detected, triggering auto-reconnect...');
              this._handleConnectionDrop('Gemini Live akış bağlantısı kesildi: ' + (err?.message || 'Oturum hatası'));
            }
          },
          onclose: (closeEvt) => {
            console.log('Gemini Live session closed:', closeEvt);
            // Google Live API kendi bağlantı yönetimini yapıyor, kapanma durumunda auto-reconnect başlat
            if (!this.isUserInitiatedDisconnect && this.shouldMaintainConnection && this.autoReconnect) {
              console.log('Google Live API close detected, triggering auto-reconnect...');
              this._handleConnectionDrop('Gemini Live oturumu sonlandı');
            }
          }
        }
      });

      this.liveSession = session;
      this.clientSocket = clientSocket;
      this.isLiveSessionActive = true;
      this.connectionStatus = 'connected';
      this.reconnectCountdown = 0;
      this.reconnectAttempt = 0;
      this.disconnectReason = null;

      console.log(`Agent ${this.id} Google Live session started successfully`);

      // Agent status güncelle: Bağlantı başarılı olduğunda "Canlı"
      this.status = 'Canlı';
      this.io.emit('agent-status', {
        agentId: this.id,
        status: 'Canlı'
      });
      
      // Ana agent status güncelle
      if (this.mainAgent) {
        this.mainAgent.status = 'Canlı';
      }
      
      // Frontend'e bildir
      this.io.emit('live-session-started', { agentId: this.id });
      this.io.emit('live-connection-status', {
        agentId: this.id,
        status: 'connected',
        message: 'Gemini Live ile konuşabilirsiniz! O sizi her an duyuyor.',
        uptime: 0,
        ping: null
      });
      
      // Heartbeat ve uptime'ı başlat
      this._startHeartbeat();
      this._startUptimeTracking();
      
      // Network listeners'ı başlat (sadece live session aktifken)
      this._setupNetworkListeners();
      
      // Kuyrukta bekleyen görevleri işle (sadece waiting durumundakiler)
      const waitingItems = this.messageQueue.filter(item => item.status === 'waiting');
      if (waitingItems.length > 0) {
        console.log(`Agent ${this.id} processing ${waitingItems.length} waiting queued items after session start`);
        this.processNextInQueue();
      } else {
        console.log(`Agent ${this.id} no waiting items in queue, skipping queue processing`);
      }
      
      // Ana agent varsa, onun kuyruğunu senkronize et
      if (this.mainAgent) {
        this.mainAgent.messageQueue = this.messageQueue;
        this.mainAgent.broadcastQueueUpdate();
      }

      this.isConnectingToLiveSession = false;
      return true; // Başarıyla bağlandı

    } catch (error) {
      this.isConnectingToLiveSession = false;
      console.error(`Agent ${this.id} error starting live session:`, error);
      
      // Status güncelle: Hazır
      this.status = 'Hazır';
      this.connectionStatus = 'disconnected';
      this.io.emit('agent-status', {
        agentId: this.id,
        status: 'Hazır'
      });
      
      this.io.emit('live-connection-status', {
        agentId: this.id,
        status: 'disconnected',
        message: 'Bağlantı hatası: ' + error.message,
        error: error.message
      });
      
      // Auto-reconnect denemesi
      if (!this.isUserInitiatedDisconnect && this.shouldMaintainConnection && this.autoReconnect) {
        this._startAutoReconnect(error.message);
      }
      
      throw error;
    }
  }

  stopLiveSession(force = false) {
    if (!this.isLiveSessionActive) {
      return;
    }

    // Oturum kapatma (kullanıcı veya otomatik tamamlanma)
    this.isUserInitiatedDisconnect = true;
    this.shouldMaintainConnection = false;
    this._clearReconnectTimers();

    // Kuyruk kontrolü: force değilse ve kuyrukta görev varsa kapatmayı engelle
    const hasQueueItems = this.messageQueue.some(item => item.status === 'waiting' || item.status === 'processing');
    if (hasQueueItems && !force) {
      console.log(`Agent ${this.id} cannot switch to normal mode - live queue has tasks`);
      this.io.emit('agent-error', {
        agentId: this.id,
        error: 'Normal moda geçiş yapılamıyor - Live kuyrukta görev var. Önce tüm görevleri tamamlayın.'
      });
      return;
    }

    console.log(`Agent ${this.id} stopping Google Live session (user initiated)`);

    // Buffer'ı temizle
    if (this.textTimeout) {
      clearTimeout(this.textTimeout);
      this.textTimeout = null;
    }
    if (this.textBuffer && this.textBuffer.trim()) {
      // Buffer'daki metni gönder
      this.history.push({
        role: 'assistant',
        content: this.textBuffer,
        timestamp: new Date().toISOString()
      });

      this.io.emit('agent-message', {
        agentId: this.id,
        message: {
          content: this.textBuffer,
          role: 'assistant',
          timestamp: new Date().toISOString()
        }
      });
      this.textBuffer = '';
    }

    // Heartbeat ve uptime'ı durdur
    this._stopHeartbeat();
    this._stopUptimeTracking();
    
    // Reconnect timers'ı temizle
    this._clearReconnectTimers();
    
    // Network listeners'ı temizle
    this._cleanupNetworkListeners();

    if (this.liveSession) {
      try {
        this.liveSession.close();
      } catch (error) {
        console.error(`Error closing live session:`, error);
      }
      this.liveSession = null;
    }

    this.isLiveSessionActive = false;
    this.clientSocket = null;
    this.connectionStatus = 'disconnected';

    // Status güncelle: Hazır
    this.status = 'Hazır';
    this.io.emit('agent-status', {
      agentId: this.id,
      status: 'Hazır'
    });
    
    // Ana agent'ın status'ünü de güncelle
    if (this.mainAgent) {
      this.mainAgent.status = 'Hazır';
    }

    this.clientSocket = null;
    this.isLiveSessionActive = false;

    console.log(`Agent ${this.id} Google Live session stopped (user initiated)`);

    // Frontend'e bildir
    this.io.emit('live-session-stopped', { agentId: this.id });
    this.io.emit('live-connection-status', {
      agentId: this.id,
      status: 'disconnected',
      message: 'Bağlantı kapalı. Sesli konuşmak için mikrofonu başlatın.'
    });
    
    // Kuyrukta bekleyen görevleri temizleme - normal moda geçiş için sakla
    // Ana agent'ın kuyruğunu güncelle (temizleme)
    if (this.mainAgent) {
      this.mainAgent.messageQueue = this.messageQueue;
      this.mainAgent.broadcastQueueUpdate();
      
      // Ana agent'ın history'sini güncelle
      this.mainAgent.history = this.history;
      if (this.mainAgent.dataManager) {
        this.mainAgent.dataManager.saveAgent(this.mainAgent);
      }
    }
  }

  // ===== TRUE LIVE MODE ALIAS METHODs =====
  // AgentManager bu metodları bekliyor. True Live ve normal Live aynı Google Live API'yi kullanıyor.
  
  setTrueLiveMode(enabled) {
    // True Live modu etkinleştir/devre dışı bırak (flag)
    this.isTrueLiveMode = enabled;
    this.trueLiveMode = enabled;
    console.log(`Agent ${this.id} True Live mode set to: ${enabled}`);
  }

  async startTrueLiveSession(clientSocket) {
    // True Live session = normal Live session
    return await this.startLiveSession(clientSocket || this.clientSocket);
  }

  stopTrueLiveSession() {
    // True Live durdurma = normal Live durdurma
    this.stopLiveSession();
  }

  handleTrueLiveAudioInput(audioData) {
    // True Live ses girdisi = normal ses girdisi
    this.handleLiveAudioInputFromClient(audioData);
  }

  handleTrueLiveTextInput(text) {
    // True Live metin girdisi = normal metin girdisi
    this.handleLiveTextInput(text);
  }

  handleLiveAudioInput(audioData) {
    if (!this.liveSession || !this.isLiveSessionActive) {
      console.log(`Agent ${this.id} no active live session - skipping audio input`);
      return;
    }

    try {
      // Test kodundaki gibi doğrudan ses gönder
      this.liveSession.sendRealtimeInput({
        audio: {
          data: audioData,
          mimeType: "audio/pcm;rate=16000"
        }
      });
    } catch (error) {
      console.error(`Error sending audio to live session:`, error);
    }
  }

  handleLiveAudioInputFromClient(audioData) {
    if (!this.liveSession || !this.isLiveSessionActive) {
      console.log(`Agent ${this.id} no active live session - skipping audio input`);
      return;
    }

    try {
      // Client'tan gelen base64 ses verisini gönder
      this.liveSession.sendRealtimeInput({
        audio: {
          data: audioData,
          mimeType: "audio/pcm;rate=16000"
        }
      });
    } catch (error) {
      console.error(`Error sending audio to live session:`, error);
    }
  }

  handleLiveTextInput(text, options = {}) {
    if (!this.liveSession || !this.isLiveSessionActive) {
      console.log(`Agent ${this.id} no active live session - skipping text input`);
      return;
    }

    try {
      // Role belirleme (normal moddaki mantıkla aynı)
      let messageRole = 'user';
      if (options.source === 'cron') {
        messageRole = 'cron';
      } else if (options.source === 'agent') {
        messageRole = 'agent';
      } else if (options.source === 'system') {
        messageRole = 'system';
      }
      
      // Mesaj içeriği belirleme (cron formatını koru)
      const messageContent = text; // text zaten cron formatında geliyor
      
      // History'ye ekle (doğru rol ile)
      const userMessage = {
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
      this.history.push(userMessage);
      this.sortHistoryByTimestamp();
      this.applyMemoryLimit();
      
      // Live session'a gönder (cron formatını koruyarak)
      this.liveSession.sendRealtimeInput({
        text: messageContent
      });
      
      // Save to storage
      if (this.dataManager) {
        this.dataManager.saveAgent(this);
      }
      
      // Frontend'e agent-message event'i gönder (chat'de görünmesi için - doğru rol ile)
      this.io.emit('agent-message', {
        agentId: this.id,
        message: userMessage
      });
      
      // Ana agent'ın history'sini güncelle
      if (this.mainAgent) {
        this.mainAgent.history = this.history;
        if (this.mainAgent.dataManager) {
          this.mainAgent.dataManager.saveAgent(this.mainAgent);
        }
      }
    } catch (error) {
      console.error(`Error sending text to live session:`, error);
    }
  }
  
  // ===== PONG HANDLER (Frontend'ten gelen pong mesajları için) =====
  handlePong(timestamp) {
    this._handlePong(timestamp);
  }
  
  // ===== AUTO-RECONNECT KONTROLÜ =====
  setAutoReconnect(enabled) {
    this.autoReconnect = enabled;
    console.log(`Agent ${this.id} auto-reconnect ${enabled ? 'enabled' : 'disabled'}`);
  }
  
  // ===== NETWORK LISTENERS TEMİZLEME =====
  _cleanupNetworkListeners() {
    if (typeof window !== 'undefined') {
      if (this.handleOnline) {
        window.removeEventListener('online', this.handleOnline);
      }
      if (this.handleOffline) {
        window.removeEventListener('offline', this.handleOffline);
      }
    }
  }
  
  // ===== MANUAL RECONNECT =====
  async manualReconnect() {
    console.log(`Agent ${this.id} manual reconnect requested`);
    this.isUserInitiatedDisconnect = false;
    this.shouldMaintainConnection = true;
    this.reconnectAttempt = 0;
    this.disconnectReason = null;
    
    // Önce mevcut session'ı kapat
    if (this.liveSession) {
      try {
        this.liveSession.close();
      } catch (error) {
        console.error('Error closing live session for manual reconnect:', error);
      }
      this.liveSession = null;
    }
    
    this.isLiveSessionActive = false;
    this._clearReconnectTimers();
    
    // Yeniden bağlan
    return await this.startLiveSession(this.clientSocket, true);
  }

  async _handleLiveMessage(message, clientSocket) {
    // Ses içeriğini kontrol et - Sadece True Live modu aktifse ses verisini istemciye ilet
    const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (audio && this.isTrueLiveMode) {
      // Doğrudan base64 ses verisini gönder
      this.io.emit('live-audio-response', { agentId: this.id, audioData: audio });
    }

    // Text içeriğini kontrol et
    const text = message.serverContent?.modelTurn?.parts?.[0]?.text;
    if (text) {
      console.log(`Agent ${this.id} received text chunk, current status: ${this.status}`);
      
      // GoogleAgent.js formatında streaming buffer
      if (!this.isStreamingResponse) {
        this.isStreamingResponse = true;
        this.currentResponseBuffer = '';
        this.currentResponseStartTime = new Date().toISOString();
        
        // Live modda status "Canlı" kalsın, "Gorev_yapiyor" olmasın
        this.status = 'Canlı';
        this.io.emit('agent-status', {
          agentId: this.id,
          status: 'Canlı'
        });
        
        // Ana agent'ın status'ünü de güncelle
        if (this.mainAgent) {
          this.mainAgent.status = 'Canlı';
        }
        
        console.log(`Agent ${this.id} status kept as Canlı (live mode)`);
      }

      // Add chunk to streaming buffer
      this.currentResponseBuffer += text;

      // Stream text to client for real-time display (GoogleAgent.js formatında)
      this.io.emit('agent-stream', {
        agentId: this.id,
        chunk: text,
        timestamp: this.currentResponseStartTime
      });

      // Save each chunk to history for persistence (GoogleAgent.js formatında)
      this.history.push({
        role: 'assistant',
        content: text,
        timestamp: new Date().toISOString(),
        isStreamChunk: true,
        streamStartTime: this.currentResponseStartTime
      });

      // Apply memory limit (less frequent for streaming)
      if (this.history.length % 10 === 0) {
        this.applyMemoryLimit();
      }

      // Save to storage after each chunk
      if (this.dataManager) {
        this.dataManager.saveAgent(this);
      }
      
      // agent-message gönderme - sadece agent-stream kullan
      // Frontend zaten stream event'ini işliyor ve birleştiriyor
    }

    // Kullanıcı konuşma transkriptini kontrol et
    const inputTrans = message.serverContent?.inputTranscription?.text;
    if (inputTrans) {
      // Konuşma geçmişine ekle (kullanıcı sesli girişi olduğu için user rolü)
      const userMessage = {
        role: 'user',
        content: inputTrans,
        timestamp: new Date().toISOString(),
        source: 'user' // Sesli girişler her zaman user source
      };
      this.history.push(userMessage);
      
      // Sort history and apply memory limit
      this.sortHistoryByTimestamp();
      this.applyMemoryLimit();
      
      // Save to storage
      if (this.dataManager) {
        this.dataManager.saveAgent(this);
      }

      // Normal agent message formatında gönder
      this.io.emit('agent-message', {
        agentId: this.id,
        message: userMessage
      });
    }

    // Model konuşma transkriptini kontrol et
    const geminiTrans = message.serverContent?.outputTranscription?.text;
    if (geminiTrans) {
      console.log(`Agent ${this.id} received audio transcription, current status: ${this.status}`);
      
      // GoogleAgent.js formatında streaming buffer
      if (!this.isStreamingResponse) {
        this.isStreamingResponse = true;
        this.currentResponseBuffer = '';
        this.currentResponseStartTime = new Date().toISOString();
        
        // Status güncelle: Gorev_yapiyor
        this.status = 'Gorev_yapiyor';
        this.io.emit('agent-status', {
          agentId: this.id,
          status: 'Gorev_yapiyor'
        });
        
        // Ana agent'ın status'ünü de güncelle
        if (this.mainAgent) {
          this.mainAgent.status = 'Gorev_yapiyor';
        }
        
        console.log(`Agent ${this.id} status changed to Gorev_yapiyor (audio)`);
      }

      // Add chunk to streaming buffer
      this.currentResponseBuffer += geminiTrans;

      // Stream text to client for real-time display (GoogleAgent.js formatında)
      this.io.emit('agent-stream', {
        agentId: this.id,
        chunk: geminiTrans,
        timestamp: this.currentResponseStartTime
      });

      // Save each chunk to history for persistence (GoogleAgent.js formatında)
      this.history.push({
        role: 'assistant',
        content: geminiTrans,
        timestamp: new Date().toISOString(),
        isStreamChunk: true,
        streamStartTime: this.currentResponseStartTime
      });

      // Apply memory limit (less frequent for streaming)
      if (this.history.length % 10 === 0) {
        this.applyMemoryLimit();
      }

      // Save to storage after each chunk
      if (this.dataManager) {
        this.dataManager.saveAgent(this);
      }
      
      // agent-message gönderme - sadece agent-stream kullan
      // Frontend zaten stream event'ini işliyor ve birleştiriyor
    }

    // Kesme kontrolü
    if (message.serverContent?.interrupted) {
      // Reset streaming buffer (GoogleAgent.js formatında)
      this.isStreamingResponse = false;
      this.currentResponseBuffer = '';
      this.currentResponseStartTime = null;
      
      // Sort history by timestamp to ensure correct order
      this.sortHistoryByTimestamp();
      
      // Buffer'daki kalan metni history'ye kaydet
      if (this.currentResponseBuffer && this.currentResponseBuffer.trim()) {
        const assistantMessage = {
          role: 'assistant',
          content: this.currentResponseBuffer,
          timestamp: new Date().toISOString()
        };
        this.history.push(assistantMessage);
        
        // Sort history and apply memory limit
        this.sortHistoryByTimestamp();
        this.applyMemoryLimit();
        
        // Save to storage
        if (this.dataManager) {
          this.dataManager.saveAgent(this);
        }

        this.io.emit('agent-message', {
          agentId: this.id,
          message: assistantMessage
        });
      }
      
      this.io.emit('live-interrupted', { agentId: this.id });
    }

    // Check for turn complete (GoogleAgent.js formatında)
    if (message.serverContent?.turnComplete) {
      console.log(`Agent ${this.id} turn complete, changing status to Canlı`);
      
      // Reset streaming buffer (GoogleAgent.js formatında)
      this.isStreamingResponse = false;
      this.currentResponseBuffer = '';
      this.currentResponseStartTime = null;
      
      // Sort history by timestamp to ensure correct order
      this.sortHistoryByTimestamp();
      
      // Status güncelle: Canlı (konuşma bitti, session hala açık)
      this.status = 'Canlı';
      this.io.emit('agent-status', {
        agentId: this.id,
        status: 'Canlı'
      });
      
      // Ana agent'ın status'ünü de güncelle
      if (this.mainAgent) {
        this.mainAgent.status = 'Canlı';
      }
      
      // Kuyrukta processing durumunda görev varsa tamamla ve sıradakine geç
      const processingItem = this.messageQueue.find(item => item.status === 'processing');
      if (processingItem) {
        console.log(`Agent ${this.id} found processing item in queue: ${processingItem.id}, completing it`);
        this.completeCurrentQueueItem();
      } else {
        console.log(`Agent ${this.id} no processing item found in queue`);
      }
    }

    // Check for generation complete (GoogleAgent.js formatında)
    if (message.serverContent?.generationComplete) {
      console.log(`Agent ${this.id} generation complete`);
      
      // Reset streaming buffer (GoogleAgent.js formatında)
      this.isStreamingResponse = false;
      this.currentResponseBuffer = '';
      this.currentResponseStartTime = null;
      
      // Sort history by timestamp to ensure correct order
      this.sortHistoryByTimestamp();
    }

    // Tool çağrısı kontrolü
    if (message.toolCall?.functionCalls) {
      for (const call of message.toolCall.functionCalls) {
        await this._handleToolCall(call, clientSocket);
      }
    }
  }

  async _handleToolCall(call, clientSocket) {
    const { name, args, id } = call;
    const callId = id || `call-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    console.log(`TOOL CALL from Gemini: ${name}`, args);

    // Auto-add senderAgentId for sendMessageToAgent
    let toolArgs = args;
    if ((name === 'sendMessageToAgent' || name === 'agent.sendMessageToAgent') && !toolArgs.senderAgentId) {
      toolArgs = { ...toolArgs, senderAgentId: this.id };
    }

    // Tool kullanımını bildir (normal mod formatında)
    this.io.emit('agent-tool-usage', {
      agentId: this.id,
      toolUsage: {
        tool: name,
        args: toolArgs,
        result: null
      }
    });

    // Tool'u çalıştır
    let output;
    let error = null;
    try {
      // ToolManager üzerinden çalıştır (hem normal hem plugin tool'ları)
      if (this.toolManager) {
        output = await this.toolManager.executeTool(name, toolArgs, this);
      } else {
        output = { success: false, message: 'ToolManager not available' };
        error = 'ToolManager not available';
      }
    } catch (err) {
      console.error(`Error executing tool ${name}:`, err);
      output = { success: false, message: err.message };
      error = err.message;
    }

    // Tool sonucunu history'ye kaydet (GoogleAgent formatında)
    if (error) {
      // Hata durumu
      const toolErrorMessage = {
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        toolUsage: {
          tool: name,
          args: args,
          error: error,
          type: 'error'
        }
      };
      this.history.push(toolErrorMessage);
      
      // Sort history to maintain correct order
      this.sortHistoryByTimestamp();
      
      // Apply memory limit
      this.applyMemoryLimit();
      
      // Save to storage after tool error
      if (this.dataManager) {
        this.dataManager.saveAgent(this);
      }
      
      // Tool hatasını bildir (GoogleAgent formatında)
      this.io.emit('agent-tool-result', {
        agentId: this.id,
        toolUsage: {
          tool: name,
          args: args,
          result: { error: error },
          timestamp: toolErrorMessage.timestamp
        }
      });
      
      // Tool hatasını Google Live'a gönder (GoogleAgent formatında)
      try {
        await this.liveSession.sendToolResponse({
          functionResponses: [{
            id: id,
            name: name,
            response: { error: error }
          }]
        });
      } catch (sendError) {
        console.error(`Error sending tool error response to Gemini:`, sendError);
      }
    } else {
      // Başarılı durum
      const toolResultMessage = {
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        toolUsage: {
          tool: name,
          args: args,
          result: output,
          type: 'result'
        }
      };
      this.history.push(toolResultMessage);
      
      // Sort history to maintain correct order
      this.sortHistoryByTimestamp();
      
      // Apply memory limit
      this.applyMemoryLimit();
      
      // Save to storage after tool execution
      if (this.dataManager) {
        this.dataManager.saveAgent(this);
      }

      // Tool sonucunu bildir (GoogleAgent formatında)
      this.io.emit('agent-tool-result', {
        agentId: this.id,
        toolUsage: {
          tool: name,
          args: args,
          result: output,
          timestamp: toolResultMessage.timestamp
        }
      });

      // Tool sonucunu Google Live'a gönder (GoogleAgent formatında)
      try {
        await this.liveSession.sendToolResponse({
          functionResponses: [{
            id: id,
            name: name,
            response: { response: output }
          }]
        });
      } catch (sendError) {
        console.error(`Error sending tool response to Gemini:`, sendError);
      }
    }
  }

  _buildSystemInstruction() {
    let instruction = this.prompt;

    // Konuşma geçmişini ekle (son 10 mesaj)
    if (this.history && this.history.length > 0) {
      const recentHistory = this.history.slice(-1000);
      instruction += '\n\nÖnceki konuşma geçmişi:\n';
      recentHistory.forEach(msg => {
        instruction += `${msg.role}: ${msg.content}\n`;
      });
    }



    return instruction;
  }

  _getToolDeclarations() {
    const tools = [];

    // ToolManager'dan tool'ları al (plugin tool'ları dahil)
    if (this.toolManager) {
      // Normal tool'lar
      if (this.toolManager.tools) {
        for (const [toolName, tool] of this.toolManager.tools) {
          if (tool.definition) {
            tools.push({
              functionDeclarations: [
                {
                  name: toolName,
                  description: tool.definition.description || '',
                  parameters: tool.definition.parameters || {
                    type: Type.OBJECT,
                    properties: {},
                    required: []
                  }
                }
              ]
            });
          }
        }
      }

      // Plugin tool'ları
      if (this.toolManager.pluginManager && this.toolManager.pluginManager.plugins) {
        for (const [pluginName, plugin] of this.toolManager.pluginManager.plugins) {
          if (plugin.enabled && plugin.tools) {
            // Plugin tools bir obje, array değil
            for (const [toolName, tool] of Object.entries(plugin.tools)) {
              if (tool && tool.description && tool.parameters) {
                tools.push({
                  functionDeclarations: [
                    {
                      name: `${pluginName}.${toolName}`, // Use fullName (plugin.toolName format)
                      description: tool.description || '',
                      parameters: tool.parameters || {
                        type: Type.OBJECT,
                        properties: {},
                        required: []
                      }
                    }
                  ]
                });
              }
            }
          }
        }
      }
    }

    return tools;
  }

  async _executeModelMessage(content, options = {}) {
    // GoogleLiveAgent SADECE live modda çalışır, normal modda çalışmaz
    console.log(`GoogleLiveAgent ${this.id} _executeModelMessage called`);
    
    // Eğer live session aktifse, oraya gönder
    if (this.isLiveSessionActive && this.liveSession) {
      // Live modda status "Canlı" kalsın, "Gorev_yapiyor" olmasın
      this.status = 'Canlı';
      this.io.emit('agent-status', {
        agentId: this.id,
        status: 'Canlı'
      });
      
      this.handleLiveTextInput(content, options);
      return;
    }

    // Live session yoksa, GoogleLiveAgent normal modda çalışmaz
    console.log(`GoogleLiveAgent ${this.id} cannot process message - no live session active`);
    this.io.emit('agent-error', {
      agentId: this.id,
      error: 'GoogleLiveAgent sadece live modda çalışır. Önce live session başlatın.'
    });
    
    // Kuyruk görevini tamamla
    this.completeCurrentQueueItem();
  }

  getHistory() {
    return this.history;
  }

  clearHistory() {
    this.history = [];
    this.session = [];
    
    // Reset streaming buffer
    this.textBuffer = '';
    if (this.textTimeout) {
      clearTimeout(this.textTimeout);
      this.textTimeout = null;
    }
    
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

  _stopModelSession() {
    // Live session'ı kapat
    this.stopLiveSession();
  }

  updateApiKey(newApiKey) {
    this.apiKey = newApiKey;
    console.log(`GoogleLiveAgent ${this.id} API key updated`);

    // Eğer aktif bir live session varsa, yeniden başlat
    if (this.isLiveSessionActive) {
      this.stopLiveSession();
      if (this.clientSocket) {
        this.startLiveSession(this.clientSocket);
      }
    }
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
}

module.exports = GoogleLiveAgent;