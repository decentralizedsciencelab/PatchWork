// Jest test setup file
import * as fc from 'fast-check';

// Configure fast-check for property-based testing
fc.configureGlobal({
  numRuns: 100, // Minimum 100 iterations as specified in design
  verbose: true,
  seed: 42, // For reproducible tests
});

// Extend Jest matchers if needed
declare global {
  const fc: typeof import('fast-check');
}

// Global test utilities
(global as any).fc = fc;

console.log('Test setup completed with fast-check configured');