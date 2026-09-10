const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const admZip = require('adm-zip');
const https = require('https');
const http = require('http');
const simpleGit = require('simple-git');

class UpdateManager {
  constructor(configManager, agentManager, io) {
    this.configManager = configManager;
    this.agentManager = agentManager;
    this.io = io;
    
    // GitHub repository bilgileri (test için)
    this.githubOwner = 'testdemo231314';
    this.githubRepo = 'test';
    this.currentVersion = require('../../package.json').version;
    
    // Güncelleme durumu
    this.updateStatus = {
      checking: false,
      downloading: false,
      extracting: false,
      installing: false,
      progress: 0,
      message: '',
      error: null
    };
    
    // Güncelleme dizini
    this.updateDir = path.join(__dirname, '../../updates');
    this.tempDir = path.join(this.updateDir, 'temp');
  }

  /**
   * GitHub release kontrolü yap (Git tag yöntemi)
   */
  async checkForUpdates() {
    try {
      this.updateStatus.checking = true;
      this.updateStatus.message = 'Güncelleme kontrol ediliyor...';
      this.broadcastStatus();

      // Git kullanarak GitHub repository'den tag'leri al
      const git = simpleGit();
      const tempDir = path.join(this.updateDir, 'git-check');
      
      // Dizinleri temizle ve oluştur
      await fs.remove(tempDir);
      await fs.ensureDir(tempDir);
      
      try {
        // Repository'yu clone et (shallow - sadece tag'leri)
        this.updateStatus.message = 'GitHub repository bağlanılıyor...';
        this.broadcastStatus();
        
        await git.clone(
          `https://github.com/${this.githubOwner}/${this.githubRepo}.git`,
          tempDir,
          ['--depth', '1'] // Shallow clone - sadece son commit
        );
        
        // Tag'leri al
        const tempGit = simpleGit(tempDir);
        const tags = await tempGit.tags();
        
        // Tag'leri filtrele (sadece version tag'leri)
        const versionTags = tags.all.filter(tag => 
          /^v?\d+\.\d+\.\d+$/.test(tag)
        );
        
        if (versionTags.length === 0) {
          throw new Error('Version tag bulunamadı');
        }
        
        // En son tag'i bul
        const latestTag = versionTags[versionTags.length - 1];
        const latestVersion = latestTag.replace('v', '');
        
        console.log(`Current version: ${this.currentVersion}, Latest version: ${latestVersion}`);
        
        // Temp dizini temizle
        await fs.remove(tempDir);
        
        this.updateStatus.checking = false;
        
        if (this.isNewerVersion(latestVersion, this.currentVersion)) {
          this.updateStatus.message = `Yeni sürüm mevcut: v${latestVersion}`;
          this.updateStatus.hasUpdate = true;
          this.updateStatus.latestVersion = latestVersion;
          this.updateStatus.releaseUrl = `https://github.com/${this.githubOwner}/${this.githubRepo}/releases/tag/${latestTag}`;
          this.updateStatus.downloadUrl = `https://github.com/${this.githubOwner}/${this.githubRepo}/archive/refs/tags/${latestTag}.zip`;
          this.updateStatus.releaseNotes = 'Release notes GitHub sayfasında mevcut.';
          this.broadcastStatus();
          
          return {
            hasUpdate: true,
            currentVersion: this.currentVersion,
            latestVersion: latestVersion,
            releaseUrl: this.updateStatus.releaseUrl,
            downloadUrl: this.updateStatus.downloadUrl,
            releaseNotes: 'Release notes GitHub sayfasında mevcut.'
          };
        } else {
          this.updateStatus.message = 'Sürüm güncel';
          this.updateStatus.hasUpdate = false;
          this.broadcastStatus();
          
          return {
            hasUpdate: false,
            currentVersion: this.currentVersion,
            latestVersion: latestVersion
          };
        }
      } catch (gitError) {
        // Git hatası durumunda temp dizini temizle
        await fs.remove(tempDir).catch(() => {});
        throw gitError;
      }
    } catch (error) {
      console.error('Güncelleme kontrol hatası:', error);
      this.updateStatus.checking = false;
      this.updateStatus.error = error.message;
      this.updateStatus.message = 'Güncelleme kontrol hatası: ' + error.message;
      this.broadcastStatus();
      
      throw error;
    }
  }

  /**
   * Sürüm karşılaştırma
   */
  isNewerVersion(latest, current) {
    const latestParts = latest.split('.').map(Number);
    const currentParts = current.split('.').map(Number);
    
    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i++) {
      const latestPart = latestParts[i] || 0;
      const currentPart = currentParts[i] || 0;
      
      if (latestPart > currentPart) return true;
      if (latestPart < currentPart) return false;
    }
    
    return false;
  }

  /**
   * Güncelleme indir (Git clone yöntemi)
   */
  async downloadUpdate(downloadUrl) {
    try {
      this.updateStatus.downloading = true;
      this.updateStatus.progress = 0;
      this.updateStatus.message = 'Güncelleme indiriliyor...';
      this.broadcastStatus();

      // Dizinleri oluştur
      await fs.ensureDir(this.updateDir);
      await fs.ensureDir(this.tempDir);

      // Git clone kullan
      const git = simpleGit();
      const cloneDir = path.join(this.tempDir, 'cloned-repo');
      
      // Önceki klonu temizle
      await fs.remove(cloneDir);
      
      this.updateStatus.message = 'GitHub repository klonlanıyor...';
      this.updateStatus.progress = 20;
      this.broadcastStatus();
      
      // Repository'yu belirli tag ile clone et
      const tagVersion = this.updateStatus.latestVersion;
      const tagName = `v${tagVersion}`;
      
      await git.clone(
        `https://github.com/${this.githubOwner}/${this.githubRepo}.git`,
        cloneDir,
        ['--depth', '1', '--branch', tagName]
      );
      
      this.updateStatus.progress = 80;
      this.updateStatus.message = 'Tag checkout yapılıyor...';
      this.broadcastStatus();
      
      // Belirli tag'e checkout yap (zaten branch olarak clone edildiğimizde gerek olmayabilir ama emin olmak için)
      const clonedGit = simpleGit(cloneDir);
      try {
        await clonedGit.checkout(tagName);
      } catch (checkoutError) {
        // Zaten doğru branch'teyse hata vermez, yoksay
        console.log('Checkout zaten doğru branch\'te:', checkoutError.message);
      }
      
      this.updateStatus.downloading = false;
      this.updateStatus.progress = 100;
      this.updateStatus.message = 'İndirme tamamlandı';
      this.updateStatus.cloneDir = cloneDir;
      this.broadcastStatus();

      return cloneDir;
    } catch (error) {
      console.error('İndirme hatası:', error);
      this.updateStatus.downloading = false;
      this.updateStatus.error = error.message;
      this.updateStatus.message = 'İndirme hatası: ' + error.message;
      this.broadcastStatus();
      throw error;
    }
  }

  /**
   * Dosya indirme fonksiyonu
   */
  downloadFile(url, destPath, progressCallback) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      
      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        }
      };
      
      protocol.get(url, options, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'], 10);
        let downloadedSize = 0;

        const file = fs.createWriteStream(destPath);
        
        response.pipe(file);

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          if (totalSize && progressCallback) {
            const progress = Math.round((downloadedSize / totalSize) * 100);
            progressCallback(progress);
          }
        });

        file.on('finish', () => {
          file.close();
          resolve();
        });

        file.on('error', (error) => {
          fs.unlink(destPath, () => {});
          reject(error);
        });
      }).on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Klonlanmış repository'yi hazırla (Zip çıkarma gerek yok)
   */
  async extractUpdate(cloneDir) {
    try {
      this.updateStatus.extracting = true;
      this.updateStatus.progress = 0;
      this.updateStatus.message = 'Dosyalar hazırlanıyor...';
      this.broadcastStatus();

      // Klonlanmış repository'yi kontrol et
      const clonedFiles = await fs.readdir(cloneDir);
      console.log('Klonlanmış dosyalar:', clonedFiles);
      
      this.updateStatus.extracting = false;
      this.updateStatus.progress = 100;
      this.updateStatus.message = 'Hazırlama tamamlandı';
      this.updateStatus.extractDir = cloneDir;
      this.broadcastStatus();

      return cloneDir;
    } catch (error) {
      console.error('Hazırlama hatası:', error);
      this.updateStatus.extracting = false;
      this.updateStatus.error = error.message;
      this.updateStatus.message = 'Hazırlama hatası';
      this.broadcastStatus();
      throw error;
    }
  }

  /**
   * Güncellemeyi kur
   */
  async installUpdate(sourceDir) {
    try {
      this.updateStatus.installing = true;
      this.updateStatus.progress = 0;
      this.updateStatus.message = 'Güncelleme kuruluyor...';
      this.broadcastStatus();

      const projectRoot = path.join(__dirname, '../..');
      
      // Önce yedek al
      console.log('Yedek alınıyor...');
      await this.createBackup();

      // Dosyaları kopyala
      console.log('Dosyalar kopyalanıyor...');
      await this.copyDirectory(sourceDir, projectRoot);

      // package.json güncelle
      const newPackageJson = await fs.readJson(path.join(sourceDir, 'package.json'));
      await fs.writeJson(path.join(projectRoot, 'package.json'), newPackageJson, { spaces: 2 });

      // Bağımlılıkları yükle
      console.log('Bağımlılıklar yükleniyor...');
      this.updateStatus.message = 'Bağımlılıklar yükleniyor...';
      this.updateStatus.progress = 50;
      this.broadcastStatus();

      await this.installDependencies();

      // Temizlik
      console.log('Geçici dosyalar temizleniyor...');
      await fs.remove(this.tempDir);

      this.updateStatus.installing = false;
      this.updateStatus.progress = 100;
      this.updateStatus.message = 'Güncelleme tamamlandı';
      this.broadcastStatus();

      return true;
    } catch (error) {
      console.error('Kurulum hatası:', error);
      this.updateStatus.installing = false;
      this.updateStatus.error = error.message;
      this.updateStatus.message = 'Kurulum hatası';
      this.broadcastStatus();
      throw error;
    }
  }

  /**
   * Dizin kopyalama
   */
  async copyDirectory(source, dest) {
    const entries = await fs.readdir(source, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(source, entry.name);
      const destPath = path.join(dest, entry.name);

      // node_modules, updates, .git ve diğer git dosyalarını atla
      if (entry.name === 'node_modules' || 
          entry.name === 'updates' || 
          entry.name === '.git' ||
          entry.name === '.gitignore' ||
          entry.name === '.gitattributes') {
        continue;
      }

      if (entry.isDirectory()) {
        await fs.ensureDir(destPath);
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copy(srcPath, destPath, { overwrite: true });
      }
    }
  }

  /**
   * Yedekleme oluştur
   */
  async createBackup() {
    const backupDir = path.join(__dirname, '../../system-backups');
    await fs.ensureDir(backupDir);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `backup-${timestamp}`);
    
    const projectRoot = path.join(__dirname, '../..');
    const dirsToBackup = ['src', 'public', 'data', 'server.js', 'package.json'];
    
    await fs.ensureDir(backupPath);
    
    for (const dir of dirsToBackup) {
      const sourcePath = path.join(projectRoot, dir);
      const destPath = path.join(backupPath, dir);
      
      if (await fs.pathExists(sourcePath)) {
        if (dir.endsWith('.js') || dir.endsWith('.json')) {
          await fs.copy(sourcePath, destPath);
        } else {
          await fs.copy(sourcePath, destPath, { overwrite: true });
        }
      }
    }
    
    console.log(`Yedek oluşturuldu: ${backupPath}`);
    return backupPath;
  }

  /**
   * Bağımlılıkları yükle
   */
  async installDependencies() {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    const projectRoot = path.join(__dirname, '../..');
    
    try {
      await execAsync('npm install', { cwd: projectRoot });
    } catch (error) {
      console.error('npm install hatası:', error);
      throw error;
    }
  }

  /**
   * Tam güncelleme süreci
   */
  async performUpdate() {
    try {
      // 1. Güncelleme kontrolü
      const updateInfo = await this.checkForUpdates();
      if (!updateInfo.hasUpdate) {
        return { success: false, message: 'Güncelleme mevcut değil' };
      }

      // 2. İndirme (Git clone)
      await this.downloadUpdate(updateInfo.downloadUrl);

      // 3. Hazırlama (Artık zip çıkarma gerek yok)
      await this.extractUpdate(this.updateStatus.cloneDir);

      // 4. Kurulum
      await this.installUpdate(this.updateStatus.extractDir);

      // 5. Sistemi yeniden başlat
      this.updateStatus.message = 'Sistem yeniden başlatılıyor...';
      this.broadcastStatus();

      setTimeout(() => {
        this.restartSystem();
      }, 2000);

      return { success: true, message: 'Güncelleme başarıyla tamamlandı' };
    } catch (error) {
      console.error('Güncelleme hatası:', error);
      return { success: false, message: error.message };
    }
  }

  /**
   * Sistemi yeniden başlat
   */
  restartSystem() {
    console.log('Sistem yeniden başlatılıyor...');
    process.exit(0);
  }

  /**
   * Durumu broadcast et
   */
  broadcastStatus() {
    this.io.emit('update-status', this.updateStatus);
  }

  /**
   * Güncelleme durumunu al
   */
  getStatus() {
    return this.updateStatus;
  }

  /**
   * GitHub repository bilgilerini güncelle
   */
  setGitHubRepository(owner, repo) {
    this.githubOwner = owner;
    this.githubRepo = repo;
  }
}

module.exports = UpdateManager;