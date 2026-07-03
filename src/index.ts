// Main entry point for the code generation evaluation system

export * from './types';
export * from './interfaces';
export * from './models';
export * from './services';

// Version information
export const VERSION = '1.0.0';

// Default configuration
export const DEFAULT_CONFIG = {
  models: ['GPT-4o', 'Claude-3.5-Sonnet'] as const,
  promptStrategies: ['P1', 'P2', 'P3', 'P4'] as const,
  batchSize: 10,
  maxRetries: 3,
  parallelWorkers: 1,
};

console.log('Code Generation Evaluation System initialized');
console.log(`Version: ${VERSION}`);