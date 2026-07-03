import { FailureDetection, Graph, Generation } from '../types';

export interface IFailureDetector {
  /**
   * Detect import failures (missing imports, circular dependencies)
   */
  detectImportFailures(graphs: Graph[]): Promise<FailureDetection[]>;

  /**
   * Detect call failures (undefined functions, signature mismatches)
   */
  detectCallFailures(graphs: Graph[]): Promise<FailureDetection[]>;

  /**
   * Detect schema failures (type inconsistencies, constraint violations)
   */
  detectSchemaFailures(graphs: Graph[]): Promise<FailureDetection[]>;

  /**
   * Detect configuration failures (invalid configs, missing settings)
   */
  detectConfigFailures(graphs: Graph[]): Promise<FailureDetection[]>;

  /**
   * Analyze cross-graph structural inconsistencies
   */
  analyzeStructuralInconsistencies(graphs: Graph[]): Promise<FailureDetection[]>;

  /**
   * Detect all failure types for a generation
   */
  detectAllFailures(generation: Generation, graphs: Graph[]): Promise<FailureDetection[]>;
}