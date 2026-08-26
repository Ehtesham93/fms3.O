import fs from "fs";
import path from "path";

const BASE_PATH = "/Users/ehteshamalam/Documents/nemo3.0/backend/nemo3-api-fms-svc/observability";
const ROTATED_PATH = "/rotated_logs/";

let logRotatorConfig = {
  service: "default-service",
  maxSizeBytes: 10 * 1024 * 1024, // 10 MB
  maxBackups: 5,
  checkIntervalMs: 2 * 1000, // 2 seconds
  logToConsole: false,
  logFiles: [],
  logId: "",
};

let rotatedDir = "";
let rotationInterval = null;
let maxAgeHours = 12 * 60 * 60 * 1000; // 12 hours

function getLogFilePath(service, environment, logId) {
  if (environment === "DEVELOPMENT") {
    return path.resolve(BASE_PATH + "/dev-" + service + "/logs/log-"+logId+".log");
  } else if (environment === "STAGING") {
    return path.resolve(BASE_PATH + "/stg-" + service + "/logs/log-"+logId+".log");
  } else if (environment === "PRODUCTION") {
    return path.resolve(BASE_PATH + "/prod-" + service + "/logs/log-"+logId+".log");
  } else {
    return path.resolve(BASE_PATH + "/local-" + service + "/logs/log-"+logId+".log");
  }
}

function getMetricsFilePath(service, environment, logId) {
  if (environment === "DEVELOPMENT") {
    return path.resolve(
      BASE_PATH + "/dev-" + service + "/logs/metrics-"+logId+".log"
    );
  } else if (environment === "STAGING") {
    return path.resolve(
      BASE_PATH + "/stg-" + service + "/logs/metrics-"+logId+".log"
    );
  } else if (environment === "PRODUCTION") {
    return path.resolve(
      BASE_PATH + "/prod-" + service + "/logs/metrics-"+logId+".log"
    );
  } else {
    return path.resolve(
      BASE_PATH + "/local-" + service + "/logs/metrics-"+logId+".log"
    );
  }
}

function getRotatedDirPath(service, environment) {
  if (environment === "DEVELOPMENT") {
    return path.resolve(BASE_PATH + "/dev-" + service + ROTATED_PATH);
  } else if (environment === "STAGING") {
    return path.resolve(BASE_PATH + "/stg-" + service + ROTATED_PATH);
  } else if (environment === "PRODUCTION") {
    return path.resolve(BASE_PATH + "/prod-" + service + ROTATED_PATH);
  } else {
    return path.resolve(BASE_PATH + "/local-" + service + ROTATED_PATH);
  }
}

function setupLogRotator({
  service = "default-service",
  maxSizeBytes = 10 * 1024 * 1024,
  maxBackups = 5,
  checkIntervalMs = 2 * 1000,
  logToConsole = false,
  environment = "LOCAL",
  logId = "",
} = {}) {
  logRotatorConfig = {
    service,
    maxSizeBytes,
    maxBackups,
    checkIntervalMs,
    logToConsole,
    environment,
    logFiles: [],
    logId,
  };

  if (logToConsole) {
    return;
  }
  rotatedDir = getRotatedDirPath(service, environment);
  logRotatorConfig.rotatedDir = rotatedDir;
  logRotatorConfig.logFiles.push(getLogFilePath(service, environment, logId));
  logRotatorConfig.logFiles.push(getMetricsFilePath(service, environment, logId));
  console.log(logRotatorConfig.logFiles);
  console.log(rotatedDir);
  // Create rotated logs directory if it doesn't exist
  if (!fs.existsSync(rotatedDir)) {
    fs.mkdirSync(rotatedDir, { recursive: true });
  }
}

function rotateLogFile(logFile, rotatedDir, maxSizeBytes, maxBackups) {
  try {
    if (!fs.existsSync(logFile)) return;
    const { size } = fs.statSync(logFile);
    if (size < maxSizeBytes) return;

    const baseName = path.basename(logFile);

    // Delete the oldest backup if it exists
    const oldest = path.join(rotatedDir, `${baseName}.${maxBackups}`);
    if (fs.existsSync(oldest)) {
      fs.unlinkSync(oldest);
    }

    // Shift backups: .4 -> .5, .3 -> .4, etc.
    for (let i = maxBackups - 1; i >= 1; i--) {
      const src = path.join(rotatedDir, `${baseName}.${i}`);
      const dest = path.join(rotatedDir, `${baseName}.${i + 1}`);
      if (fs.existsSync(src)) {
        fs.renameSync(src, dest);
      }
    }

    // Move current log file to .1 in rotated dir
    const rotated = path.join(rotatedDir, `${baseName}.1`);
    fs.renameSync(logFile, rotated);

    // Create a new empty log file
    fs.closeSync(fs.openSync(logFile, "w"));
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] Error rotating ${logFile}:`,
      err
    );
  }
}

function checkAndRotateAll() {
  for (const logFile of logRotatorConfig.logFiles) {
    rotateLogFile(
      logFile,
      logRotatorConfig.rotatedDir,
      logRotatorConfig.maxSizeBytes,
      logRotatorConfig.maxBackups
    );
  }
}

function cleanupOldFiles() {
  try {
    let logsDir;
    if (logRotatorConfig.environment === "DEVELOPMENT") {
      logsDir = path.resolve(BASE_PATH + "/dev-" + logRotatorConfig.service + "/logs");
    } else if (logRotatorConfig.environment === "STAGING") {
      logsDir = path.resolve(BASE_PATH + "/stg-" + logRotatorConfig.service + "/logs");
    } else if (logRotatorConfig.environment === "PRODUCTION") {
      logsDir = path.resolve(BASE_PATH + "/prod-" + logRotatorConfig.service + "/logs");
    } else if (logRotatorConfig.environment === "LOCAL") {
      logsDir = path.resolve(BASE_PATH + "/local-" + logRotatorConfig.service + "/logs");
    } else {
      return;
    }
    
    if (!fs.existsSync(logsDir)) {
      return;
    }
    const maxAgeMs = maxAgeHours;
    const cutoffTime = Date.now() - maxAgeMs;

    // Clean up files in logs directory
    const logFiles = fs.readdirSync(logsDir);
    let deletedCount = 0;

    for (const file of logFiles) {
      const filePath = path.join(logsDir, file);
      const stats = fs.statSync(filePath);
      
      // Only delete log and metrics files, not directories
      if (stats.isFile() && (file.startsWith('log-') || file.startsWith('metrics-'))) {
        if (stats.mtime.getTime() < cutoffTime) {
          try {
            fs.unlinkSync(filePath);
            deletedCount++;
            console.log(`[${new Date().toISOString()}] Deleted old file: ${filePath}`);
          } catch (err) {
            console.error(`[${new Date().toISOString()}] Error deleting file ${filePath}:`, err);
          }
        }
      }
    }

    if (deletedCount > 0) {
      console.log(`[${new Date().toISOString()}] Cleanup completed: ${deletedCount} files deleted`);
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error during cleanup:`, err);
  }
}

function startLogRotator() {
  if (rotationInterval) {
    return;
  }

  if (logRotatorConfig.logFiles.length === 0) {
    return;
  }

  rotationInterval = setInterval(
    checkAndRotateAll,
    logRotatorConfig.checkIntervalMs
  );

  // Also check immediately on start
  checkAndRotateAll();

  // Run cleanup immediately on start
  cleanupOldFiles();

  console.log(`[${new Date().toISOString()}] Log rotator started`);
}

function stopLogRotator() {
  if (rotationInterval) {
    clearInterval(rotationInterval);
    rotationInterval = null;
    console.log(`[${new Date().toISOString()}] Log rotator stopped`);
  } else {
    console.log(`[${new Date().toISOString()}] Log rotator was not running`);
  }
}

export { setupLogRotator, startLogRotator, stopLogRotator };
export default { setupLogRotator, startLogRotator, stopLogRotator };
