/**
 * BackupManager - Akıllı yedekleme sistemi
 * Dosya hata kontrolü ve yedekleme işlemlerini yönetir
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class BackupManager {
  constructor(configManager, agentManager) {
    this.configManager = configManager;
    this.agentManager = agentManager;
    this.backupIntervalId = null;
    this.sourceDirs = ['src', 'public', 'plugins', 'data'];
  }

  /**
   * Dosya hata kontrolü fonksiyonu
   * @param {string} file - Kontrol edilecek dosya yolu
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  async checkFileError(file) {
    try {
      // Windows path'i düzelt ve node --check komutunu çalıştır
      const normalizedPath = file.replace(/\\/g, '/');
      await execAsync(`node --check "${normalizedPath}"`, { 
        cwd: path.join(__dirname, '../../'),
        windowsHide: true 
      });
      
      // Ek kontrol: Sadece src/ ve plugins/ dosyalarının require edilebilirliğini test et
      // server.js ve public/ dosyaları require edilemez (bu normal)
      const normalizedFile = file.replace(/\\/g, '/');
      if (normalizedFile.includes('src/') || normalizedFile.includes('plugins/')) {
        try {
          // Önce require cache'ini temizle
          delete require.cache[require.resolve(file)];
          // Dosyayı gerçekten require et
          require(file);
        } catch (requireError) {
          throw new Error(`Require test hatası: ${requireError.message}`);
        }
      }
      
      return { success: true, error: null };
    } catch (error) {
      const fullError = error.stderr || error.stdout || error.message;
      return { success: false, error: fullError };
    }
  }

  /**
   * Tüm dosyaları kontrol et ve hataları döndür
   * @returns {Promise<Array<{file: string, error: string}>>}
   */
  async checkAllFiles() {
    console.log('Dosya kontrolü başlatılıyor...');
    
    // Check JavaScript files with node --check
    const filesToCheck = ['server.js'];
    
    // Find all .js files in source directories
    const findJSFiles = (dir) => {
      const jsFiles = [];
      const dirPath = path.join(__dirname, '../../', dir);
      if (!fs.existsSync(dirPath)) return jsFiles;
      
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      entries.forEach(entry => {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          jsFiles.push(...findJSFiles(path.join(dir, entry.name)));
        } else if (entry.name.endsWith('.js')) {
          jsFiles.push(fullPath);
        }
      });
      return jsFiles;
    };
    
    this.sourceDirs.forEach(dir => {
      filesToCheck.push(...findJSFiles(dir));
    });
    
    console.log(`Kontrol edilecek dosya sayısı: ${filesToCheck.length}`);
    
    const checkErrors = [];
    for (const file of filesToCheck) {
      const result = await this.checkFileError(file);
      if (!result.success) {
        console.error(`Hata tespit edildi - ${file}:`, result.error);
        checkErrors.push({
          file: file,
          error: result.error
        });
      }
    }
    
    return checkErrors;
  }

  /**
   * Yedekleme işlemi
   */
  async performBackup() {
    try {
      const checkErrors = await this.checkAllFiles();
      
      if (checkErrors.length > 0) {
        console.error('=== DOSYA KONTROLÜNDE HATALAR BULUNDU ===');
        checkErrors.forEach(err => {
          console.error(`  - ${err.file}:`);
          console.error(`    ${err.error}`);
        });
        
        // Send error notification to agent (sadece hatalı dosyalar)
        const errorMessage = checkErrors.map(err => 
          `Dosya: ${err.file}\nHata: ${err.error}`
        ).join('\n\n');
        
        if (this.agentManager) {
          this.agentManager.sendErrorNotification(
            'Yedekleme Hatası',
            errorMessage
          );
        } else {
          console.error('AgentManager bulunamadı, bildirim gönderilemedi');
        }
        
        // Hata varsa yedekleme iptal
        console.log('Hata nedeniyle yedekleme iptal edildi');
        return;
      }
      
      console.log('=== DOSYA KONTROLÜ BAŞARILI, YEDEKLEME BAŞLATILIYOR ===');
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = path.join(__dirname, '../../system-backups');
      const backupPath = path.join(backupDir, `backup-${timestamp}`);
      
      // Find all .js files in source directories
      const findJSFiles = (dir) => {
        const jsFiles = [];
        const dirPath = path.join(__dirname, '../../', dir);
        if (!fs.existsSync(dirPath)) return jsFiles;
        
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        entries.forEach(entry => {
          const fullPath = path.join(dirPath, entry.name);
          if (entry.isDirectory()) {
            jsFiles.push(...findJSFiles(path.join(dir, entry.name)));
          } else if (entry.name.endsWith('.js')) {
            jsFiles.push(fullPath);
          }
        });
        return jsFiles;
      };
      
      // Create backup directory if it doesn't exist
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      
      // Create backup directory
      if (!fs.existsSync(backupPath)) {
        fs.mkdirSync(backupPath, { recursive: true });
      }
      
      // Copy directories
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
      
      // Backup each directory
      this.sourceDirs.forEach(dir => {
        const sourcePath = path.join(__dirname, '../../', dir);
        const destPath = path.join(backupPath, dir);
        
        if (fs.existsSync(sourcePath)) {
          copyDirectory(sourcePath, destPath);
        }
      });
      
      // Backup server.js and package.json
      const projectRoot = path.join(__dirname, '../../');
      fs.copyFileSync(path.join(projectRoot, 'server.js'), path.join(backupPath, 'server.js'));
      fs.copyFileSync(path.join(projectRoot, 'package.json'), path.join(backupPath, 'package.json'));
      
      // Cleanup old backups (using config setting)
      const maxBackups = this.configManager.getMaxBackups();
      const backups = fs.readdirSync(backupDir)
        .filter(dir => dir.startsWith('backup-'))
        .sort()
        .reverse();
      
      const backupsToDelete = backups.slice(maxBackups);
      backupsToDelete.forEach(backup => {
        const backupPathToDelete = path.join(backupDir, backup);
        fs.rmSync(backupPathToDelete, { recursive: true, force: true });
        console.log(`Eski yedek silindi: ${backup}`);
      });
      
      console.log(`Sistem yedeği başarıyla oluşturuldu: ${backupPath}`);
      
      // Send success notification to agent
      const backedUpFiles = [];
      this.sourceDirs.forEach(dir => {
        const dirPath = path.join(__dirname, '../../', dir);
        if (fs.existsSync(dirPath)) {
          backedUpFiles.push(...findJSFiles(dir));
        }
      });
      backedUpFiles.push('server.js', 'package.json');
      
      if (this.agentManager) {
        this.agentManager.sendSuccessNotification(
          'Yedekleme Başarılı',
          `Yedek konumu: ${backupPath}\nYedeklenen dosya sayısı: ${backedUpFiles.length}\nYedeklenen dosyalar: ${backedUpFiles.join(', ')}`
        );
      }

    } catch (error) {
      console.error('Sistem yedekleme hatası:', error);
      if (this.agentManager) {
        this.agentManager.sendErrorNotification('Sistem yedekleme hatası', error.stack);
      }
    }
  }

  /**
   * Yedekleme sistemini başlat
   */
  start() {
    // Önceki interval'i temizle
    if (this.backupIntervalId) {
      clearInterval(this.backupIntervalId);
      this.backupIntervalId = null;
    }

    // Yedekleme kapalıysa başlatma
    if (!this.configManager.isBackupEnabled()) {
      console.log('Backup sistemi devre dışı');
      return;
    }

    const intervalMs = this.configManager.getBackupInterval() * 60 * 1000;
    console.log(`Backup sistemi başlatılıyor. Aralık: ${this.configManager.getBackupInterval()} dakika (${intervalMs}ms)`);

    this.backupIntervalId = setInterval(async () => {
      // Her yedekleme öncesi enabled kontrolü yap
      if (!this.configManager.isBackupEnabled()) {
        console.log('Backup sistemi devre dışı, yedekleme atlanıyor');
        clearInterval(this.backupIntervalId);
        this.backupIntervalId = null;
        return;
      }

      await this.performBackup();
    }, intervalMs);
  }

  /**
   * Yedekleme sistemini durdur
   */
  stop() {
    if (this.backupIntervalId) {
      clearInterval(this.backupIntervalId);
      this.backupIntervalId = null;
      console.log('Backup sistemi durduruldu');
    }
  }

  /**
   * Yedekleme sistemini yeniden başlat
   */
  restart() {
    console.log('Backup sistemi yeniden başlatılıyor...');
    this.stop();
    this.start();
  }
}

module.exports = BackupManager;
