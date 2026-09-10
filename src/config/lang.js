const translations = {
  tr: {
    // UI
    title: "AzerClaw",
    version: "Sürüm",
    agents: "Agentler",
    cron: "Zamanlanmış Görevler",
    plugins: "Pluginler",
    settings: "Ayarlar",
    newAgent: "Yeni Agent",
    createAgent: "Agent Oluştur",
    start: "Başlat",
    stop: "Durdur",
    delete: "Sil",
    edit: "Düzenle",
    save: "Kaydet",
    cancel: "İptal",
    clearHistory: "Geçmişi Temizle",
    name: "İsim",
    prompt: "Prompt",
    model: "Model",
    schedule: "Zamanlama",
    message: "Mesaj",
    status: "Durum",
    idle: "Boşta",
    running: "Çalışıyor",
    paused: "Durduruldu",
    error: "Hata",
    executing: "Çalışıyor",
    resume: "Devam Et",
    pause: "Durdur",
    selectAgent: "Agent Seçin",
    notSelected: "Seçilmedi",
    disabled: "Seçilmedi",
    noAgents: "Henüz agent yok",
    noCronTasks: "Henüz zamanlanmış görev yok",
    noPlugins: "Henüz plugin yok",
    // Console messages
    systemStarted: "Sistem başlatıldı",
    agentCreated: "Agent oluşturuldu",
    agentDeleted: "Agent silindi",
    agentStarted: "Agent başlatıldı",
    agentStopped: "Agent durduruldu",
    cronTaskCreated: "Cron görevi oluşturuldu",
    cronTaskDeleted: "Cron görevi silindi",
    cronTaskStarted: "Cron görevi başlatıldı",
    cronTaskStopped: "Cron görevi durduruldu",
    cronTaskResumed: "Cron görevi devam ettirildi",
    cronTaskPaused: "Cron görevi durduruldu",
    taskNotStarted: "Task otomatik başlatılmayacak",
    taskStarted: "Task otomatik başlatıldı",
    loadingFromStorage: "Storage'dan yükleniyor",
    loadedFromStorage: "Storage'dan yüklendi",
    savedToStorage: "Storage'a kaydedildi",
    systemReloaded: "Sistem yeniden yüklendi",
    cleanupStarted: "Temizleniyor...",
    cleanupCompleted: "Başarıyla temizlendi",
    cronTaskStartedWithSchedule: "Cron task başlatıldı, schedule",
    cronTaskAutoStarted: "Cron task otomatik başlatıldı, durum",
    cronTaskStoppedWorking: "çalışıyor, durduruluyor",
    cronTaskWasStopped: "durduruldu",
    cronTaskStartedResumed: "başlatıldı",
    cronTaskNotFoundError: "bulunamadı",
    cronTaskStartError: "başlatılırken hata",
    cronTaskIdleState: "idle durumundaydı, start ile başlatıldı",
    cronTaskResumeError: "resume edilirken hata",
    cronTaskUpdateError: "güncellenirken hata",
    cronTaskDeleteError: "silinirken hata",
    cronTaskLoadError: "yüklenirken hata",
    cronTaskSaveError: "kaydedilirken hata",
    cronTaskExecuteError: "çalıştırılırken hata",
    cronTaskExecuting: "çalıştırılıyor",
    cronTaskAgentStopped: "durdurulmuş durumda, cron görevi atlandı",
    cronTaskAgentNotFound: "bulunamadı",
    cronTaskScheduleError: "schedule hatalı",
    cronTaskPreserveTiming: "Zaman korunması",
    cronTaskIdleAfterError: "Hata durumunda task'ı idle durumuna getir",
    cronTaskRunningStatus: "çalışıyor",
    cronTaskExecutingStatus: "çalışıyor",
    sendMessage: "Mesaj gönderiliyor",
    messageSent: "Mesaj gönderildi",
    messageQueued: "Mesaj kuyruğa eklendi",
    agentStoppedStatus: "Agent durdurulmuş durumda",
    agentWorkingStatus: "Agent şu anda görev yapıyor",
    agentHistoryCleared: "Agent geçmişi temizlendi",
    agentUpdated: "Agent güncellendi",
    agentDeleted: "Agent silindi",
    agentCreated: "Agent oluşturuldu",
    // Settings
    language: "Dil",
    apiKey: "API Anahtarı",
    backupSettings: "Yedekleme Ayarları",
    enabled: "Aktif",
    disabled: "Pasif",
    interval: "Aralık",
    maxBackups: "Maksimum Yedek Sayısı",
    // Settings
    language: "Dil",
    apiKey: "API Anahtarı",
    backupSettings: "Yedekleme Ayarları",
    enabled: "Aktif",
    disabled: "Pasif",
    interval: "Aralık",
    maxBackups: "Maksimum Yedek Sayısı"
  },
  az: {
    // UI
    title: "AzerClaw",
    version: "Versiya",
    agents: "Agentlər",
    cron: "Təxirə Salınmış Tapşırıqlar",
    plugins: "Pluginlər",
    settings: "Tənzimləmələr",
    newAgent: "Yeni Agent",
    createAgent: "Agent Yarat",
    start: "Başlat",
    stop: "Dayandır",
    delete: "Sil",
    edit: "Düzəlt",
    save: "Yadda saxla",
    cancel: "Ləğv et",
    clearHistory: "Tarixçəni Təmizlə",
    name: "Ad",
    prompt: "Prompt",
    model: "Model",
    schedule: "Cədvəl",
    message: "Mesaj",
    status: "Vəziyyət",
    idle: "Boş",
    running: "İşləyir",
    paused: "Dayandırıldı",
    error: "Xəta",
    executing: "İşləyir",
    resume: "Davam et",
    pause: "Fasilə",
    selectAgent: "Agent Seç",
    notSelected: "Seçilməyib",
    disabled: "Seçilməyib",
    noAgents: "Hələ agent yoxdur",
    noCronTasks: "Hələ təxirə salınmış tapşırıq yoxdur",
    noPlugins: "Hələ plugin yoxdur",
    // Console messages
    systemStarted: "Sistem başladıldı",
    agentCreated: "Agent yaradıldı",
    agentDeleted: "Agent silindi",
    agentStarted: "Agent başladıldı",
    agentStopped: "Agent dayandırıldı",
    cronTaskCreated: "Cron tapşırığı yaradıldı",
    cronTaskDeleted: "Cron tapşırığı silindi",
    cronTaskStarted: "Cron tapşırığı başladıldı",
    cronTaskStopped: "Cron tapşırığı dayandırıldı",
    cronTaskResumed: "Cron tapşırığı davam etdirildi",
    cronTaskPaused: "Cron tapşırığı fasiləyə alındı",
    taskNotStarted: "Task avtomatik başladılmayacaq",
    taskStarted: "Task avtomatik başladıldı",
    loadingFromStorage: "Storage-dan yüklənir",
    loadedFromStorage: "Storage-dan yükləndi",
    savedToStorage: "Storage-a yadda saxlanıldı",
    systemReloaded: "Sistem yenidən yükləndi",
    cleanupStarted: "Təmizlənir...",
    cleanupCompleted: "Uğurla təmizləndi",
    cronTaskStartedWithSchedule: "Cron task başladıldı, schedule",
    cronTaskAutoStarted: "Cron task avtomatik başladıldı, durum",
    cronTaskStoppedWorking: "işləyir, dayandırılır",
    cronTaskWasStopped: "dayandırıldı",
    cronTaskStartedResumed: "başladıldı",
    cronTaskNotFoundError: "tapılmadı",
    cronTaskStartError: "başladılanarkən xəta",
    cronTaskIdleState: "idle vəziyyətində idi, start ilə başladıldı",
    cronTaskResumeError: "davam etdirilərkən xəta",
    cronTaskUpdateError: "yenilənərkən xəta",
    cronTaskDeleteError: "silinərkən xəta",
    cronTaskLoadError: "yüklənərkən xəta",
    cronTaskSaveError: "yadda saxlanarkən xəta",
    cronTaskExecuteError: "icra edilərkən xəta",
    cronTaskExecuting: "icra edilir",
    cronTaskAgentStopped: "dayandırılmış vəziyyətdə, cron tapşırığı atlandı",
    cronTaskAgentNotFound: "tapılmadı",
    cronTaskScheduleError: "schedule xətalı",
    cronTaskPreserveTiming: "Zaman qorunması",
    cronTaskIdleAfterError: "Xəta vəziyyətində task'ı idle vəziyyətinə gətir",
    cronTaskRunningStatus: "işləyir",
    cronTaskExecutingStatus: "işləyir",
    sendMessage: "Mesaj göndərilir",
    messageSent: "Mesaj göndərildi",
    messageQueued: "Mesaj növbəyə əlavə edildi",
    agentStoppedStatus: "Agent dayandırılmış vəziyyətdə",
    agentWorkingStatus: "Agent hazırda vəzifə edir",
    agentHistoryCleared: "Agent tarixçəsi təmizləndi",
    agentUpdated: "Agent yeniləndi",
    agentDeleted: "Agent silindi",
    agentCreated: "Agent yaradıldı",
    // Settings
    language: "Dil",
    apiKey: "API Açarı",
    backupSettings: "Ehtiyat Tənzimləmələri",
    enabled: "Aktiv",
    disabled: "Passiv",
    interval: "Aralıq",
    maxBackups: "Maksimum Ehtiyat Sayı"
  },
  en: {
    // UI
    title: "AzerClaw",
    version: "Version",
    agents: "Agents",
    cron: "Scheduled Tasks",
    plugins: "Plugins",
    settings: "Settings",
    newAgent: "New Agent",
    createAgent: "Create Agent",
    start: "Start",
    stop: "Stop",
    delete: "Delete",
    edit: "Edit",
    save: "Save",
    cancel: "Cancel",
    clearHistory: "Clear History",
    name: "Name",
    prompt: "Prompt",
    model: "Model",
    schedule: "Schedule",
    message: "Message",
    status: "Status",
    idle: "Idle",
    running: "Running",
    paused: "Paused",
    error: "Error",
    executing: "Executing",
    resume: "Resume",
    pause: "Pause",
    selectAgent: "Select Agent",
    notSelected: "Not Selected",
    disabled: "Disabled",
    noAgents: "No agents yet",
    noCronTasks: "No scheduled tasks yet",
    noPlugins: "No plugins yet",
    // Console messages
    systemStarted: "System started",
    agentCreated: "Agent created",
    agentDeleted: "Agent deleted",
    agentStarted: "Agent started",
    agentStopped: "Agent stopped",
    cronTaskCreated: "Cron task created",
    cronTaskDeleted: "Cron task deleted",
    cronTaskStarted: "Cron task started",
    cronTaskStopped: "Cron task stopped",
    cronTaskResumed: "Cron task resumed",
    cronTaskPaused: "Cron task paused",
    taskNotStarted: "Task will not be auto-started",
    taskStarted: "Task auto-started",
    loadingFromStorage: "Loading from storage",
    loadedFromStorage: "Loaded from storage",
    savedToStorage: "Saved to storage",
    systemReloaded: "System reloaded",
    cleanupStarted: "Cleaning up...",
    cleanupCompleted: "Successfully cleaned up",
    cronTaskStartedWithSchedule: "Cron task started, schedule",
    cronTaskAutoStarted: "Cron task auto-started, status",
    cronTaskStoppedWorking: "running, stopping",
    cronTaskWasStopped: "stopped",
    cronTaskStartedResumed: "started",
    cronTaskNotFoundError: "not found",
    cronTaskStartError: "error starting",
    cronTaskIdleState: "was in idle state, started with start",
    cronTaskResumeError: "error resuming",
    cronTaskUpdateError: "error updating",
    cronTaskDeleteError: "error deleting",
    cronTaskLoadError: "error loading",
    cronTaskSaveError: "error saving",
    cronTaskExecuteError: "error executing",
    cronTaskExecuting: "executing",
    cronTaskAgentStopped: "agent stopped, cron task skipped",
    cronTaskAgentNotFound: "not found",
    cronTaskScheduleError: "schedule error",
    cronTaskPreserveTiming: "Timing preservation",
    cronTaskIdleAfterError: "Set task to idle on error",
    cronTaskRunningStatus: "running",
    cronTaskExecutingStatus: "executing",
    sendMessage: "Sending message",
    messageSent: "Message sent",
    messageQueued: "Message queued",
    agentStoppedStatus: "Agent is stopped",
    agentWorkingStatus: "Agent is currently working",
    agentHistoryCleared: "Agent history cleared",
    agentUpdated: "Agent updated",
    agentDeleted: "Agent deleted",
    agentCreated: "Agent created",
    // Settings
    language: "Language",
    apiKey: "API Key",
    backupSettings: "Backup Settings",
    enabled: "Enabled",
    disabled: "Disabled",
    interval: "Interval",
    maxBackups: "Max Backups"
  }
};

class Lang {
  constructor(defaultLanguage = 'tr') {
    this.currentLanguage = defaultLanguage;
    this.translations = translations;
  }

  setLanguage(language) {
    if (this.translations[language]) {
      this.currentLanguage = language;
      console.log(`Language changed to: ${language}`);
    } else {
      console.error(`Language not supported: ${language}`);
    }
  }

  getLanguage() {
    return this.currentLanguage;
  }

  t(key) {
    const translation = this.translations[this.currentLanguage][key];
    if (translation) {
      return translation;
    }
    // Fallback to English if key not found in current language
    const fallback = this.translations['en'][key];
    if (fallback) {
      return fallback;
    }
    // Return key if not found anywhere
    return key;
  }

  getAvailableLanguages() {
    return Object.keys(this.translations);
  }
}

// Singleton instance
let langInstance = null;

function getLang() {
  if (!langInstance) {
    langInstance = new Lang();
  }
  return langInstance;
}

module.exports = { Lang, getLang, translations };