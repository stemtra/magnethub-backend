import { config } from '../config/index.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  data?: unknown;
}

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

const levelColors: Record<LogLevel, string> = {
  debug: colors.dim,
  info: colors.cyan,
  warn: colors.yellow,
  error: colors.red,
};

const levelIcons: Record<LogLevel, string> = {
  debug: '🔍',
  info: '💡',
  warn: '⚠️ ',
  error: '❌',
};

class Logger {
  private serializeData(data: unknown): string {
    // Handle Error objects specially since they don't serialize with JSON.stringify
    if (data instanceof Error) {
      return JSON.stringify({
        name: data.name,
        message: data.message,
        stack: data.stack,
        ...(data as unknown as Record<string, unknown>), // Include any custom properties
      }, null, 2);
    }
    return JSON.stringify(data, null, 2);
  }

  private formatDevLog(entry: LogEntry): string {
    const { level, message, timestamp, data } = entry;
    const color = levelColors[level];
    const icon = levelIcons[level];
    const time = new Date(timestamp).toLocaleTimeString();

    let output = `${colors.dim}[${time}]${colors.reset} ${color}${icon} ${level.toUpperCase().padEnd(5)}${colors.reset} ${message}`;

    if (data !== undefined) {
      output += `\n${colors.dim}${this.serializeData(data)}${colors.reset}`;
    }

    return output;
  }

  private formatProdLog(entry: LogEntry): string {
    // Handle Error objects in production logs too
    if (entry.data instanceof Error) {
      return JSON.stringify({
        ...entry,
        data: {
          name: entry.data.name,
          message: entry.data.message,
          stack: entry.data.stack,
        },
      });
    }
    return JSON.stringify(entry);
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      data,
    };

    const formatted = config.isDev
      ? this.formatDevLog(entry)
      : this.formatProdLog(entry);

    if (level === 'error') {
      console.error(formatted);
    } else if (level === 'warn') {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }
  }

  debug(message: string, data?: unknown): void {
    if (config.isDev) {
      this.log('debug', message, data);
    }
  }

  info(message: string, data?: unknown): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown): void {
    this.log('error', message, data);
  }
}

export const logger = new Logger();

