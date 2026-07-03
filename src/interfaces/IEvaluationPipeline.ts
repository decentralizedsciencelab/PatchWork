import { Repository, Task, Generation, Graph, FailureDetection, DetectionMetrics } from '../types';

export interface EvaluationConfig {
  models: ('GPT-4o' | 'Claude-3.5-Sonnet')[];
  promptStrategies: ('P1' | 'P2' | 'P3' | 'P4')[];
  batchSize: number;
  maxRetries: number;
  parallelWorkers: number;
}

export interface EvaluationResult {
  taskId: string;
  generations: Generation[];
  graphs: Graph[];
  failures: FailureDetection[];
  metrics: DetectionMetrics[];
}

export interface IEvaluationPipeline {
  /**
   * Configure the evaluation pipeline
   */
  configure(config: EvaluationConfig): void;

  /**
   * Run the complete evaluation pipeline
   */
  runEvaluation(repositories: Repository[]): Promise<EvaluationResult[]>;

  /**
   * Process a batch of tasks
   */
  processBatch(tasks: Task[]): Promise<EvaluationResult[]>;

  /**
   * Get evaluation progress
   */
  getProgress(): {
    completed: number;
    total: number;
    currentBatch: number;
    errors: number;
  };

  /**
   * Export results to JSON
   */
  exportResults(results: EvaluationResult[], outputPath: string): Promise<void>;
}