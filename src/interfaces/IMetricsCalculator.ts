import { DetectionMetrics, FingerprintingMetrics, FailureDetection } from '../types';

export interface IMetricsCalculator {
  /**
   * Calculate detection metrics (precision, recall, F1) per failure category
   */
  calculateDetectionMetrics(
    predicted: FailureDetection[],
    actual: FailureDetection[]
  ): Promise<DetectionMetrics[]>;

  /**
   * Calculate fingerprinting metrics (Jensen-Shannon divergence, rate ratios)
   */
  calculateFingerprintingMetrics(
    modelFailures: Map<string, FailureDetection[]>
  ): Promise<FingerprintingMetrics[]>;

  /**
   * Calculate comparison metrics (incremental recall, evasion rates)
   */
  calculateComparisonMetrics(
    baselineFailures: FailureDetection[],
    graphFailures: FailureDetection[]
  ): Promise<{ incrementalRecall: number; evasionRate: number }>;

  /**
   * Perform statistical tests (McNemar, chi-squared, bootstrap CI)
   */
  performStatisticalTests(
    results1: FailureDetection[],
    results2: FailureDetection[]
  ): Promise<{
    mcNemarTest: { statistic: number; pValue: number };
    chiSquaredTest: { statistic: number; pValue: number };
    bootstrapCI: { lower: number; upper: number };
  }>;

  /**
   * Calculate all metrics for evaluation results
   */
  calculateAllMetrics(
    evaluationResults: Map<string, FailureDetection[]>
  ): Promise<{
    detection: DetectionMetrics[];
    fingerprinting: FingerprintingMetrics[];
    comparison: { incrementalRecall: number; evasionRate: number };
  }>;
}