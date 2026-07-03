/**
 * Configuration system for the Patchwork evaluation pipeline.
 *
 * Loads settings from (in priority order):
 *   1. Explicit config object passed to constructor
 *   2. Config file specified via --config CLI flag
 *   3. patchwork.config.json in the current working directory
 *   4. Built-in defaults
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './Logger';

const COMPONENT = 'PipelineConfig';

export type GraphTypeName = 'import' | 'call' | 'dependency' | 'schema' | 'config' | 'cfg' | 'resource' | 'routing';
export type FailureCategoryName = 'SRF' | 'PIA' | 'DHI' | 'BCI' | 'RCF' | 'CFC' | 'CCV' | 'SSR';
export type OutputFormat = 'json' | 'text' | 'sarif';

export interface PipelineConfigData {
  graphs: GraphTypeName[];
  languages: Array<'python' | 'typescript'>;
  tools: {
    python_dir: string;
    node_dir: string;
    timeout_seconds: number;
  };
  detection: {
    categories: FailureCategoryName[];
    stdlib_path: string;
    registry_validation: boolean;
    registry_cache_path: string;
  };
  output: {
    format: OutputFormat;
    verbose: boolean;
  };
}

const ALL_GRAPH_TYPES: GraphTypeName[] = ['import', 'call', 'dependency', 'schema', 'config', 'cfg', 'resource', 'routing'];
const ALL_CATEGORIES: FailureCategoryName[] = ['SRF', 'PIA', 'DHI', 'BCI', 'RCF', 'CFC', 'CCV', 'SSR'];

function getDefaults(): PipelineConfigData {
  return {
    graphs: [...ALL_GRAPH_TYPES],
    languages: ['python', 'typescript'],
    tools: {
      python_dir: 'tools/python/',
      node_dir: 'tools/node/',
      timeout_seconds: 120,
    },
    detection: {
      categories: [...ALL_CATEGORIES],
      stdlib_path: 'tools/python/stdlib_modules.json',
      registry_validation: true,
      registry_cache_path: '.registry_cache.json',
    },
    output: {
      format: 'json',
      verbose: false,
    },
  };
}

export class PipelineConfig {
  private data: PipelineConfigData;

  constructor(overrides?: Partial<PipelineConfigData>) {
    const defaults = getDefaults();

    // Try loading from file first
    const fileConfig = this.loadFromFile();

    // Merge: defaults < file < explicit overrides
    this.data = this.merge(defaults, fileConfig, overrides ?? {});

    // Handle --verbose/--debug CLI flags
    if (process.argv.includes('--verbose') || process.argv.includes('--debug')) {
      this.data.output.verbose = true;
    }

    Logger.debug(COMPONENT, 'Configuration loaded', {
      graphs: this.data.graphs,
      categories: this.data.detection.categories,
      registryValidation: this.data.detection.registry_validation,
    });
  }

  private loadFromFile(): Partial<PipelineConfigData> {
    // Check --config CLI flag
    const configIdx = process.argv.indexOf('--config');
    let configPath: string | undefined;

    if (configIdx !== -1 && process.argv[configIdx + 1]) {
      configPath = process.argv[configIdx + 1];
    }

    // Fall back to default location
    if (!configPath) {
      const defaultPath = path.join(process.cwd(), 'patchwork.config.json');
      if (fs.existsSync(defaultPath)) {
        configPath = defaultPath;
      }
    }

    if (!configPath || !fs.existsSync(configPath)) {
      return {};
    }

    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PipelineConfigData>;
      Logger.info(COMPONENT, `Loaded config from ${configPath}`);
      return parsed;
    } catch (err: any) {
      Logger.warn(COMPONENT, `Failed to parse config file: ${configPath}`, {
        error: err.message,
      });
      return {};
    }
  }

  private merge(
    defaults: PipelineConfigData,
    file: Partial<PipelineConfigData>,
    overrides: Partial<PipelineConfigData>,
  ): PipelineConfigData {
    return {
      graphs: overrides.graphs ?? file.graphs ?? defaults.graphs,
      languages: overrides.languages ?? file.languages ?? defaults.languages,
      tools: {
        ...defaults.tools,
        ...(file.tools ?? {}),
        ...(overrides.tools ?? {}),
      },
      detection: {
        ...defaults.detection,
        ...(file.detection ?? {}),
        ...(overrides.detection ?? {}),
      },
      output: {
        ...defaults.output,
        ...(file.output ?? {}),
        ...(overrides.output ?? {}),
      },
    };
  }

  // ── Accessors ────────────────────────────────────────────────────

  get graphs(): GraphTypeName[] {
    return this.data.graphs;
  }

  get languages(): Array<'python' | 'typescript'> {
    return this.data.languages;
  }

  get toolTimeout(): number {
    return this.data.tools.timeout_seconds * 1000;
  }

  get pythonToolsDir(): string {
    return this.data.tools.python_dir;
  }

  get nodeToolsDir(): string {
    return this.data.tools.node_dir;
  }

  get categories(): FailureCategoryName[] {
    return this.data.detection.categories;
  }

  get registryValidation(): boolean {
    return this.data.detection.registry_validation;
  }

  get stdlibPath(): string {
    return this.data.detection.stdlib_path;
  }

  get outputFormat(): OutputFormat {
    return this.data.output.format;
  }

  get verbose(): boolean {
    return this.data.output.verbose;
  }

  isGraphEnabled(type: GraphTypeName): boolean {
    return this.data.graphs.includes(type);
  }

  isCategoryEnabled(category: FailureCategoryName): boolean {
    return this.data.detection.categories.includes(category);
  }

  /** Return the raw config data for serialization. */
  toJSON(): PipelineConfigData {
    return { ...this.data };
  }
}
