/**
 * **Feature: code-generation-evaluation, Property 14: Metrics calculation completeness**
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**
 *
 * Property: For any metrics calculation operation, the system should compute:
 * - Detection metrics (precision, recall, F1) per failure category
 * - Fingerprinting metrics (Jensen-Shannon divergence, rate ratios)
 * - Comparison metrics (incremental recall, evasion rates)
 * - Statistical tests (McNemar, chi-squared, bootstrap CI)
 */

import * as fc from 'fast-check';
import { MetricsCalculator } from '../services/MetricsCalculator';
import { FailureDetection } from '../types';

describe('Property 14: Metrics calculation completeness', () => {
  let metricsCalculator: MetricsCalculator;

  beforeEach(() => {
    metricsCalculator = new MetricsCalculator();
  });

  // Arbitrary generator for code location
  const codeLocationArb = fc.record({
    file: fc.string({ minLength: 1 }).map(s => `${s}.ts`),
    line: fc.integer({ min: 1, max: 1000 }),
    column: fc.integer({ min: 0, max: 200 })
  });

  // Arbitrary generator for failure detection
  const failureDetectionArb = fc.record({
    id: fc.uuid(),
    generationId: fc.uuid(),
    category: fc.constantFrom('import', 'call', 'schema', 'config', 'type', 'dependency') as fc.Arbitrary<'import' | 'call' | 'schema' | 'config' | 'type' | 'dependency'>,
    severity: fc.constantFrom('error', 'warning') as fc.Arbitrary<'error' | 'warning'>,
    description: fc.string({ minLength: 1 }),
    location: codeLocationArb,
    detectedBy: fc.constantFrom('graph-analysis', 'compile', 'test', 'sast', 'regex') as fc.Arbitrary<'graph-analysis' | 'compile' | 'test' | 'sast' | 'regex'>
  });

  // Generator for failures with specific detection method
  const failureWithDetectionMethodArb = (method: 'graph-analysis' | 'compile' | 'test' | 'sast' | 'regex') =>
    failureDetectionArb.map(f => ({ ...f, detectedBy: method }));

  describe('Detection Metrics (Requirements 6.1)', () => {
    test('calculateDetectionMetrics should produce valid precision, recall, and F1 scores', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(failureDetectionArb, { minLength: 0, maxLength: 50 }),
          fc.array(failureDetectionArb, { minLength: 0, maxLength: 50 }),
          async (predicted: FailureDetection[], actual: FailureDetection[]) => {
            const metrics = await metricsCalculator.calculateDetectionMetrics(predicted, actual);

            // Property: Should return an array of detection metrics
            expect(Array.isArray(metrics)).toBe(true);

            // Each metric should have valid structure
            for (const metric of metrics) {
              expect(metric).toHaveProperty('category');
              expect(metric).toHaveProperty('precision');
              expect(metric).toHaveProperty('recall');
              expect(metric).toHaveProperty('f1Score');
              expect(metric).toHaveProperty('truePositives');
              expect(metric).toHaveProperty('falsePositives');
              expect(metric).toHaveProperty('falseNegatives');

              // Property: Precision, recall, F1 must be between 0 and 1
              expect(metric.precision).toBeGreaterThanOrEqual(0);
              expect(metric.precision).toBeLessThanOrEqual(1);
              expect(metric.recall).toBeGreaterThanOrEqual(0);
              expect(metric.recall).toBeLessThanOrEqual(1);
              expect(metric.f1Score).toBeGreaterThanOrEqual(0);
              expect(metric.f1Score).toBeLessThanOrEqual(1);

              // Property: Counts must be non-negative integers
              expect(metric.truePositives).toBeGreaterThanOrEqual(0);
              expect(metric.falsePositives).toBeGreaterThanOrEqual(0);
              expect(metric.falseNegatives).toBeGreaterThanOrEqual(0);
              expect(Number.isInteger(metric.truePositives)).toBe(true);
              expect(Number.isInteger(metric.falsePositives)).toBe(true);
              expect(Number.isInteger(metric.falseNegatives)).toBe(true);
            }

            // Property: Metrics should cover all unique categories from both sets
            const allCategories = new Set([
              ...predicted.map(f => f.category),
              ...actual.map(f => f.category)
            ]);
            const metricsCategories = new Set(metrics.map(m => m.category));

            for (const category of allCategories) {
              expect(metricsCategories.has(category)).toBe(true);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    test('F1 score should be harmonic mean of precision and recall', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(failureDetectionArb, { minLength: 1, maxLength: 30 }),
          fc.array(failureDetectionArb, { minLength: 1, maxLength: 30 }),
          async (predicted: FailureDetection[], actual: FailureDetection[]) => {
            const metrics = await metricsCalculator.calculateDetectionMetrics(predicted, actual);

            for (const metric of metrics) {
              if (metric.precision + metric.recall > 0) {
                const expectedF1 = 2 * (metric.precision * metric.recall) / (metric.precision + metric.recall);
                expect(metric.f1Score).toBeCloseTo(expectedF1, 5);
              } else {
                expect(metric.f1Score).toBe(0);
              }
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Fingerprinting Metrics (Requirements 6.2)', () => {
    test('calculateFingerprintingMetrics should produce valid Jensen-Shannon divergence', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(failureDetectionArb, { minLength: 0, maxLength: 30 }),
          fc.array(failureDetectionArb, { minLength: 0, maxLength: 30 }),
          async (failures1: FailureDetection[], failures2: FailureDetection[]) => {
            const modelFailures = new Map<string, FailureDetection[]>();
            modelFailures.set('GPT-4o', failures1);
            modelFailures.set('Claude-3.5-Sonnet', failures2);

            const metrics = await metricsCalculator.calculateFingerprintingMetrics(modelFailures);

            // Property: Should return fingerprinting metrics for model pairs
            expect(Array.isArray(metrics)).toBe(true);

            for (const metric of metrics) {
              expect(metric).toHaveProperty('modelPair');
              expect(metric).toHaveProperty('jensenShannonDivergence');
              expect(metric).toHaveProperty('rateRatios');
              expect(metric).toHaveProperty('promptSensitivityVariance');

              // Property: Jensen-Shannon divergence must be between 0 and 1
              expect(metric.jensenShannonDivergence).toBeGreaterThanOrEqual(0);
              expect(metric.jensenShannonDivergence).toBeLessThanOrEqual(1);

              // Property: Rate ratios must be non-negative
              for (const ratio of Object.values(metric.rateRatios)) {
                expect(ratio).toBeGreaterThanOrEqual(0);
              }

              // Property: Prompt sensitivity variance must be non-negative
              expect(metric.promptSensitivityVariance).toBeGreaterThanOrEqual(0);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    test('Jensen-Shannon divergence should be symmetric', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(failureDetectionArb, { minLength: 1, maxLength: 20 }),
          fc.array(failureDetectionArb, { minLength: 1, maxLength: 20 }),
          async (failures1: FailureDetection[], failures2: FailureDetection[]) => {
            const modelFailures1 = new Map<string, FailureDetection[]>();
            modelFailures1.set('ModelA', failures1);
            modelFailures1.set('ModelB', failures2);

            const modelFailures2 = new Map<string, FailureDetection[]>();
            modelFailures2.set('ModelB', failures2);
            modelFailures2.set('ModelA', failures1);

            const metrics1 = await metricsCalculator.calculateFingerprintingMetrics(modelFailures1);
            const metrics2 = await metricsCalculator.calculateFingerprintingMetrics(modelFailures2);

            // Property: JSD should be symmetric (order of models shouldn't matter)
            if (metrics1.length > 0 && metrics2.length > 0) {
              const metric1 = metrics1[0];
              const metric2 = metrics2[0];
              if (metric1 && metric2) {
                expect(metric1.jensenShannonDivergence).toBeCloseTo(metric2.jensenShannonDivergence, 5);
              }
            }
          }
        ),
        { numRuns: 30 }
      );
    });

    test('identical distributions should have zero Jensen-Shannon divergence', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(failureDetectionArb, { minLength: 1, maxLength: 20 }),
          async (failures: FailureDetection[]) => {
            const modelFailures = new Map<string, FailureDetection[]>();
            modelFailures.set('Model1', failures);
            modelFailures.set('Model2', [...failures]); // Same failures

            const metrics = await metricsCalculator.calculateFingerprintingMetrics(modelFailures);

            // Property: Identical distributions should have JSD of 0
            if (metrics.length > 0 && metrics[0]) {
              expect(metrics[0].jensenShannonDivergence).toBeCloseTo(0, 5);
            }
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  describe('Comparison Metrics (Requirements 6.3)', () => {
    test('calculateComparisonMetrics should produce valid incremental recall and evasion rates', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(failureWithDetectionMethodArb('compile'), { minLength: 0, maxLength: 30 }),
          fc.array(failureWithDetectionMethodArb('graph-analysis'), { minLength: 0, maxLength: 30 }),
          async (baselineFailures: FailureDetection[], graphFailures: FailureDetection[]) => {
            const result = await metricsCalculator.calculateComparisonMetrics(baselineFailures, graphFailures);

            // Property: Should return comparison metrics object
            expect(result).toHaveProperty('incrementalRecall');
            expect(result).toHaveProperty('evasionRate');

            // Property: Incremental recall should be a valid ratio
            expect(typeof result.incrementalRecall).toBe('number');
            expect(Number.isFinite(result.incrementalRecall)).toBe(true);

            // Property: Evasion rate should be between 0 and 1
            expect(result.evasionRate).toBeGreaterThanOrEqual(0);
            expect(result.evasionRate).toBeLessThanOrEqual(1);
          }
        ),
        { numRuns: 50 }
      );
    });

    test('empty inputs should return zero metrics', async () => {
      const result = await metricsCalculator.calculateComparisonMetrics([], []);

      expect(result.incrementalRecall).toBe(0);
      expect(result.evasionRate).toBe(0);
    });
  });

  describe('Statistical Tests (Requirements 6.4)', () => {
    test('performStatisticalTests should return McNemar, chi-squared, and bootstrap CI', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(failureDetectionArb, { minLength: 0, maxLength: 30 }),
          fc.array(failureDetectionArb, { minLength: 0, maxLength: 30 }),
          async (results1: FailureDetection[], results2: FailureDetection[]) => {
            const stats = await metricsCalculator.performStatisticalTests(results1, results2);

            // Property: Should return all required statistical tests
            expect(stats).toHaveProperty('mcNemarTest');
            expect(stats).toHaveProperty('chiSquaredTest');
            expect(stats).toHaveProperty('bootstrapCI');

            // Property: McNemar test should have statistic and p-value
            expect(stats.mcNemarTest).toHaveProperty('statistic');
            expect(stats.mcNemarTest).toHaveProperty('pValue');
            expect(stats.mcNemarTest.statistic).toBeGreaterThanOrEqual(0);
            expect(stats.mcNemarTest.pValue).toBeGreaterThanOrEqual(0);
            expect(stats.mcNemarTest.pValue).toBeLessThanOrEqual(1);

            // Property: Chi-squared test should have statistic and p-value
            expect(stats.chiSquaredTest).toHaveProperty('statistic');
            expect(stats.chiSquaredTest).toHaveProperty('pValue');
            expect(stats.chiSquaredTest.statistic).toBeGreaterThanOrEqual(0);
            expect(stats.chiSquaredTest.pValue).toBeGreaterThanOrEqual(0);
            expect(stats.chiSquaredTest.pValue).toBeLessThanOrEqual(1);

            // Property: Bootstrap CI should have lower and upper bounds
            expect(stats.bootstrapCI).toHaveProperty('lower');
            expect(stats.bootstrapCI).toHaveProperty('upper');
            expect(stats.bootstrapCI.lower).toBeLessThanOrEqual(stats.bootstrapCI.upper);
          }
        ),
        { numRuns: 20 }
      );
    });

    test('p-values should always be between 0 and 1', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(failureDetectionArb, { minLength: 1, maxLength: 20 }),
          fc.array(failureDetectionArb, { minLength: 1, maxLength: 20 }),
          async (results1: FailureDetection[], results2: FailureDetection[]) => {
            const stats = await metricsCalculator.performStatisticalTests(results1, results2);

            // Property: All p-values must be valid probabilities
            expect(stats.mcNemarTest.pValue).toBeGreaterThanOrEqual(0);
            expect(stats.mcNemarTest.pValue).toBeLessThanOrEqual(1);
            expect(stats.chiSquaredTest.pValue).toBeGreaterThanOrEqual(0);
            expect(stats.chiSquaredTest.pValue).toBeLessThanOrEqual(1);
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  describe('All Metrics Calculation (Requirements 6.5)', () => {
    test('calculateAllMetrics should compute all metric types', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(failureDetectionArb, { minLength: 1, maxLength: 20 }),
          fc.array(failureDetectionArb, { minLength: 1, maxLength: 20 }),
          async (failures1: FailureDetection[], failures2: FailureDetection[]) => {
            const evaluationResults = new Map<string, FailureDetection[]>();
            evaluationResults.set('GPT-4o', failures1);
            evaluationResults.set('Claude-3.5-Sonnet', failures2);

            const allMetrics = await metricsCalculator.calculateAllMetrics(evaluationResults);

            // Property: Should return all metric types
            expect(allMetrics).toHaveProperty('detection');
            expect(allMetrics).toHaveProperty('fingerprinting');
            expect(allMetrics).toHaveProperty('comparison');

            // Property: Detection metrics should be an array
            expect(Array.isArray(allMetrics.detection)).toBe(true);

            // Property: Fingerprinting metrics should be an array
            expect(Array.isArray(allMetrics.fingerprinting)).toBe(true);

            // Property: Comparison metrics should have required fields
            expect(allMetrics.comparison).toHaveProperty('incrementalRecall');
            expect(allMetrics.comparison).toHaveProperty('evasionRate');
          }
        ),
        { numRuns: 30 }
      );
    });

    test('calculateAllMetrics should throw for empty input', async () => {
      const emptyResults = new Map<string, FailureDetection[]>();

      await expect(metricsCalculator.calculateAllMetrics(emptyResults))
        .rejects.toThrow('No evaluation results provided');
    });
  });

  describe('Edge Cases', () => {
    test('detection metrics with perfect prediction should have precision and recall of 1', async () => {
      const failures: FailureDetection[] = [
        {
          id: 'f1',
          generationId: 'g1',
          category: 'import',
          severity: 'error',
          description: 'Missing import',
          location: { file: 'test.ts', line: 1, column: 0 },
          detectedBy: 'graph-analysis'
        },
        {
          id: 'f2',
          generationId: 'g1',
          category: 'import',
          severity: 'error',
          description: 'Missing import 2',
          location: { file: 'test.ts', line: 2, column: 0 },
          detectedBy: 'graph-analysis'
        }
      ];

      const metrics = await metricsCalculator.calculateDetectionMetrics(failures, failures);

      // With identical predicted and actual, we should have perfect scores
      for (const metric of metrics) {
        expect(metric.precision).toBe(1);
        expect(metric.recall).toBe(1);
        expect(metric.f1Score).toBe(1);
        expect(metric.falsePositives).toBe(0);
        expect(metric.falseNegatives).toBe(0);
      }
    });

    test('fingerprinting with single model should return empty metrics', async () => {
      const modelFailures = new Map<string, FailureDetection[]>();
      modelFailures.set('SingleModel', []);

      const metrics = await metricsCalculator.calculateFingerprintingMetrics(modelFailures);

      // Single model has no pairs to compare
      expect(metrics.length).toBe(0);
    });

    test('metrics should handle multiple categories correctly', async () => {
      const predicted: FailureDetection[] = [
        {
          id: 'p1',
          generationId: 'g1',
          category: 'import',
          severity: 'error',
          description: 'Import error',
          location: { file: 'test.ts', line: 1, column: 0 },
          detectedBy: 'graph-analysis'
        },
        {
          id: 'p2',
          generationId: 'g1',
          category: 'call',
          severity: 'warning',
          description: 'Call warning',
          location: { file: 'test.ts', line: 2, column: 0 },
          detectedBy: 'graph-analysis'
        }
      ];

      const actual: FailureDetection[] = [
        {
          id: 'a1',
          generationId: 'g1',
          category: 'import',
          severity: 'error',
          description: 'Import error',
          location: { file: 'test.ts', line: 1, column: 0 },
          detectedBy: 'compile'
        },
        {
          id: 'a2',
          generationId: 'g1',
          category: 'schema',
          severity: 'error',
          description: 'Schema error',
          location: { file: 'test.ts', line: 3, column: 0 },
          detectedBy: 'compile'
        }
      ];

      const metrics = await metricsCalculator.calculateDetectionMetrics(predicted, actual);

      // Should have metrics for all three categories: import, call, schema
      const categories = metrics.map(m => m.category);
      expect(categories).toContain('import');
      expect(categories).toContain('call');
      expect(categories).toContain('schema');
    });
  });
});
