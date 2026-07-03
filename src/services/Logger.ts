/**
 * Structured logging for the Patchwork evaluation system.
 *
 * Supports two environment variables:
 *   LOG_LEVEL  – 'debug' | 'info' | 'warn' | 'error' (default: 'info')
 *   LOG_FORMAT – 'json' | 'text' (default: 'json')
 *
 * Also honours process.argv flags:
 *   --verbose  → sets effective level to 'debug'
 *   --debug    → sets effective level to 'debug'
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  data?: Record<string, unknown>;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

type LogFormat = 'json' | 'text';

function resolveLogLevel(): LogLevel {
  // CLI flags take highest priority
  if (process.argv.includes('--verbose') || process.argv.includes('--debug')) {
    return 'debug';
  }

  const envLevel = (process.env['LOG_LEVEL'] ?? '').toLowerCase();
  if (envLevel === 'debug' || envLevel === 'info' || envLevel === 'warn' || envLevel === 'error') {
    return envLevel;
  }

  return 'info';
}

function resolveLogFormat(): LogFormat {
  const envFormat = (process.env['LOG_FORMAT'] ?? '').toLowerCase();
  if (envFormat === 'text') {
    return 'text';
  }
  return 'json';
}

export class Logger {
  private static _level: LogLevel = resolveLogLevel();
  private static _format: LogFormat = resolveLogFormat();

  // -------------------------------------------------------------------
  // Allow runtime overrides (useful in tests)
  // -------------------------------------------------------------------

  static setLevel(level: LogLevel): void {
    Logger._level = level;
  }

  static getLevel(): LogLevel {
    return Logger._level;
  }

  static setFormat(format: LogFormat): void {
    Logger._format = format;
  }

  static getFormat(): LogFormat {
    return Logger._format;
  }

  // -------------------------------------------------------------------
  // Public logging methods
  // -------------------------------------------------------------------

  static debug(component: string, message: string, data?: Record<string, unknown>): void {
    Logger.log('debug', component, message, data);
  }

  static info(component: string, message: string, data?: Record<string, unknown>): void {
    Logger.log('info', component, message, data);
  }

  static warn(component: string, message: string, data?: Record<string, unknown>): void {
    Logger.log('warn', component, message, data);
  }

  static error(component: string, message: string, data?: Record<string, unknown>): void {
    Logger.log('error', component, message, data);
  }

  // -------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------

  private static log(
    level: LogLevel,
    component: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[Logger._level]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
      ...(data !== undefined ? { data } : {}),
    };

    const formatted = Logger._format === 'json'
      ? JSON.stringify(entry)
      : Logger.formatText(entry);

    switch (level) {
      case 'error':
        process.stderr.write(formatted + '\n');
        break;
      case 'warn':
        process.stderr.write(formatted + '\n');
        break;
      default:
        process.stdout.write(formatted + '\n');
        break;
    }
  }

  private static formatText(entry: LogEntry): string {
    const dataStr = entry.data ? ' ' + JSON.stringify(entry.data) : '';
    return `[${entry.timestamp}] ${entry.level.toUpperCase()} [${entry.component}] ${entry.message}${dataStr}`;
  }
}
