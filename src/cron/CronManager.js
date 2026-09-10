const CronTask = require('./CronTask');
const DataManager = require('../storage/DataManager');
const crypto = require('crypto');
const { getLang } = require('../config/lang');

class CronManager {
  constructor(io, agentManager) {
    this.tasks = new Map();
    this.io = io;
    this.agentManager = agentManager;
    this.dataManager = new DataManager('./data', agentManager);
    this.lang = getLang();
    
    // Storage'dan yükle
    this.loadCronTasksFromStorage();
  }

  createTask(agentId, schedule, message, name) {
    const id = crypto.randomUUID();
    const task = new CronTask(id, agentId, schedule, message, name, this.io, this.agentManager);
    this.tasks.set(id, task);
    
    this.dataManager.saveCronTask(task);
    
    this.io.emit('cron-task-created', {
      task: task.toJSON()
    });
    
    return task;
  }

  deleteTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.stop();
      this.tasks.delete(taskId);
      
      this.dataManager.deleteCronTask(taskId);
      
      this.io.emit('cron-task-deleted', {
        taskId: taskId
      });
      
      return true;
    }
    return false;
  }

  getTask(taskId) {
    return this.tasks.get(taskId);
  }

  getAllTasks() {
    return Array.from(this.tasks.values()).map(task => task.toJSON());
  }

  startTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.start();
      return true;
    }
    return false;
  }

  stopTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.stop();
      return true;
    }
    return false;
  }

  pauseTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.pause();
      return true;
    }
    return false;
  }

  resumeTask(taskId) {
    const task = this.tasks.get(taskId);
    if (task) {
      try {
        // Eğer task 'idle' durumundaysa, resume yerine start çağır
        if (task.status === 'idle') {
          task.start();
          console.log(`Cron task ${taskId} 'idle' durumundaydı, start ile başlatıldı`);
        } else {
          task.resume();
        }
        // Storage'a kaydet
        this.dataManager.updateCronTask(task);
        return true;
      } catch (error) {
        console.error(`Cron task ${taskId} resume edilirken hata:`, error);
        this.io.emit('cron-task-error', {
          taskId: taskId,
          error: error.message
        });
        return false;
      }
    }
    return false;
  }

  updateTaskSchedule(taskId, newSchedule) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.updateSchedule(newSchedule);
      this.dataManager.updateCronTask(task);
      return true;
    }
    return false;
  }

  updateTaskMessage(taskId, newMessage) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.updateMessage(newMessage);
      this.dataManager.updateCronTask(task);
      return true;
    }
    return false;
  }

  updateTaskName(taskId, newName) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.name = newName;
      this.dataManager.updateCronTask(task);
      return true;
    }
    return false;
  }

  updateTaskAgent(taskId, newAgentId) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.agentId = newAgentId;
      this.dataManager.updateCronTask(task);
      return true;
    }
    return false;
  }

  getTasksByAgent(agentId) {
    return Array.from(this.tasks.values())
      .filter(task => task.agentId === agentId)
      .map(task => task.toJSON());
  }

  broadcastStatus() {
    this.io.emit('cron-tasks-status', {
      tasks: this.getAllTasks()
    });
  }

  startAll() {
    this.tasks.forEach(task => {
      if (task.status === 'idle') {
        task.start();
      }
    });
  }

  stopAll() {
    this.tasks.forEach(task => {
      task.stop();
    });
  }

  loadCronTasksFromStorage() {
    try {
      const tasksData = this.dataManager.loadCronTasks();
      
      const tasksToStart = [];
      
      tasksData.forEach(taskData => {
        const task = new CronTask(
          taskData.id,
          taskData.agentId,
          taskData.schedule,
          taskData.message,
          taskData.name,
          this.io,
          this.agentManager,
          this.dataManager
        );
        
        // Durumu doğru ata - sadece 'running' durumundakileri başlat
        const savedStatus = taskData.status || 'idle';
        task.status = savedStatus;
        
        task.lastRun = taskData.lastRun;
        task.nextRun = taskData.nextRun;
        task.createdAt = taskData.createdAt;
        
        // Sadece 'running' durumundaki task'lar başlatılacak
        // 'stopped', 'paused', 'idle' durumundakiler başlatılmayacak
        if (task.status === 'running') {
          task.status = 'idle'; // Önce idle yap ki start() çalışabilsin
          tasksToStart.push(task.id);
          console.log(`${this.lang.t('cronTaskStarted')} ${task.id} (${this.lang.t('running')})`);
        } else {
          console.log(`${this.lang.t('taskNotStarted')} ${task.id} (${task.status})`);
        }
        
        this.tasks.set(task.id, task);
        
        // Task oluşturulduğunda web arayüzüne bildir
        this.io.emit('cron-task-created', {
          task: task.toJSON()
        });
      });
      
      console.log(`${this.lang.t('loadedFromStorage')}: ${tasksData.length} cron tasks`);
      
      // Running durumundaki task'ları başlat
      if (tasksToStart.length > 0) {
        console.log(`${tasksToStart.length} ${this.lang.t('cronTaskStarted')}...`);
        tasksToStart.forEach(taskId => {
          const task = this.tasks.get(taskId);
          if (task) {
            try {
              console.log(`${this.lang.t('cronTaskStarted')} ${taskId} (${task.name}), schedule: ${task.schedule}`);
              task.start();
              console.log(`${this.lang.t('taskStarted')} ${taskId} (${task.name}), status: ${task.status}`);
              
              // Zaman korunması
              if (task.preserveTiming) {
                task.preserveTiming();
              }
            } catch (err) {
              console.error(`${this.lang.t('error')} ${taskId}:`, err);
              // Hata durumunda task'ı idle durumuna getir
              task.status = 'idle';
            }
          } else {
            console.error(`${this.lang.t('error')} ${taskId}: ${this.lang.t('notSelected')}`);
          }
        });
      }
      
      // Tüm task'ların durumunu broadcast et
      this.broadcastStatus();
    } catch (error) {
      console.error(`${this.lang.t('error')} ${this.lang.t('loadingFromStorage')}:`, error);
    }
  }

  saveAllCronTasksToStorage() {
    try {
      this.dataManager.saveCronTasks(Array.from(this.tasks.values()));
    } catch (error) {
      console.error('Error saving cron tasks to storage:', error);
    }
  }

  cleanup() {
    console.log(`${this.lang.t('cleanupStarted')} CronManager`);
    
    // Çalışan cron task'larını durdur ve ID'lerini kaydet
    const runningTaskIds = [];
    this.tasks.forEach((task, id) => {
      if (task.status === 'running') {
        runningTaskIds.push(id);
        console.log(`${this.lang.t('cronTaskStopped')} ${id} (${task.name})`);
        try {
          task.stop();
          console.log(`${this.lang.t('cronTaskStopped')} ${id} (${task.name})`);
        } catch (err) {
          console.error(`${this.lang.t('error')} ${id}:`, err);
        }
      }
    });
    
    // Durdurulan task'ların ID'lerini global olarak kaydet (yeniden başlatmak için)
    global.stoppedCronTaskIds = runningTaskIds;
    console.log(`${runningTaskIds.length} ${this.lang.t('cronTaskStopped')}, IDs saved`);
    
    // Task'ları temizle
    this.tasks.clear();
    
    // DataManager'ı temizle
    if (this.dataManager) {
      try {
        this.dataManager.cleanup();
      } catch (err) {
        console.error(`${this.lang.t('error')} DataManager:`, err);
      }
    }
    
    console.log(`${this.lang.t('cleanupCompleted')} CronManager`);
  }
}

module.exports = CronManager;