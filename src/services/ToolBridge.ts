import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from './Logger';

const COMPONENT = 'ToolBridge';

export interface ToolBridgeConfig {
  pythonToolsDir: string;
  nodeToolsDir: string;
  timeout: number;
  tempDir: string;
  /** Optional per-script timeout overrides (script name -> timeout in ms). */
  scriptTimeouts?: Record<string, number>;
}

/**
 * Resolve the default timeout from the TOOL_TIMEOUT environment variable,
 * falling back to 30 000 ms.
 */
function resolveDefaultTimeout(): number {
  const envTimeout = process.env['TOOL_TIMEOUT'];
  if (envTimeout !== undefined) {
    const parsed = parseInt(envTimeout, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 30000;
}

const DEFAULT_CONFIG: ToolBridgeConfig = {
  pythonToolsDir: path.join(__dirname, '..', '..', 'tools', 'python'),
  nodeToolsDir: path.join(__dirname, '..', '..', 'tools', 'node'),
  timeout: resolveDefaultTimeout(),
  tempDir: path.join(process.cwd(), 'temp', 'tool-analysis'),
};

export class ToolBridge {
  private config: ToolBridgeConfig;

  constructor(config?: Partial<ToolBridgeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ensureTempDir();
  }

  private ensureTempDir(): void {
    if (!fs.existsSync(this.config.tempDir)) {
      fs.mkdirSync(this.config.tempDir, { recursive: true });
    }
  }

  /**
   * Return the effective timeout for a given script.  Per-script overrides
   * (from `config.scriptTimeouts`) take precedence over the global default.
   */
  private getTimeout(scriptName: string): number {
    const perScript = this.config.scriptTimeouts;
    if (perScript) {
      const override = perScript[scriptName];
      if (override !== undefined) {
        return override;
      }
    }
    return this.config.timeout;
  }

  /**
   * Execute a Python analysis script, passing code via stdin, getting JSON back.
   */
  executePythonScript(scriptName: string, code: string, extraArgs?: Record<string, unknown>): Record<string, unknown> {
    const scriptPath = path.join(this.config.pythonToolsDir, `${scriptName}.py`);

    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Python tool script not found: ${scriptPath}`);
    }

    // If extraArgs, we send JSON with code + args via stdin
    let input: string;
    if (extraArgs) {
      input = JSON.stringify({ code, ...extraArgs });
    } else {
      input = code;
    }

    const timeout = this.getTimeout(scriptName);
    const startTime = Date.now();

    Logger.info(COMPONENT, `Executing Python script '${scriptName}'`, {
      scriptName,
      timeout,
    });

    try {
      const result = execSync(`python3 "${scriptPath}"`, {
        input,
        encoding: 'utf-8',
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const durationMs = Date.now() - startTime;
      const parsed = this.parseOutput(result);

      Logger.info(COMPONENT, `Python script '${scriptName}' succeeded`, {
        scriptName,
        outputSize: result.length,
        durationMs,
      });

      return parsed;
    } catch (error: any) {
      const durationMs = Date.now() - startTime;

      if (error.killed) {
        Logger.error(COMPONENT, `Python script '${scriptName}' timed out`, {
          scriptName,
          timeout,
          durationMs,
        });
        throw new Error(`Python tool '${scriptName}' timed out after ${timeout}ms`);
      }
      // If process exited with error but produced stdout, try parsing it
      if (error.stdout) {
        try {
          return this.parseOutput(error.stdout);
        } catch {
          // fall through
        }
      }
      const stderr: string = error.stderr?.toString() || '';
      Logger.error(COMPONENT, `Python script '${scriptName}' failed`, {
        scriptName,
        durationMs,
        stderrSnippet: stderr.slice(0, 300),
      });
      throw new Error(`Python tool '${scriptName}' failed: ${stderr.slice(0, 500)}`);
    }
  }

  /**
   * Execute a Node.js analysis script, passing JSON via stdin, getting JSON back.
   */
  executeNodeScript(scriptName: string, input: string, extraArgs?: Record<string, unknown>): Record<string, unknown> {
    const scriptPath = path.join(this.config.nodeToolsDir, `${scriptName}.js`);

    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Node tool script not found: ${scriptPath}`);
    }

    let stdinData: string;
    if (extraArgs) {
      const parsed = input ? JSON.parse(input) : {};
      stdinData = JSON.stringify({ ...parsed, ...extraArgs });
    } else {
      stdinData = input;
    }

    const timeout = this.getTimeout(scriptName);
    const startTime = Date.now();

    Logger.info(COMPONENT, `Executing Node script '${scriptName}'`, {
      scriptName,
      timeout,
    });

    try {
      const result = execSync(`node "${scriptPath}"`, {
        input: stdinData,
        encoding: 'utf-8',
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const durationMs = Date.now() - startTime;
      const parsedResult = this.parseNodeOutput(result);

      Logger.info(COMPONENT, `Node script '${scriptName}' succeeded`, {
        scriptName,
        outputSize: result.length,
        durationMs,
      });

      return parsedResult;
    } catch (error: any) {
      const durationMs = Date.now() - startTime;

      if (error.killed) {
        Logger.error(COMPONENT, `Node script '${scriptName}' timed out`, {
          scriptName,
          timeout,
          durationMs,
        });
        throw new Error(`Node tool '${scriptName}' timed out after ${timeout}ms`);
      }
      // If process exited with error but produced stdout, try parsing it
      if (error.stdout) {
        try {
          return this.parseNodeOutput(error.stdout);
        } catch {
          // fall through
        }
      }
      const stderr: string = error.stderr?.toString() || '';
      Logger.error(COMPONENT, `Node script '${scriptName}' failed`, {
        scriptName,
        durationMs,
        stderrSnippet: stderr.slice(0, 300),
      });
      throw new Error(`Node tool '${scriptName}' failed: ${stderr.slice(0, 500)}`);
    }
  }

  /**
   * Create a temporary file with the given content and return its path.
   */
  createTempFile(content: string, ext: string): string {
    const fileName = `tool_${uuidv4()}${ext}`;
    const filePath = path.join(this.config.tempDir, fileName);
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  /**
   * Clean up temporary files.
   */
  cleanup(filePaths: string[]): void {
    for (const fp of filePaths) {
      try {
        if (fs.existsSync(fp)) {
          fs.unlinkSync(fp);
        }
      } catch {
        // Best effort cleanup
      }
    }
  }

  /**
   * Load a JSON data file from the tools directory.
   */
  loadToolData(fileName: string): Record<string, unknown> {
    const filePath = path.join(this.config.pythonToolsDir, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Tool data file not found: ${filePath}`);
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  }

  private parseOutput(raw: string): Record<string, unknown> {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new Error('Python tool returned empty output');
    }
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      throw new Error(`Failed to parse Python tool output as JSON: ${trimmed.slice(0, 200)}`);
    }
  }

  private parseNodeOutput(raw: string): Record<string, unknown> {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new Error('Node tool returned empty output');
    }
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      throw new Error(`Failed to parse Node tool output as JSON: ${trimmed.slice(0, 200)}`);
    }
  }
}
