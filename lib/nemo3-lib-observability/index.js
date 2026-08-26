import fs from "fs";
import path from "path";
import crypto from "crypto";
import { initMetrics } from "./metrics.js";
import { setupLogRotator, startLogRotator, stopLogRotator } from "./log-rotator.js";

const BASE_PATH = "/Users/ehteshamalam/Documents/nemo3.0/backend/nemo3-api-fms-svc/observability";

const logLevels = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

class Logger {
  constructor({
    environment = "LOCAL",
    service = "default-service",
    instance = "localhost",
    ip = "127.0.0.1",
    loglevel = "info",
    logToConsole = false,
    maxSizeBytes = 10 * 1024 * 1024, // 10MB
    maxBackups = 5,
    checkIntervalMs = 2 * 1000,
    autoInstrument = true,
    defaultLabels = {},
    flushInterval = 5000,
  } = {}) {
    // Generate logId if not provided
    this.containerId = crypto.randomBytes(8).toString('hex');
    
    // Store configuration
    this.config = {
      environment,
      service,
      instance,
      ip,
      loglevel,
      logToConsole,
      maxSizeBytes,
      maxBackups,
      checkIntervalMs,
      autoInstrument,
      defaultLabels: {
        service,
        environment,
        ...defaultLabels
      },
      flushInterval,
    };

    // Initialize internal state
    this.currentEnvironment = environment;
    this.logToConsole = logToConsole;
    this.writeQueue = [];
    this.isWriting = false;
    this.context = { service, instance, ip, environment };
    
    if (!this.logToConsole) {
      // Setup logger
      this._setupLogger();
      
      // Setup metrics
      this._setupMetrics();

      // Setup log rotator
      this._setupLogRotator();
    }
  }

  _setupLogger() {
    if (!this.logToConsole) {
      const logFilePath = this._getLogFilePath();
      this._ensureCleanLogFile(logFilePath);
    }
  }

  _setupLogRotator() {
    setupLogRotator({
      service: this.config.service,
      maxSizeBytes: this.config.maxSizeBytes,
      maxBackups: this.config.maxBackups,
      checkIntervalMs: this.config.checkIntervalMs,
      logToConsole: this.logToConsole,
      environment: this.config.environment,
      logId: this.containerId,
    });
  }

  _setupMetrics() {
    this.metrics = initMetrics({
      autoInstrument: this.config.autoInstrument,
      defaultLabels: this.config.defaultLabels,
      flushInterval: this.config.flushInterval,
      logToConsole: this.logToConsole,
      logId: this.containerId,
    });
  }

  _getLogFilePath() {
    let logPath;
    if (this.currentEnvironment === "DEVELOPMENT") {
      logPath = path.resolve(BASE_PATH + "/dev-" + this.config.service + "/logs/log-" + this.containerId + ".log");
    } else if (this.currentEnvironment === "STAGING") {
      logPath = path.resolve(BASE_PATH + "/stg-" + this.config.service + "/logs/log-" + this.containerId + ".log");
    } else if (this.currentEnvironment === "PRODUCTION") {
      logPath = path.resolve(BASE_PATH + "/prod-" + this.config.service + "/logs/log-" + this.containerId + ".log");
    } else {
      logPath = path.resolve(BASE_PATH + "/local-" + this.config.service + "/logs/log-" + this.containerId + ".log");
    }

    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    return logPath;
  }

  _ensureCleanLogFile(logFilePath) {
    try {
      const logDir = path.dirname(logFilePath);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      if (fs.existsSync(logFilePath)) {
        const stats = fs.statSync(logFilePath);
        if (stats.isDirectory()) {
          fs.rmdirSync(logFilePath);
          fs.writeFileSync(logFilePath, "", { encoding: 'utf8' });
        } else if (stats.size > 0) {
          const fd = fs.openSync(logFilePath, 'r');
          const buffer = Buffer.alloc(10);
          const bytesRead = fs.readSync(fd, buffer, 0, 10, 0);
          fs.closeSync(fd);
          
          if (bytesRead > 0 && buffer[0] === 0) {
            console.warn('Detected corrupted log file, recreating...');
            fs.unlinkSync(logFilePath);
            fs.writeFileSync(logFilePath, "", { encoding: 'utf8' });
          }
        }
      } else {
        fs.writeFileSync(logFilePath, "", { encoding: 'utf8' });
      }
    } catch (error) {
      console.error('Error ensuring clean log file:', error);
    }
  }

  _shouldLog(level) {
    const currentLevel = logLevels[this.config.loglevel] || logLevels.info;
    const messageLevel = logLevels[level] || logLevels.info;
    return messageLevel >= currentLevel;
  }

  _log(level, message, errorOrMeta, meta) {
    if (!this._shouldLog(level)) {
      return;
    }

    const baseLog = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.context,
    };

    let logEntry;
    if (typeof errorOrMeta === "object" && errorOrMeta instanceof Error) {
      logEntry = {
        ...baseLog,
        error: {
          message: errorOrMeta.message,
          stack: errorOrMeta.stack,
          type: errorOrMeta.constructor.name,
        },
        ...(meta || {}),
      };
    } else if (typeof errorOrMeta === "object") {
      logEntry = { ...baseLog, ...errorOrMeta };
    } else {
      logEntry = baseLog;
    }

    if (!this.logToConsole) {
      this.writeQueue.push(logEntry);
      this._processWriteQueue();
    } else {
      const levelToConsole = {
        info: "info",
        debug: "log",
        warn: "warn",
        error: "error",
        trace: "log",
        fatal: "error",
      };
      const consoleMethod = levelToConsole[level] || "log";
      const args = [`[${level.toUpperCase()}]`, message];
      if (errorOrMeta !== undefined) {
        args.push(errorOrMeta);
      }
      if (meta !== undefined) {
        args.push(meta);
      }
      console[consoleMethod](...args);
    }
  }

  async _processWriteQueue() {
    if (this.isWriting || this.writeQueue.length === 0) return;
    
    this.isWriting = true;
    
    try {
      const logFilePath = this._getLogFilePath();
      
      while (this.writeQueue.length > 0) {
        const logEntry = this.writeQueue.shift();
        const jsonString = JSON.stringify(logEntry) + "\n";
        
        await fs.promises.appendFile(logFilePath, jsonString, { 
          encoding: 'utf8',
          flag: 'a'
        });
      }
    } catch (error) {
      console.error('Error writing to log file:', error);
    } finally {
      this.isWriting = false;
      
      if (this.writeQueue.length > 0) {
        setImmediate(() => this._processWriteQueue());
      }
    }
  }

  // Public logging methods
  info(msg, meta) {
    this._log("info", msg, meta);
  }

  debug(msg, meta) {
    this._log("debug", msg, meta);
  }

  warn(msg, meta) {
    this._log("warn", msg, meta);
  }

  error(msg, err, meta) {
    this._log("error", msg, err, meta);
  }

  trace(msg, meta) {
    this._log("trace", msg, meta);
  }

  fatal(msg, err, meta) {
    this._log("fatal", msg, err, meta);
  }

  // Start services
  start() {
    if (!this.logToConsole) {
      startLogRotator();
    }
  }

  // Stop services
  stop() {
    if (!this.logToConsole) {
      stopLogRotator();
    }
    this.flush();
  }

  // Flush pending logs
  flush() {
    // Wait for any pending writes to complete
    if (this.writeQueue.length > 0) {
      return new Promise((resolve) => {
        const checkComplete = () => {
          if (this.writeQueue.length === 0 && !this.isWriting) {
            resolve();
          } else {
            setTimeout(checkComplete, 10);
          }
        };
        checkComplete();
      });
    }
  }

  // Get metrics instance
  getMetrics() {
    return this.metrics;
  }

  // Get log ID
  getLogId() {
    return this.containerId;
  }
}
// Export the Logger class and default instance
export { Logger };

// Legacy exports for backward compatibility
export { initMetrics };
export default Logger;
