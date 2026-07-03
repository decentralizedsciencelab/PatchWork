import { IEvaluationPipeline, EvaluationConfig, EvaluationResult } from '../interfaces/IEvaluationPipeline';
import { Repository, Task, Generation, Graph, FailureDetection, DetectionMetrics } from '../types';
import { RepositoryManager } from './RepositoryManager';
import { TaskGenerator } from './TaskGenerator';
import { ModelEvaluator } from './ModelEvaluator';
import { GraphConstructor } from './GraphConstructor';
import { FailureDetector } from './FailureDetector';
import { BaselineChecker } from './BaselineChecker';
import { MetricsCalculator } from './MetricsCalculator';
import * as fs from 'fs/promises';

export class EvaluationPipeline implements IEvaluationPipeline {
  private config: EvaluationConfig;
  private repositoryManager: RepositoryManager;
  private taskGenerator: TaskGenerator;
  private modelEvaluator: ModelEvaluator;
  private graphConstructor: GraphConstructor;
  private failureDetector: FailureDetector;
  private baselineChecker: BaselineChecker;
  private metricsCalculator: MetricsCalculator;

  // Progress tracking
  private progress: {
    completed: number;
    total: number;
    currentBatch: number;
    errors: number;
  };

  // Error tracking for retries
  private errorLog: Array<{ taskId: string; error: string; timestamp: Date }>;

  constructor(
    openaiApiKey?: string,
    anthropicApiKey?: string
  ) {
    // Default configuration
    this.config = {
      models: ['GPT-4o', 'Claude-3.5-Sonnet'],
      promptStrategies: ['P1', 'P2', 'P3', 'P4'],
      batchSize: 10,
      maxRetries: 3,
      parallelWorkers: 1
    };

    // Initialize all components
    this.repositoryManager = new RepositoryManager();
    this.taskGenerator = new TaskGenerator();
    this.modelEvaluator = new ModelEvaluator(openaiApiKey, anthropicApiKey);
    this.graphConstructor = new GraphConstructor();
    this.failureDetector = new FailureDetector();
    this.baselineChecker = new BaselineChecker();
    this.metricsCalculator = new MetricsCalculator();

    // Initialize progress tracking
    this.progress = {
      completed: 0,
      total: 0,
      currentBatch: 0,
      errors: 0
    };

    this.errorLog = [];
  }

  /**
   * Configure the evaluation pipeline
   */
  configure(config: EvaluationConfig): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Run the complete evaluation pipeline
   * Orchestrates the full workflow: repositories -> tasks -> generations -> graphs -> failures -> metrics
   */
  async runEvaluation(repositories: Repository[]): Promise<EvaluationResult[]> {
    const allResults: EvaluationResult[] = [];

    // Calculate total expected generations
    // Formula: repos * (3 L1 + 2 L2 + 1 L3) * models * promptStrategies
    const tasksPerRepo = 6; // 3 L1 + 2 L2 + 1 L3
    const generationsPerTask = this.config.models.length * this.config.promptStrategies.length;
    this.progress.total = repositories.length * tasksPerRepo * generationsPerTask;
    this.progress.completed = 0;
    this.progress.currentBatch = 0;
    this.progress.errors = 0;

    // Process repositories
    for (const repository of repositories) {
      // Generate tasks for repository
      const tasks = await this.generateTasksForRepository(repository);

      // Process tasks in batches
      const batches = this.createBatches(tasks, this.config.batchSize);

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        this.progress.currentBatch = batchIndex + 1;
        const batch = batches[batchIndex];
        if (!batch) continue;

        // Process batch with parallel workers
        const batchResults = await this.processBatch(batch);
        allResults.push(...batchResults);
      }
    }

    return allResults;
  }

  /**
   * Process a batch of tasks with parallel processing
   */
  async processBatch(tasks: Task[]): Promise<EvaluationResult[]> {
    const results: EvaluationResult[] = [];

    // Create task processing promises for parallel execution
    const taskPromises = tasks.map(task => this.processTaskWithRetry(task));

    // Process with limited parallelism
    const chunks = this.createBatches(taskPromises, this.config.parallelWorkers);

    for (const chunk of chunks) {
      if (!chunk) continue;
      const chunkResults = await Promise.allSettled(chunk);

      for (const result of chunkResults) {
        if (result.status === 'fulfilled' && result.value) {
          results.push(result.value);
        } else if (result.status === 'rejected') {
          this.progress.errors++;
        }
      }
    }

    return results;
  }

  /**
   * Process a single task with retry mechanism
   */
  private async processTaskWithRetry(task: Task): Promise<EvaluationResult> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await this.processTask(task);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.errorLog.push({
          taskId: task.id,
          error: lastError.message,
          timestamp: new Date()
        });

        // Wait before retry with exponential backoff
        if (attempt < this.config.maxRetries) {
          await this.delay(Math.pow(2, attempt) * 1000);
        }
      }
    }

    // All retries exhausted
    throw lastError || new Error(`Failed to process task ${task.id} after ${this.config.maxRetries} attempts`);
  }

  /**
   * Process a single task through the full pipeline
   */
  private async processTask(task: Task): Promise<EvaluationResult> {
    const generations: Generation[] = [];
    const allGraphs: Graph[] = [];
    const allFailures: FailureDetection[] = [];

    // Generate code for each model and prompting strategy combination
    for (const model of this.config.models) {
      for (const promptStrategy of this.config.promptStrategies) {
        // Step 1: Generate code using the model
        const generation = await this.modelEvaluator.generateWithPrompt(
          task,
          model,
          promptStrategy
        );
        generations.push(generation);

        // Step 2: Construct graphs from generated code
        const graphs = await this.graphConstructor.buildAllGraphs(generation);
        allGraphs.push(...graphs);

        // Step 3: Detect failures using graph analysis
        const graphFailures = await this.failureDetector.detectAllFailures(generation, graphs);

        // Step 4: Run baseline checks
        const baselineFailures = await this.runBaselineChecks(generation);

        // Step 5: Combine and deduplicate failures
        const combinedFailures = this.combineAndDeduplicateFailures(graphFailures, baselineFailures);
        allFailures.push(...combinedFailures);

        // Update progress
        this.progress.completed++;
      }
    }

    // Step 5: Calculate detection metrics
    const metrics = await this.calculateMetricsForTask(allFailures);

    return {
      taskId: task.id,
      generations,
      graphs: allGraphs,
      failures: allFailures,
      metrics
    };
  }

  /**
   * Run baseline analysis tools on generated code
   */
  private async runBaselineChecks(generation: Generation): Promise<FailureDetection[]> {
    const failures: FailureDetection[] = [];

    try {
      // Run compile checks (mypy/tsc)
      const compileResults = await this.baselineChecker.runCompileCheck(generation);
      failures.push(...compileResults);
    } catch {
      // Continue if compile check fails
    }

    try {
      // Run SAST analysis
      const sastResults = await this.baselineChecker.runSASTAnalysis(generation);
      failures.push(...sastResults);
    } catch {
      // Continue if SAST fails
    }

    try {
      // Run regex heuristics
      const regexResults = await this.baselineChecker.runRegexHeuristics(generation);
      failures.push(...regexResults);
    } catch {
      // Continue if regex check fails
    }

    return failures;
  }

  /**
   * Combine and deduplicate failures from graph analysis and baseline checks
   * Keeps both detections but marks duplicates for proper metrics calculation
   */
  private combineAndDeduplicateFailures(
    graphFailures: FailureDetection[],
    baselineFailures: FailureDetection[]
  ): FailureDetection[] {
    const combined: FailureDetection[] = [];
    const seen = new Map<string, FailureDetection>();

    // Helper to create a signature for deduplication
    const getSignature = (f: FailureDetection): string => {
      return `${f.generationId}:${f.category}:${f.location.file}:${f.location.line}`;
    };

    // Add all graph failures first (prioritize graph-based detection)
    for (const failure of graphFailures) {
      const sig = getSignature(failure);
      if (!seen.has(sig)) {
        seen.set(sig, failure);
        combined.push(failure);
      }
    }

    // Add baseline failures if not already detected by graph
    for (const failure of baselineFailures) {
      const sig = getSignature(failure);
      if (!seen.has(sig)) {
        seen.set(sig, failure);
        combined.push(failure);
      }
      // If already detected by graph, skip (graph detection takes priority)
    }

    return combined;
  }

  /**
   * Calculate detection metrics for a task's failures
   */
  private async calculateMetricsForTask(failures: FailureDetection[]): Promise<DetectionMetrics[]> {
    // Separate graph-based and baseline failures
    const graphFailures = failures.filter(f => f.detectedBy === 'graph-analysis');
    const baselineFailures = failures.filter(f => f.detectedBy !== 'graph-analysis');

    // Calculate metrics comparing graph analysis to baseline methods
    return this.metricsCalculator.calculateDetectionMetrics(graphFailures, baselineFailures);
  }

  /**
   * Get evaluation progress
   */
  getProgress(): {
    completed: number;
    total: number;
    currentBatch: number;
    errors: number;
  } {
    return { ...this.progress };
  }

  /**
   * Export results to JSON file
   */
  async exportResults(results: EvaluationResult[], outputPath: string): Promise<void> {
    const exportData = {
      timestamp: new Date().toISOString(),
      config: this.config,
      progress: this.progress,
      errorLog: this.errorLog,
      results: results.map(result => ({
        taskId: result.taskId,
        generationCount: result.generations.length,
        graphCount: result.graphs.length,
        failureCount: result.failures.length,
        generations: result.generations.map(g => ({
          id: g.id,
          model: g.model,
          promptStrategy: g.promptStrategy,
          contextFileCount: g.contextFiles.length,
          timestamp: g.timestamp
        })),
        failures: result.failures,
        metrics: result.metrics
      }))
    };

    await fs.writeFile(outputPath, JSON.stringify(exportData, null, 2), 'utf-8');
  }

  /**
   * Generate all tasks for a repository (L1, L2, L3)
   */
  private async generateTasksForRepository(repository: Repository): Promise<Task[]> {
    const tasks: Task[] = [];

    // Generate L1 tasks (3 per repository)
    const l1Tasks = await this.taskGenerator.generateL1Tasks(repository);
    tasks.push(...l1Tasks);

    // Generate L2 tasks (2 per repository)
    const l2Tasks = await this.taskGenerator.generateL2Tasks(repository);
    tasks.push(...l2Tasks);

    // Generate L3 tasks (1 per repository)
    const l3Tasks = await this.taskGenerator.generateL3Tasks(repository);
    tasks.push(...l3Tasks);

    return tasks;
  }

  /**
   * Create batches from an array
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Delay utility for retry backoff
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get error log for debugging
   */
  getErrorLog(): Array<{ taskId: string; error: string; timestamp: Date }> {
    return [...this.errorLog];
  }

  /**
   * Get repository manager for direct repository operations
   */
  getRepositoryManager(): RepositoryManager {
    return this.repositoryManager;
  }

  /**
   * Reset pipeline state for a new evaluation run
   */
  reset(): void {
    this.progress = {
      completed: 0,
      total: 0,
      currentBatch: 0,
      errors: 0
    };
    this.errorLog = [];
  }
}
