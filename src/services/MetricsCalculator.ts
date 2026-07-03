import { IMetricsCalculator } from '../interfaces/IMetricsCalculator';
import { DetectionMetrics, FingerprintingMetrics, FailureDetection } from '../types';
import { DetectionMetricsModel, FingerprintingMetricsModel } from '../models/Metrics';

export class MetricsCalculator implements IMetricsCalculator {

  /**
   * Calculate detection metrics (precision, recall, F1) per failure category
   */
  async calculateDetectionMetrics(
    predicted: FailureDetection[],
    actual: FailureDetection[]
  ): Promise<DetectionMetrics[]> {
    // Group failures by category
    const categories = new Set([
      ...predicted.map(f => f.category),
      ...actual.map(f => f.category)
    ]);

    const metrics: DetectionMetrics[] = [];

    for (const category of categories) {
      const predictedInCategory = predicted.filter(f => f.category === category);
      const actualInCategory = actual.filter(f => f.category === category);

      // Calculate confusion matrix values
      const truePositives = this.countMatches(predictedInCategory, actualInCategory);
      const falsePositives = predictedInCategory.length - truePositives;
      const falseNegatives = actualInCategory.length - truePositives;

      // Calculate metrics
      const precision = truePositives + falsePositives > 0 
        ? truePositives / (truePositives + falsePositives) 
        : 0;
      
      const recall = truePositives + falseNegatives > 0 
        ? truePositives / (truePositives + falseNegatives) 
        : 0;
      
      const f1Score = precision + recall > 0 
        ? 2 * (precision * recall) / (precision + recall) 
        : 0;

      metrics.push(new DetectionMetricsModel(
        category,
        precision,
        recall,
        f1Score,
        truePositives,
        falsePositives,
        falseNegatives
      ));
    }

    return metrics;
  }

  /**
   * Calculate fingerprinting metrics (Jensen-Shannon divergence, rate ratios)
   */
  async calculateFingerprintingMetrics(
    modelFailures: Map<string, FailureDetection[]>
  ): Promise<FingerprintingMetrics[]> {
    const metrics: FingerprintingMetrics[] = [];
    const models = Array.from(modelFailures.keys());

    // Calculate metrics for each pair of models
    for (let i = 0; i < models.length; i++) {
      for (let j = i + 1; j < models.length; j++) {
        const model1 = models[i]!; // We know this exists since we're iterating
        const model2 = models[j]!; // We know this exists since we're iterating
        const failures1 = modelFailures.get(model1) ?? [];
        const failures2 = modelFailures.get(model2) ?? [];

        // Calculate failure rate distributions by category
        const dist1 = this.calculateFailureDistribution(failures1);
        const dist2 = this.calculateFailureDistribution(failures2);

        // Calculate Jensen-Shannon divergence
        const jsDiv = this.calculateJensenShannonDivergence(dist1, dist2);

        // Calculate rate ratios for each category
        const rateRatios: Record<string, number> = {};
        const allCategories = new Set([...Object.keys(dist1), ...Object.keys(dist2)]);
        
        for (const category of allCategories) {
          const rate1 = dist1[category] || 0;
          const rate2 = dist2[category] || 0;
          rateRatios[category] = rate2 > 0 ? rate1 / rate2 : (rate1 > 0 ? Infinity : 1);
        }

        // Calculate prompt sensitivity variance (variance in failure rates across prompts)
        const promptVariance = this.calculatePromptSensitivityVariance(failures1, failures2);

        metrics.push(new FingerprintingMetricsModel(
          `${model1}-vs-${model2}`,
          jsDiv,
          rateRatios,
          promptVariance
        ));
      }
    }

    return metrics;
  }

  /**
   * Calculate comparison metrics (incremental recall, evasion rates)
   */
  async calculateComparisonMetrics(
    baselineFailures: FailureDetection[],
    graphFailures: FailureDetection[]
  ): Promise<{ incrementalRecall: number; evasionRate: number }> {
    // Incremental recall: additional failures detected by graph analysis
    const baselineMatches = this.countMatches(baselineFailures, graphFailures);
    const additionalFailures = graphFailures.length - baselineMatches;
    const incrementalRecall = baselineFailures.length > 0 
      ? additionalFailures / baselineFailures.length 
      : 0;

    // Evasion rate: failures that baseline methods miss but graph analysis catches
    const totalUniqueFailures = new Set([
      ...baselineFailures.map(f => this.getFailureSignature(f)),
      ...graphFailures.map(f => this.getFailureSignature(f))
    ]).size;
    
    const evasionRate = totalUniqueFailures > 0 
      ? additionalFailures / totalUniqueFailures 
      : 0;

    return { incrementalRecall, evasionRate };
  }

  /**
   * Perform statistical tests (McNemar, chi-squared, bootstrap CI)
   */
  async performStatisticalTests(
    results1: FailureDetection[],
    results2: FailureDetection[]
  ): Promise<{
    mcNemarTest: { statistic: number; pValue: number };
    chiSquaredTest: { statistic: number; pValue: number };
    bootstrapCI: { lower: number; upper: number };
  }> {
    // McNemar's test for paired differences
    const mcNemar = this.calculateMcNemarTest(results1, results2);
    
    // Chi-squared test for distribution independence
    const chiSquared = this.calculateChiSquaredTest(results1, results2);
    
    // Bootstrap confidence interval for difference in detection rates
    const bootstrapCI = await this.calculateBootstrapCI(results1, results2);

    return {
      mcNemarTest: mcNemar,
      chiSquaredTest: chiSquared,
      bootstrapCI: bootstrapCI
    };
  }

  /**
   * Calculate all metrics for evaluation results
   */
  async calculateAllMetrics(
    evaluationResults: Map<string, FailureDetection[]>
  ): Promise<{
    detection: DetectionMetrics[];
    fingerprinting: FingerprintingMetrics[];
    comparison: { incrementalRecall: number; evasionRate: number };
  }> {
    const allFailures = Array.from(evaluationResults.values()).flat();
    
    // For detection metrics, we need ground truth - using first result as baseline
    const resultKeys = Array.from(evaluationResults.keys());
    const baselineKey = resultKeys[0];
    if (!baselineKey) {
      throw new Error('No evaluation results provided');
    }
    const baselineFailures = evaluationResults.get(baselineKey) ?? [];
    
    // Calculate detection metrics against baseline
    const detection = await this.calculateDetectionMetrics(allFailures, baselineFailures);
    
    // Calculate fingerprinting metrics across all models
    const fingerprinting = await this.calculateFingerprintingMetrics(evaluationResults);
    
    // Calculate comparison metrics (baseline vs graph-based methods)
    const baselineMethods = ['compile', 'test', 'sast', 'regex'];
    const graphMethods = ['graph-analysis'];
    
    const baselineResults = allFailures.filter(f => baselineMethods.includes(f.detectedBy));
    const graphResults = allFailures.filter(f => graphMethods.includes(f.detectedBy));
    
    const comparison = await this.calculateComparisonMetrics(baselineResults, graphResults);

    return {
      detection,
      fingerprinting,
      comparison
    };
  }

  /**
   * Count matching failures between two sets based on location and category
   */
  private countMatches(set1: FailureDetection[], set2: FailureDetection[]): number {
    let matches = 0;
    
    for (const failure1 of set1) {
      const signature1 = this.getFailureSignature(failure1);
      for (const failure2 of set2) {
        const signature2 = this.getFailureSignature(failure2);
        if (signature1 === signature2) {
          matches++;
          break; // Count each failure only once
        }
      }
    }
    
    return matches;
  }

  /**
   * Generate a unique signature for a failure based on location and category
   */
  private getFailureSignature(failure: FailureDetection): string {
    return `${failure.category}:${failure.location.file}:${failure.location.line}:${failure.location.column}`;
  }

  /**
   * Calculate failure rate distribution by category
   */
  private calculateFailureDistribution(failures: FailureDetection[]): Record<string, number> {
    const distribution: Record<string, number> = {};
    const total = failures.length;
    
    if (total === 0) return distribution;
    
    // Count failures by category
    const counts: Record<string, number> = {};
    for (const failure of failures) {
      counts[failure.category] = (counts[failure.category] || 0) + 1;
    }
    
    // Convert to rates
    for (const [category, count] of Object.entries(counts)) {
      distribution[category] = count / total;
    }
    
    return distribution;
  }

  /**
   * Calculate Jensen-Shannon divergence between two probability distributions
   */
  private calculateJensenShannonDivergence(
    dist1: Record<string, number>, 
    dist2: Record<string, number>
  ): number {
    const allCategories = new Set([...Object.keys(dist1), ...Object.keys(dist2)]);
    
    if (allCategories.size === 0) return 0;
    
    // Calculate average distribution M = (P + Q) / 2
    const avgDist: Record<string, number> = {};
    for (const category of allCategories) {
      const p = dist1[category] || 0;
      const q = dist2[category] || 0;
      avgDist[category] = (p + q) / 2;
    }
    
    // Calculate KL divergences
    let klDiv1 = 0;
    let klDiv2 = 0;
    
    for (const category of allCategories) {
      const p = dist1[category] || 0;
      const q = dist2[category] || 0;
      const m = avgDist[category] || 0;
      
      if (p > 0 && m > 0) {
        klDiv1 += p * Math.log2(p / m);
      }
      if (q > 0 && m > 0) {
        klDiv2 += q * Math.log2(q / m);
      }
    }
    
    // Jensen-Shannon divergence
    return (klDiv1 + klDiv2) / 2;
  }

  /**
   * Calculate prompt sensitivity variance
   */
  private calculatePromptSensitivityVariance(
    failures1: FailureDetection[], 
    failures2: FailureDetection[]
  ): number {
    // Group failures by prompt strategy if available (simplified implementation)
    const rates1 = this.calculateFailureDistribution(failures1);
    const rates2 = this.calculateFailureDistribution(failures2);
    
    const allCategories = new Set([...Object.keys(rates1), ...Object.keys(rates2)]);
    const differences: number[] = [];
    
    for (const category of allCategories) {
      const rate1 = rates1[category] || 0;
      const rate2 = rates2[category] || 0;
      differences.push(Math.abs(rate1 - rate2));
    }
    
    if (differences.length === 0) return 0;
    
    // Calculate variance of differences
    const mean = differences.reduce((sum, diff) => sum + diff, 0) / differences.length;
    const variance = differences.reduce((sum, diff) => sum + Math.pow(diff - mean, 2), 0) / differences.length;
    
    return variance;
  }

  /**
   * Calculate McNemar's test for paired differences
   */
  private calculateMcNemarTest(
    results1: FailureDetection[], 
    results2: FailureDetection[]
  ): { statistic: number; pValue: number } {
    // Create contingency table for McNemar's test
    let bothDetected = 0;
    let onlyFirst = 0;
    let onlySecond = 0;
    let neitherDetected = 0;
    
    const signatures1 = new Set(results1.map(f => this.getFailureSignature(f)));
    const signatures2 = new Set(results2.map(f => this.getFailureSignature(f)));
    const allSignatures = new Set([...signatures1, ...signatures2]);
    
    for (const signature of allSignatures) {
      const in1 = signatures1.has(signature);
      const in2 = signatures2.has(signature);
      
      if (in1 && in2) bothDetected++;
      else if (in1 && !in2) onlyFirst++;
      else if (!in1 && in2) onlySecond++;
      else neitherDetected++;
    }
    
    // McNemar's test statistic
    const statistic = onlyFirst + onlySecond > 0 
      ? Math.pow(Math.abs(onlyFirst - onlySecond) - 1, 2) / (onlyFirst + onlySecond)
      : 0;
    
    // Approximate p-value using chi-squared distribution (df=1)
    const pValue = this.chiSquaredPValue(statistic, 1);
    
    return { statistic, pValue };
  }

  /**
   * Calculate chi-squared test for distribution independence
   */
  private calculateChiSquaredTest(
    results1: FailureDetection[], 
    results2: FailureDetection[]
  ): { statistic: number; pValue: number } {
    // Create contingency table by category
    const categories = new Set([
      ...results1.map(f => f.category),
      ...results2.map(f => f.category)
    ]);
    
    const observed: number[][] = [];
    const categoryList = Array.from(categories);
    
    // Count observed frequencies
    for (let i = 0; i < categoryList.length; i++) {
      const category = categoryList[i];
      const count1 = results1.filter(f => f.category === category).length;
      const count2 = results2.filter(f => f.category === category).length;
      observed.push([count1, count2]);
    }
    
    if (observed.length === 0) return { statistic: 0, pValue: 1 };
    
    // Calculate expected frequencies
    const total1 = results1.length;
    const total2 = results2.length;
    const grandTotal = total1 + total2;
    
    if (grandTotal === 0) return { statistic: 0, pValue: 1 };
    
    let chiSquared = 0;
    
    for (let i = 0; i < observed.length; i++) {
      const row = observed[i];
      if (!row || row.length < 2) continue;
      
      const val0 = row[0];
      const val1 = row[1];
      if (val0 === undefined || val1 === undefined) continue;
      
      const rowTotal = val0 + val1;
      const expected1 = (rowTotal * total1) / grandTotal;
      const expected2 = (rowTotal * total2) / grandTotal;
      
      if (expected1 > 0) {
        chiSquared += Math.pow(val0 - expected1, 2) / expected1;
      }
      if (expected2 > 0) {
        chiSquared += Math.pow(val1 - expected2, 2) / expected2;
      }
    }
    
    const degreesOfFreedom = Math.max(1, categoryList.length - 1);
    const pValue = this.chiSquaredPValue(chiSquared, degreesOfFreedom);
    
    return { statistic: chiSquared, pValue };
  }

  /**
   * Calculate bootstrap confidence interval
   */
  private async calculateBootstrapCI(
    results1: FailureDetection[], 
    results2: FailureDetection[],
    numBootstraps: number = 1000,
    confidenceLevel: number = 0.95
  ): Promise<{ lower: number; upper: number }> {
    const bootstrapDifferences: number[] = [];
    
    for (let i = 0; i < numBootstraps; i++) {
      // Bootstrap sample from each result set
      const sample1 = this.bootstrapSample(results1);
      const sample2 = this.bootstrapSample(results2);
      
      // Calculate detection rates
      const rate1 = sample1.length;
      const rate2 = sample2.length;
      const difference = rate1 - rate2;
      
      bootstrapDifferences.push(difference);
    }
    
    // Sort differences and calculate confidence interval
    bootstrapDifferences.sort((a, b) => a - b);
    
    const alpha = 1 - confidenceLevel;
    const lowerIndex = Math.floor(alpha / 2 * numBootstraps);
    const upperIndex = Math.floor((1 - alpha / 2) * numBootstraps);
    
    return {
      lower: bootstrapDifferences[lowerIndex] || 0,
      upper: bootstrapDifferences[upperIndex] || 0
    };
  }

  /**
   * Create a bootstrap sample from the given array
   */
  private bootstrapSample<T>(array: T[]): T[] {
    const sample: T[] = [];
    for (let i = 0; i < array.length; i++) {
      const randomIndex = Math.floor(Math.random() * array.length);
      const item = array[randomIndex];
      if (item !== undefined) {
        sample.push(item);
      }
    }
    return sample;
  }

  /**
   * Approximate p-value for chi-squared distribution
   */
  private chiSquaredPValue(statistic: number, degreesOfFreedom: number): number {
    // Simplified approximation - in production, use a proper statistical library
    if (statistic <= 0) return 1;
    if (degreesOfFreedom === 1) {
      // For df=1, use normal approximation
      const z = Math.sqrt(statistic);
      return 2 * (1 - this.normalCDF(z));
    }
    
    // Very rough approximation for other degrees of freedom
    // In practice, use a proper chi-squared CDF implementation
    const criticalValues = [3.841, 5.991, 7.815, 9.488, 11.070]; // p=0.05 for df 1-5
    const criticalValue = criticalValues[Math.min(degreesOfFreedom - 1, 4)] || 11.070;
    
    return statistic > criticalValue ? 0.01 : 0.1; // Very rough approximation
  }

  /**
   * Standard normal cumulative distribution function approximation
   */
  private normalCDF(x: number): number {
    // Abramowitz and Stegun approximation
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-x * x / 2);
    const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    
    return x > 0 ? 1 - prob : prob;
  }
}