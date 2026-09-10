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
    this.loadLanguage();
  }

  loadLanguage() {
    const savedLanguage = localStorage.getItem('language');
    if (savedLanguage && this.translations[savedLanguage]) {
      this.currentLanguage = savedLanguage;
    }
  }

  setLanguage(language) {
    if (this.translations[language]) {
      this.currentLanguage = language;
      localStorage.setItem('language', language);
      this.updateUI();
      return true;
    }
    return false;
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

  updateUI() {
    // Update all elements with data-lang attribute
    document.querySelectorAll('[data-lang]').forEach(element => {
      const key = element.getAttribute('data-lang');
      element.textContent = this.t(key);
    });

    // Update version info
    const versionInfo = document.getElementById('version-info');
    if (versionInfo) {
      versionInfo.textContent = `${this.t('version')}: ${systemVersion || 'Loading...'}`;
    }

    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
      const tab = btn.getAttribute('data-tab');
      if (tab) {
        btn.textContent = this.t(tab);
      }
    });

    // Refresh cron list and agent list
    updateCronList();
    updateAgentList();
  }
}

// Global lang instance
const lang = new Lang();