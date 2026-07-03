import { EvaluationResult } from '../interfaces/IEvaluationPipeline';
import { DetectionMetrics, FingerprintingMetrics, FailureDetection, Generation } from '../types';
import * as fs from 'fs/promises';

/**
 * Summary statistics for evaluation results
 */
export interface EvaluationSummary {
  totalRepositories: number;
  totalTasks: number;
  totalGenerations: number;
  totalFailures: number;
  failuresByCategory: Record<string, number>;
  failuresBySeverity: Record<string, number>;
  failuresByDetectionMethod: Record<string, number>;
  modelPerformance: Record<string, ModelPerformanceSummary>;
  promptStrategyPerformance: Record<string, PromptStrategyPerformanceSummary>;
  averageMetrics: AverageMetrics;
}

/**
 * Performance summary per model
 */
export interface ModelPerformanceSummary {
  generationCount: number;
  totalFailures: number;
  averageFailuresPerGeneration: number;
  failuresByCategory: Record<string, number>;
}

/**
 * Performance summary per prompting strategy
 */
export interface PromptStrategyPerformanceSummary {
  generationCount: number;
  totalFailures: number;
  averageFailuresPerGeneration: number;
  averageContextFiles: number;
}

/**
 * Average metrics across all evaluations
 */
export interface AverageMetrics {
  precision: number;
  recall: number;
  f1Score: number;
}

/**
 * Per-graph-type node/edge statistics
 */
export interface GraphStats {
  [graphType: string]: { nodes: number; edges: number };
}

/**
 * Full evaluation report
 */
export interface EvaluationReport {
  generatedAt: string;
  pipelineVersion: string;
  graphStats: GraphStats;
  summary: EvaluationSummary;
  detectionMetrics: DetectionMetrics[];
  fingerprintingMetrics: FingerprintingMetrics[];
  results: EvaluationResult[];
}

/**
 * ResultSerializer handles serialization, aggregation, and reporting of evaluation results
 */
export class ResultSerializer {
  /**
   * Serialize evaluation results to JSON
   */
  serializeResults(results: EvaluationResult[]): string {
    return JSON.stringify(results, null, 2);
  }

  /**
   * Deserialize evaluation results from JSON
   */
  deserializeResults(json: string): EvaluationResult[] {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) {
      throw new Error('Invalid JSON: expected array of EvaluationResult');
    }
    return parsed.map(this.validateEvaluationResult);
  }

  /**
   * Validate a single evaluation result
   */
  private validateEvaluationResult(data: unknown): EvaluationResult {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid EvaluationResult: expected object');
    }

    const result = data as Record<string, unknown>;

    if (typeof result['taskId'] !== 'string') {
      throw new Error('Invalid EvaluationResult: taskId must be a string');
    }

    if (!Array.isArray(result['generations'])) {
      throw new Error('Invalid EvaluationResult: generations must be an array');
    }

    if (!Array.isArray(result['graphs'])) {
      throw new Error('Invalid EvaluationResult: graphs must be an array');
    }

    if (!Array.isArray(result['failures'])) {
      throw new Error('Invalid EvaluationResult: failures must be an array');
    }

    if (!Array.isArray(result['metrics'])) {
      throw new Error('Invalid EvaluationResult: metrics must be an array');
    }

    return {
      taskId: result['taskId'] as string,
      generations: result['generations'] as Generation[],
      graphs: result['graphs'] as EvaluationResult['graphs'],
      failures: result['failures'] as FailureDetection[],
      metrics: result['metrics'] as DetectionMetrics[]
    };
  }

  /**
   * Calculate summary statistics from evaluation results
   */
  calculateSummary(results: EvaluationResult[]): EvaluationSummary {
    const allGenerations = results.flatMap(r => r.generations);
    const allFailures = results.flatMap(r => r.failures);
    const allMetrics = results.flatMap(r => r.metrics);

    // Count unique repositories
    const uniqueRepositoryIds = new Set<string>();
    for (const result of results) {
      for (const gen of result.generations) {
        // Extract repository ID from task ID (assuming format task-repoId-...)
        uniqueRepositoryIds.add(gen.taskId.split('-')[0] || gen.taskId);
      }
    }

    // Calculate failures by category
    const failuresByCategory: Record<string, number> = {};
    for (const failure of allFailures) {
      failuresByCategory[failure.category] = (failuresByCategory[failure.category] || 0) + 1;
    }

    // Calculate failures by severity
    const failuresBySeverity: Record<string, number> = {};
    for (const failure of allFailures) {
      failuresBySeverity[failure.severity] = (failuresBySeverity[failure.severity] || 0) + 1;
    }

    // Calculate failures by detection method
    const failuresByDetectionMethod: Record<string, number> = {};
    for (const failure of allFailures) {
      failuresByDetectionMethod[failure.detectedBy] = (failuresByDetectionMethod[failure.detectedBy] || 0) + 1;
    }

    // Calculate model performance
    const modelPerformance = this.calculateModelPerformance(allGenerations, allFailures);

    // Calculate prompt strategy performance
    const promptStrategyPerformance = this.calculatePromptStrategyPerformance(allGenerations, allFailures);

    // Calculate average metrics
    const averageMetrics = this.calculateAverageMetrics(allMetrics);

    return {
      totalRepositories: uniqueRepositoryIds.size,
      totalTasks: results.length,
      totalGenerations: allGenerations.length,
      totalFailures: allFailures.length,
      failuresByCategory,
      failuresBySeverity,
      failuresByDetectionMethod,
      modelPerformance,
      promptStrategyPerformance,
      averageMetrics
    };
  }

  /**
   * Calculate model performance summary
   */
  private calculateModelPerformance(
    generations: Generation[],
    failures: FailureDetection[]
  ): Record<string, ModelPerformanceSummary> {
    const performance: Record<string, ModelPerformanceSummary> = {};
    const models = ['GPT-4o', 'Claude-3.5-Sonnet'];

    for (const model of models) {
      const modelGenerations = generations.filter(g => g.model === model);
      const generationIds = new Set(modelGenerations.map(g => g.id));
      const modelFailures = failures.filter(f => generationIds.has(f.generationId));

      const failuresByCategory: Record<string, number> = {};
      for (const failure of modelFailures) {
        failuresByCategory[failure.category] = (failuresByCategory[failure.category] || 0) + 1;
      }

      performance[model] = {
        generationCount: modelGenerations.length,
        totalFailures: modelFailures.length,
        averageFailuresPerGeneration: modelGenerations.length > 0
          ? modelFailures.length / modelGenerations.length
          : 0,
        failuresByCategory
      };
    }

    return performance;
  }

  /**
   * Calculate prompt strategy performance summary
   */
  private calculatePromptStrategyPerformance(
    generations: Generation[],
    failures: FailureDetection[]
  ): Record<string, PromptStrategyPerformanceSummary> {
    const performance: Record<string, PromptStrategyPerformanceSummary> = {};
    const strategies = ['P1', 'P2', 'P3', 'P4'];

    for (const strategy of strategies) {
      const strategyGenerations = generations.filter(g => g.promptStrategy === strategy);
      const generationIds = new Set(strategyGenerations.map(g => g.id));
      const strategyFailures = failures.filter(f => generationIds.has(f.generationId));

      const totalContextFiles = strategyGenerations.reduce(
        (sum, g) => sum + g.contextFiles.length,
        0
      );

      performance[strategy] = {
        generationCount: strategyGenerations.length,
        totalFailures: strategyFailures.length,
        averageFailuresPerGeneration: strategyGenerations.length > 0
          ? strategyFailures.length / strategyGenerations.length
          : 0,
        averageContextFiles: strategyGenerations.length > 0
          ? totalContextFiles / strategyGenerations.length
          : 0
      };
    }

    return performance;
  }

  /**
   * Calculate average metrics across all evaluations
   */
  private calculateAverageMetrics(metrics: DetectionMetrics[]): AverageMetrics {
    if (metrics.length === 0) {
      return { precision: 0, recall: 0, f1Score: 0 };
    }

    const totalPrecision = metrics.reduce((sum, m) => sum + m.precision, 0);
    const totalRecall = metrics.reduce((sum, m) => sum + m.recall, 0);
    const totalF1 = metrics.reduce((sum, m) => sum + m.f1Score, 0);

    return {
      precision: totalPrecision / metrics.length,
      recall: totalRecall / metrics.length,
      f1Score: totalF1 / metrics.length
    };
  }

  /**
   * Generate a full evaluation report
   */
  generateReport(
    results: EvaluationResult[],
    detectionMetrics?: DetectionMetrics[],
    fingerprintingMetrics?: FingerprintingMetrics[]
  ): EvaluationReport {
    return {
      generatedAt: new Date().toISOString(),
      pipelineVersion: '2.0.0',
      graphStats: this.calculateGraphStats(results),
      summary: this.calculateSummary(results),
      detectionMetrics: detectionMetrics || results.flatMap(r => r.metrics),
      fingerprintingMetrics: fingerprintingMetrics || [],
      results
    };
  }

  /**
   * Calculate node/edge statistics per graph type
   */
  calculateGraphStats(results: EvaluationResult[]): GraphStats {
    const allGraphs = results.flatMap(r => r.graphs);
    const stats: GraphStats = {};

    for (const graph of allGraphs) {
      const nodeCount = (graph.nodes ?? []).length;
      const edgeCount = (graph.edges ?? []).length;
      const existing = stats[graph.type];
      if (existing) {
        existing.nodes += nodeCount;
        existing.edges += edgeCount;
      } else {
        stats[graph.type] = { nodes: nodeCount, edges: edgeCount };
      }
    }

    return stats;
  }

  /**
   * Export results to JSON file
   */
  async exportToJSON(results: EvaluationResult[], outputPath: string): Promise<void> {
    const json = this.serializeResults(results);
    await fs.writeFile(outputPath, json, 'utf-8');
  }

  /**
   * Export full report to JSON file
   */
  async exportReportToJSON(report: EvaluationReport, outputPath: string): Promise<void> {
    const json = JSON.stringify(report, null, 2);
    await fs.writeFile(outputPath, json, 'utf-8');
  }

  /**
   * Export summary to JSON file
   */
  async exportSummaryToJSON(summary: EvaluationSummary, outputPath: string): Promise<void> {
    const json = JSON.stringify(summary, null, 2);
    await fs.writeFile(outputPath, json, 'utf-8');
  }

  /**
   * Import results from JSON file
   */
  async importFromJSON(inputPath: string): Promise<EvaluationResult[]> {
    const json = await fs.readFile(inputPath, 'utf-8');
    return this.deserializeResults(json);
  }

  /**
   * Generate a CSV export of failures for analysis
   */
  generateFailuresCSV(results: EvaluationResult[]): string {
    const allFailures = results.flatMap(r =>
      r.failures.map(f => ({
        taskId: r.taskId,
        ...f
      }))
    );

    if (allFailures.length === 0) {
      return 'taskId,id,generationId,category,severity,description,file,line,column,detectedBy\n';
    }

    const headers = [
      'taskId',
      'id',
      'generationId',
      'category',
      'severity',
      'description',
      'file',
      'line',
      'column',
      'detectedBy'
    ];

    const rows = allFailures.map(f => [
      f.taskId,
      f.id,
      f.generationId,
      f.category,
      f.severity,
      `"${f.description.replace(/"/g, '""')}"`,
      f.location.file,
      f.location.line.toString(),
      f.location.column.toString(),
      f.detectedBy
    ].join(','));

    return [headers.join(','), ...rows].join('\n');
  }

  /**
   * Export failures to CSV file
   */
  async exportFailuresToCSV(results: EvaluationResult[], outputPath: string): Promise<void> {
    const csv = this.generateFailuresCSV(results);
    await fs.writeFile(outputPath, csv, 'utf-8');
  }

  /**
   * Generate a metrics summary CSV
   */
  generateMetricsCSV(metrics: DetectionMetrics[]): string {
    if (metrics.length === 0) {
      return 'category,precision,recall,f1Score,truePositives,falsePositives,falseNegatives\n';
    }

    const headers = [
      'category',
      'precision',
      'recall',
      'f1Score',
      'truePositives',
      'falsePositives',
      'falseNegatives'
    ];

    const rows = metrics.map(m => [
      m.category,
      m.precision.toFixed(4),
      m.recall.toFixed(4),
      m.f1Score.toFixed(4),
      m.truePositives.toString(),
      m.falsePositives.toString(),
      m.falseNegatives.toString()
    ].join(','));

    return [headers.join(','), ...rows].join('\n');
  }

  /**
   * Export metrics to CSV file
   */
  async exportMetricsToCSV(metrics: DetectionMetrics[], outputPath: string): Promise<void> {
    const csv = this.generateMetricsCSV(metrics);
    await fs.writeFile(outputPath, csv, 'utf-8');
  }

  /**
   * Aggregate results by model
   */
  aggregateByModel(results: EvaluationResult[]): Map<string, EvaluationResult[]> {
    const byModel = new Map<string, EvaluationResult[]>();

    for (const result of results) {
      for (const generation of result.generations) {
        const model = generation.model;
        if (!byModel.has(model)) {
          byModel.set(model, []);
        }

        // Create a filtered result for this model
        const modelResults = byModel.get(model)!;
        const existingResult = modelResults.find(r => r.taskId === result.taskId);

        if (existingResult) {
          existingResult.generations.push(generation);
        } else {
          modelResults.push({
            taskId: result.taskId,
            generations: [generation],
            graphs: result.graphs.filter(g => g.generationId === generation.id),
            failures: result.failures.filter(f => f.generationId === generation.id),
            metrics: result.metrics
          });
        }
      }
    }

    return byModel;
  }

  /**
   * Aggregate results by prompt strategy
   */
  aggregateByPromptStrategy(results: EvaluationResult[]): Map<string, EvaluationResult[]> {
    const byStrategy = new Map<string, EvaluationResult[]>();

    for (const result of results) {
      for (const generation of result.generations) {
        const strategy = generation.promptStrategy;
        if (!byStrategy.has(strategy)) {
          byStrategy.set(strategy, []);
        }

        const strategyResults = byStrategy.get(strategy)!;
        const existingResult = strategyResults.find(r => r.taskId === result.taskId);

        if (existingResult) {
          existingResult.generations.push(generation);
        } else {
          strategyResults.push({
            taskId: result.taskId,
            generations: [generation],
            graphs: result.graphs.filter(g => g.generationId === generation.id),
            failures: result.failures.filter(f => f.generationId === generation.id),
            metrics: result.metrics
          });
        }
      }
    }

    return byStrategy;
  }

  /**
   * Compare results between two models
   */
  compareModels(
    results: EvaluationResult[],
    model1: string,
    model2: string
  ): {
    model1Stats: ModelPerformanceSummary;
    model2Stats: ModelPerformanceSummary;
    difference: {
      failuresDiff: number;
      avgFailuresDiff: number;
    };
  } {
    const allGenerations = results.flatMap(r => r.generations);
    const allFailures = results.flatMap(r => r.failures);

    const modelPerformance = this.calculateModelPerformance(allGenerations, allFailures);

    const model1Stats = modelPerformance[model1] || {
      generationCount: 0,
      totalFailures: 0,
      averageFailuresPerGeneration: 0,
      failuresByCategory: {}
    };

    const model2Stats = modelPerformance[model2] || {
      generationCount: 0,
      totalFailures: 0,
      averageFailuresPerGeneration: 0,
      failuresByCategory: {}
    };

    return {
      model1Stats,
      model2Stats,
      difference: {
        failuresDiff: model1Stats.totalFailures - model2Stats.totalFailures,
        avgFailuresDiff: model1Stats.averageFailuresPerGeneration - model2Stats.averageFailuresPerGeneration
      }
    };
  }
}
