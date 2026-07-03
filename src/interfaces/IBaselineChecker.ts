import { FailureDetection, Generation } from '../types';

export interface IBaselineChecker {
  /**
   * Run compile checks using mypy --strict for Python or tsc --strict for TypeScript
   */
  runCompileCheck(generation: Generation): Promise<FailureDetection[]>;

  /**
   * Execute repository test suites and capture results
   */
  runTestExecution(generation: Generation): Promise<FailureDetection[]>;

  /**
   * Run SAST analysis using bandit and semgrep tools
   */
  runSASTAnalysis(generation: Generation): Promise<FailureDetection[]>;

  /**
   * Apply regex heuristics with naive pattern matching
   */
  runRegexHeuristics(generation: Generation): Promise<FailureDetection[]>;

  /**
   * Run all baseline checks for a generation
   */
  runAllChecks(generation: Generation): Promise<FailureDetection[]>;
}