import fs from "fs";
import path from "path";

// Configuration with sensible defaults
const BASE_PATH = "/Users/ehteshamalam/Documents/nemo3.0/backend/nemo3-api-fms-svc/observability";
const DEFAULT_CONFIG = {
  autoInstrument: true,
  defaultLabels: {},
  flushInterval: 5000, // 5 seconds
  logToConsole: false,
  logId: "",
};

let config = { ...DEFAULT_CONFIG };
// Global metrics registry
const metricsRegistry = {
  counters: new Map(),
  histograms: new Map(),
  gauges: new Map(),
  summaries: new Map(),
};

// Global state for tracking
const globalState = {
  activeConnections: 0,
  requestStartTimes: new Map(),
  pendingMetrics: [],
};

const DEFAULT_OBSERVATION_OBJ = {
  min: Infinity,
  max: -Infinity,
  avg: 0,
  count: 0,
  sum: 0,
};

let logFile = "";
function getMetricsFilePath(service, environment, logId) {
  if (environment === "DEVELOPMENT") {
    return path.resolve(
      BASE_PATH + "/dev-" + service + "/logs/metrics-" + logId + ".log"
    );
  } else if (environment === "STAGING") {
    return path.resolve(
      BASE_PATH + "/stg-" + service + "/logs/metrics-" + logId + ".log"
    );
  } else if (environment === "PRODUCTION") {
    return path.resolve(
      BASE_PATH + "/prod-" + service + "/logs/metrics-" + logId + ".log"
    );
  } else {
    return path.resolve(
      BASE_PATH + "/local-" + service + "/logs/metrics-" + logId + ".log"
    );
  }
}

// Initialize the metrics library
function initMetrics(userConfig = {}) {
  config = { ...DEFAULT_CONFIG, ...userConfig };
  if (config.logToConsole) {
    return;
  }
  logFile = getMetricsFilePath(
    config.defaultLabels.service,
    config.defaultLabels.environment,
    config.logId
  );
  // Ensure log file exists
  ensureLogFile();

  // Setup auto-instrumentation if enabled
  if (config.autoInstrument) {
    setupAutoInstrumentation();
  }

  // Setup periodic flushing
  setupPeriodicFlush();

  return {
    counter: createCounter,
    gauge: createGauge,
    histogram: createHistogram,
    summary: createSummary,
    trackRequest: trackApiRequest,
    middleware: trackApiRequestMiddleware,
    instrument: instrumentHTTPRequests,
    getMetrics: getMetrics,
    reset: resetMetrics,
    apiCall: makeApiCall,
  };
}

// Ensure log file exists
function ensureLogFile() {
  const logDir = path.dirname(logFile);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  if (fs.existsSync(logFile)) {
    const stats = fs.statSync(logFile);
    if (stats.isDirectory()) {
      fs.rmdirSync(logFile);
      fs.writeFileSync(logFile, "");
    }
  } else {
    fs.writeFileSync(logFile, "");
  }
}

// Write metric to log file with batching
function writeMetric(metricData) {
  try {
    const logEntry = {
      ...metricData,
      timestamp: new Date().toISOString(),
      data_type: "metric",
      ...config.defaultLabels,
    };

    globalState.pendingMetrics.push(logEntry);

    if (config.logToConsole) {
      console.log(`${metricData.metric_name} = ${metricData.value}`);
    }
  } catch (error) {
    console.error("Error preparing metric:", error);
  }
}

// Flush pending metrics to file
async function flushMetrics() {
  if (globalState.pendingMetrics.length === 0) {
    return;
  }

  try {
    const metricsToWrite =
      globalState.pendingMetrics
        .map((metric) => {
          const cleanMetric = { ...metric };

          if (cleanMetric.bucket === "inf") {
            delete cleanMetric.bucket;
          }

          if (cleanMetric.value !== undefined) {
            cleanMetric.value = Number(cleanMetric.value);
          }
          if (cleanMetric.count !== undefined) {
            cleanMetric.count = Number(cleanMetric.count);
          }
          if (cleanMetric.sum !== undefined) {
            cleanMetric.sum = Number(cleanMetric.sum);
          }
          if (cleanMetric.min !== undefined) {
            cleanMetric.min = Number(cleanMetric.min);
          }
          if (cleanMetric.max !== undefined) {
            cleanMetric.max = Number(cleanMetric.max);
          }
          if (cleanMetric.avg !== undefined) {
            cleanMetric.avg = Number(cleanMetric.avg);
          }

          return JSON.stringify(cleanMetric);
        })
        .join("\n") + "\n";

    await fs.promises.appendFile(logFile, metricsToWrite, {
      encoding: "utf8",
      flag: "a",
    });
    globalState.pendingMetrics = [];
  } catch (error) {
    console.error("Error flushing metrics:", error);
  }
}

// Setup periodic flushing
function setupPeriodicFlush() {
  setInterval(flushMetrics, config.flushInterval);

  // Flush on process exit
  process.on("beforeExit", flushMetrics);
  process.on("SIGINT", () => {
    flushMetrics();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    flushMetrics();
    process.exit(0);
  });
}

// Enhanced counter with minimal configuration
function createCounter(name, options = {}) {
  if (metricsRegistry.counters.has(name)) {
    return metricsRegistry.counters.get(name);
  }

  const {
    help = `Counter metric: ${name}`,
    labelNames = [],
    initialValue = 0,
  } = options;

  let count = initialValue;
  const counterObj = {
    inc: (value = 1, labels = {}) => {
      count += value;
      writeMetric({
        metric_name: name,
        metric_type: "counter",
        value: count,
        help: help,
        labels: labels,
        label_names: labelNames,
      });
    },
    get: () => count,
    reset: () => {
      count = 0;
    },
  };

  metricsRegistry.counters.set(name, counterObj);
  return counterObj;
}

// Enhanced histogram with automatic buckets
function createHistogram(name, options = {}) {
  if (metricsRegistry.histograms.has(name)) {
    return metricsRegistry.histograms.get(name);
  }

  const {
    help = `Histogram metric: ${name}`,
    labelNames = [],
    buckets = [0.1, 0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500, 1000],
  } = options;

  let observObj = {
    ...DEFAULT_OBSERVATION_OBJ,
  };
  const histogramObj = {
    observe: (value, labels = {}) => {
      if (observObj.min > value) {
        observObj.min = value;
      }
      if (observObj.max < value) {
        observObj.max = value;
      }
      observObj.sum += value;
      observObj.count++;
      observObj.avg = observObj.count > 0 ? observObj.sum / observObj.count : 0;
      const metricData = {
        metric_name: name,
        metric_type: "histogram",
        value: value,
        help: help,
        labels: labels,
        label_names: labelNames,
        bucket: getBucket(value, buckets),
        count: observObj.count,
        sum: observObj.sum,
        min: observObj.min,
        max: observObj.max,
        avg: observObj.avg,
      };
      writeMetric(metricData);
    },
    get: () => ({
      count: observObj.count,
      sum: observObj.sum,
      min: observObj.min === Infinity ? 0 : observObj.min,
      max: observObj.max === -Infinity ? 0 : observObj.max,
      avg: observObj.avg,
    }),
    reset: () => {
      observObj = { ...DEFAULT_OBSERVATION_OBJ };
    },
  };

  metricsRegistry.histograms.set(name, histogramObj);
  return histogramObj;
}

// Enhanced gauge with automatic tracking
function createGauge(name, options = {}) {
  if (metricsRegistry.gauges.has(name)) {
    return metricsRegistry.gauges.get(name);
  }

  const {
    help = `Gauge metric: ${name}`,
    labelNames = [],
    initialValue = 0,
  } = options;

  let currentValue = initialValue;
  const gaugeObj = {
    set: (value, labels = {}) => {
      currentValue = value;
      writeMetric({
        metric_name: name,
        metric_type: "gauge",
        value: value,
        help: help,
        labels: labels,
        label_names: labelNames,
      });
    },
    inc: (value = 1, labels = {}) => {
      currentValue += value;
      writeMetric({
        metric_name: name,
        metric_type: "gauge",
        value: currentValue,
        help: help,
        labels: labels,
        label_names: labelNames,
        operation: "increment",
      });
    },
    dec: (value = 1, labels = {}) => {
      currentValue -= value;
      writeMetric({
        metric_name: name,
        metric_type: "gauge",
        value: currentValue,
        help: help,
        labels: labels,
        label_names: labelNames,
        operation: "decrement",
      });
    },
    get: () => currentValue,
    reset: () => {
      currentValue = 0;
    },
  };

  metricsRegistry.gauges.set(name, gaugeObj);
  return gaugeObj;
}

// Enhanced summary with automatic quantiles
function createSummary(name, options = {}) {
  if (metricsRegistry.summaries.has(name)) {
    return metricsRegistry.summaries.get(name);
  }

  const {
    help = `Summary metric: ${name}`,
    labelNames = [],
    quantiles = [0.5, 0.9, 0.95, 0.99],
  } = options;

  let observObj = {
    ...DEFAULT_OBSERVATION_OBJ,
  };
  const summaryObj = {
    observe: (value, labels = {}) => {
      if (observObj.min > value) {
        observObj.min = value;
      }
      if (observObj.max < value) {
        observObj.max = value;
      }
      observObj.sum += value;
      observObj.count++;
      observObj.avg = observObj.count > 0 ? observObj.sum / observObj.count : 0;
      const metricData = {
        metric_name: name,
        metric_type: "summary",
        value: value,
        help: help,
        labels: labels,
        label_names: labelNames,
        count: observObj.count,
        sum: observObj.sum,
        min: observObj.min,
        max: observObj.max,
        avg: observObj.avg,
      };
      writeMetric(metricData);
    },
    get: () => {
      return {
        count: observObj.count,
        sum: observObj.sum,
        min: observObj.min === Infinity ? 0 : observObj.min,
        max: observObj.max === -Infinity ? 0 : observObj.max,
        avg: observObj.avg,
      };
    },
    reset: () => {
      observObj = { ...DEFAULT_OBSERVATION_OBJ };
    },
  };

  metricsRegistry.summaries.set(name, summaryObj);
  return summaryObj;
}

// Pre-defined API metrics with better defaults
const apiMetrics = {
  requestCounter: createCounter("http_requests_total", {
    help: "Total number of HTTP requests",
    labelNames: ["method", "endpoint", "status_code"],
  }),
  requestDuration: createHistogram("http_request_duration_seconds", {
    help: "HTTP request duration in seconds",
    labelNames: ["method", "endpoint"],
    buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
  }),
  requestSize: createHistogram("http_request_size_bytes", {
    help: "HTTP request size in bytes",
    labelNames: ["method", "endpoint"],
    buckets: [100, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
  }),
  responseSize: createHistogram("http_response_size_bytes", {
    help: "HTTP response size in bytes",
    labelNames: ["method", "endpoint"],
    buckets: [100, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
  }),
  activeConnections: createGauge("http_active_connections", {
    help: "Number of active HTTP connections",
    labelNames: ["endpoint"],
  }),
  errorCounter: createCounter("http_errors_total", {
    help: "Total number of HTTP errors",
    labelNames: ["method", "endpoint", "error_type"],
  }),
};

// Simplified API tracking function
function trackApiRequest(req, res, next) {
  const requestId = generateRequestId();
  const startTime = Date.now();
  const method = req.method || "GET";
  const endpoint = req.path || req.url || "/";

  // Extract request size
  const requestSize = getRequestSize(req);

  // Increment active connections
  globalState.activeConnections++;
  apiMetrics.activeConnections.set(globalState.activeConnections, { endpoint });

  // Track request start time
  globalState.requestStartTimes.set(requestId, startTime);

  // Record request size
  apiMetrics.requestSize.observe(requestSize, { method, endpoint });

  // Override response methods to track response size and completion
  const originalSend = res.send;
  const originalJson = res.json;
  const originalEnd = res.end;

  res.send = function (data) {
    trackResponse(requestId, method, endpoint, data, "send");
    return originalSend.call(this, data);
  };

  res.json = function (data) {
    trackResponse(requestId, method, endpoint, data, "json");
    return originalJson.call(this, data);
  };

  res.end = function (data) {
    trackResponse(requestId, method, endpoint, data, "end");
    return originalEnd.call(this, data);
  };

  // Track request completion
  res.on("finish", () => {
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000; // Convert to seconds
    const statusCode = res.statusCode;

    // Record request duration
    apiMetrics.requestDuration.observe(duration, { method, endpoint });

    // Increment request counter
    apiMetrics.requestCounter.inc(1, {
      method,
      endpoint,
      status_code: statusCode.toString(),
    });

    // Track errors
    if (statusCode >= 400) {
      const errorType = statusCode >= 500 ? "server_error" : "client_error";
      apiMetrics.errorCounter.inc(1, {
        method,
        endpoint,
        error_type: errorType,
      });
    }

    // Decrement active connections
    globalState.activeConnections--;
    apiMetrics.activeConnections.set(globalState.activeConnections, {
      endpoint,
    });

    // Clean up
    globalState.requestStartTimes.delete(requestId);
  });

  // Handle errors
  res.on("error", (error) => {
    apiMetrics.errorCounter.inc(1, {
      method,
      endpoint,
      error_type: "response_error",
    });

    // Decrement active connections on error
    globalState.activeConnections--;
    apiMetrics.activeConnections.set(globalState.activeConnections, {
      endpoint,
    });

    globalState.requestStartTimes.delete(requestId);
  });

  if (next) {
    next();
  }
}

// Express middleware wrapper
function trackApiRequestMiddleware() {
  return (req, res, next) => {
    trackApiRequest(req, res, next);
  };
}

// Simplified manual API tracking
function trackApiCall(options) {
  const {
    method = "GET",
    endpoint = "/",
    duration = 0,
    statusCode = 200,
    requestSize = 0,
    responseSize = 0,
    error = null,
  } = options;

  // Increment active connections
  globalState.activeConnections++;
  apiMetrics.activeConnections.set(globalState.activeConnections, { endpoint });

  // Record metrics
  apiMetrics.requestSize.observe(requestSize, { method, endpoint });
  apiMetrics.responseSize.observe(responseSize, { method, endpoint });
  apiMetrics.requestDuration.observe(duration, { method, endpoint });
  apiMetrics.requestCounter.inc(1, {
    method,
    endpoint,
    status_code: statusCode.toString(),
  });

  // Track errors
  if (error || statusCode >= 400) {
    const errorType = error
      ? "exception"
      : statusCode >= 500
      ? "server_error"
      : "client_error";
    apiMetrics.errorCounter.inc(1, { method, endpoint, error_type: errorType });
  }

  // Decrement active connections
  globalState.activeConnections--;
  apiMetrics.activeConnections.set(globalState.activeConnections, { endpoint });
}

// Auto-instrumentation setup
function setupAutoInstrumentation() {
  // Error tracking
  const errorCounter = createCounter("errors_total", {
    help: "Total number of errors",
    labelNames: ["error_type", "error_message"],
  });

  // Override console.error
  const originalConsoleError = console.error;
  console.error = function (...args) {
    const errorMessage = args.join(" ");
    errorCounter.inc(1, {
      error_type: "console_error",
      error_message: errorMessage.substring(0, 100),
    });
    originalConsoleError.apply(console, args);
  };

  // Global error handlers
  process.on("uncaughtException", (error) => {
    errorCounter.inc(1, {
      error_type: "uncaught_exception",
      error_message: error.message.substring(0, 100),
    });
  });

  process.on("unhandledRejection", (reason) => {
    const errorMessage =
      reason instanceof Error ? reason.message : String(reason);
    errorCounter.inc(1, {
      error_type: "unhandled_rejection",
      error_message: errorMessage.substring(0, 100),
    });
  });

  // Performance monitoring
  const memoryGauge = createGauge("memory_usage_bytes", {
    help: "Memory usage in bytes",
    labelNames: ["type"],
  });

  const cpuGauge = createGauge("cpu_usage_percent", {
    help: "CPU usage percentage",
  });

  // Monitor memory usage
  setInterval(() => {
    const memUsage = process.memoryUsage();
    memoryGauge.set(memUsage.rss, { type: "rss" });
    memoryGauge.set(memUsage.heapUsed, { type: "heap_used" });
    memoryGauge.set(memUsage.heapTotal, { type: "heap_total" });
    memoryGauge.set(memUsage.external, { type: "external" });
  }, 10000); // Every 10 seconds

  // Monitor CPU usage
  let lastCPUUsage = process.cpuUsage();
  setInterval(() => {
    const currentCPUUsage = process.cpuUsage();
    const userDiff = currentCPUUsage.user - lastCPUUsage.user;
    const systemDiff = currentCPUUsage.system - lastCPUUsage.system;
    const totalDiff = userDiff + systemDiff;

    cpuGauge.set(totalDiff / 1000000); // Convert to percentage-like value
    lastCPUUsage = currentCPUUsage;
  }, 10000);

  return { errorCounter, memoryGauge, cpuGauge };
}

// Database instrumentation
function instrumentDatabase(db) {
  const queryCounter = createCounter("database_queries_total", {
    help: "Total number of database queries",
    labelNames: ["operation", "table"],
  });

  const queryDuration = createHistogram("database_query_duration_seconds", {
    help: "Database query duration in seconds",
    labelNames: ["operation", "table"],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2.5, 5, 10],
  });

  const queryErrors = createCounter("database_errors_total", {
    help: "Total number of database errors",
    labelNames: ["operation", "table", "error_type"],
  });

  // Wrap database methods
  const originalQuery = db.query;
  if (originalQuery) {
    db.query = function (...args) {
      const startTime = Date.now();
      const operation = args[0]?.toLowerCase().split(" ")[0] || "unknown";
      const table = extractTableName(args[0]) || "unknown";

      queryCounter.inc(1, { operation, table });

      return originalQuery
        .apply(this, args)
        .then((result) => {
          const duration = (Date.now() - startTime) / 1000;
          queryDuration.observe(duration, { operation, table });
          return result;
        })
        .catch((error) => {
          const duration = (Date.now() - startTime) / 1000;
          queryDuration.observe(duration, { operation, table });
          queryErrors.inc(1, {
            operation,
            table,
            error_type: error.code || "unknown",
          });
          throw error;
        });
    };
  }

  return { queryCounter, queryDuration, queryErrors };
}

// Helper functions
function getRequestSize(req) {
  let size = 0;

  if (req.headers["content-length"]) {
    size += parseInt(req.headers["content-length"]) || 0;
  }

  if (req.url) {
    size += Buffer.byteLength(req.url);
  }

  for (const [key, value] of Object.entries(req.headers)) {
    size += Buffer.byteLength(key) + Buffer.byteLength(value);
  }

  return size;
}

function trackResponse(requestId, method, endpoint, data, responseType) {
  let responseSize = 0;

  if (data) {
    if (typeof data === "string") {
      responseSize = Buffer.byteLength(data);
    } else if (typeof data === "object") {
      responseSize = JSON.stringify(data).length;
    } else {
      responseSize = Buffer.byteLength(String(data));
    }
  }

  apiMetrics.responseSize.observe(responseSize, { method, endpoint });
}

function generateRequestId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function getBucket(value, buckets) {
  for (const bucket of buckets) {
    if (value <= bucket) {
      return bucket;
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

function getQuantile(sorted, q) {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.ceil(q * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function extractTableName(sql) {
  if (!sql) {
    return null;
  }
  const match = sql
    .toLowerCase()
    .match(/(?:from|into|update|delete\s+from)\s+([a-zA-Z_][a-zA-Z0-9_]*)/);
  return match ? match[1] : null;
}

// Get all registered metrics
function getMetrics() {
  return {
    counters: Array.from(metricsRegistry.counters.keys()),
    histograms: Array.from(metricsRegistry.histograms.keys()),
    gauges: Array.from(metricsRegistry.gauges.keys()),
    summaries: Array.from(metricsRegistry.summaries.keys()),
  };
}

// Reset all metrics
function resetMetrics() {
  metricsRegistry.counters.clear();
  metricsRegistry.histograms.clear();
  metricsRegistry.gauges.clear();
  metricsRegistry.summaries.clear();
  globalState.activeConnections = 0;
  globalState.requestStartTimes.clear();
  globalState.pendingMetrics = [];
}

// Legacy function for backward compatibility
function instrumentHTTPRequests(app) {
  return trackApiRequestMiddleware();
}

// NEW: Simple API call function that handles everything automatically
async function makeApiCall(method, url, body = null, options = {}) {
  const startTime = Date.now();
  const urlObj = new URL(url);
  const endpoint = urlObj.pathname;

  // Calculate request size
  let requestSize = 0;
  if (body) {
    if (typeof body === "string") {
      requestSize = Buffer.byteLength(body);
    } else {
      requestSize = Buffer.byteLength(JSON.stringify(body));
    }
  }

  // Increment active connections
  globalState.activeConnections++;
  apiMetrics.activeConnections.set(globalState.activeConnections, { endpoint });

  try {
    // Prepare headers
    const headers = {
      "Content-Type": "application/json",
      ...options.headers,
    };

    // Prepare request options
    const requestOptions = {
      method: method.toUpperCase(),
      headers: headers,
      ...options,
    };

    // Add body if provided
    if (body) {
      requestOptions.body =
        typeof body === "string" ? body : JSON.stringify(body);
    }

    // Make the actual API call
    const response = await fetch(url, requestOptions);

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;
    const responseSize = response.headers.get("content-length") || 0;

    // Record metrics
    apiMetrics.requestSize.observe(requestSize, {
      method: method.toUpperCase(),
      endpoint,
    });
    apiMetrics.responseSize.observe(parseInt(responseSize), {
      method: method.toUpperCase(),
      endpoint,
    });
    apiMetrics.requestDuration.observe(duration, {
      method: method.toUpperCase(),
      endpoint,
    });
    apiMetrics.requestCounter.inc(1, {
      method: method.toUpperCase(),
      endpoint,
      status_code: response.status.toString(),
    });

    // Track errors
    if (!response.ok) {
      const errorType =
        response.status >= 500 ? "server_error" : "client_error";
      apiMetrics.errorCounter.inc(1, {
        method: method.toUpperCase(),
        endpoint,
        error_type: errorType,
      });
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Parse response
    let data;
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    return {
      data: data,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      duration: duration,
      requestSize: requestSize,
      responseSize: parseInt(responseSize),
    };
  } catch (error) {
    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    // Record error metrics
    apiMetrics.errorCounter.inc(1, {
      method: method.toUpperCase(),
      endpoint,
      error_type: error.name || "network_error",
    });

    apiMetrics.requestDuration.observe(duration, {
      method: method.toUpperCase(),
      endpoint,
    });
    apiMetrics.requestCounter.inc(1, {
      method: method.toUpperCase(),
      endpoint,
      status_code: "0",
    });

    throw error;
  } finally {
    // Decrement active connections
    globalState.activeConnections--;
    apiMetrics.activeConnections.set(globalState.activeConnections, {
      endpoint,
    });
  }
}

// Export the main initialization function and utilities
export {
  initMetrics,
  createCounter,
  createGauge,
  createHistogram,
  createSummary,
  trackApiRequest,
  trackApiRequestMiddleware,
  trackApiCall,
  instrumentDatabase,
  getMetrics,
  resetMetrics,
  instrumentHTTPRequests, // Legacy export
  makeApiCall,
};

export default initMetrics;
