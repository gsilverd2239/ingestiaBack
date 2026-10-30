const winston = require('winston');
const path = require('path');
const fs = require('fs');

const logDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// In-memory circular buffer for frontend real-time log access
const MAX_MEMORY_LOGS = 300;
const memoryLogs = [];

const memoryLogFormat = winston.format((info) => {
  const logItem = {
    timestamp: info.timestamp || new Date().toISOString(),
    level: info.level,
    message: info.message,
    meta: info.meta || (Object.keys(info).reduce((acc, key) => {
      if (!['timestamp', 'level', 'message'].includes(key)) {
        acc[key] = info[key];
      }
      return acc;
    }, {}))
  };

  memoryLogs.push(logItem);
  if (memoryLogs.length > MAX_MEMORY_LOGS) {
    memoryLogs.shift();
  }
  return info;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    memoryLogFormat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'ingestIA-backend' },
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'ingestia.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length > 1 ? ` ${JSON.stringify(meta)}` : '';
          return `[${timestamp}] [${level}]: ${message}${metaStr}`;
        })
      )
    })
  ]
});

function getRecentLogs(limit = 100, level = null) {
  let filtered = memoryLogs;
  if (level) {
    filtered = filtered.filter(l => l.level.toLowerCase() === level.toLowerCase());
  }
  return filtered.slice(-limit);
}

function clearRecentLogs() {
  memoryLogs.length = 0;
}

module.exports = {
  logger,
  getRecentLogs,
  clearRecentLogs
};
