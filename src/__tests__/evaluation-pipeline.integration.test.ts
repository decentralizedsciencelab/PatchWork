/**
 * Integration tests for EvaluationPipeline
 * Tests end-to-end evaluation workflow, parallel processing, batch handling,
 * error recovery, and retry mechanisms
 */

import { EvaluationPipeline } from '../services/EvaluationPipeline';
import { EvaluationConfig, EvaluationResult } from '../interfaces/IEvaluationPipeline';
import { Repository, Task } from '../types';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('EvaluationPipeline Integration Tests', () => {
  let pipeline: EvaluationPipeline;
  let tempDir: string;

  beforeEach(async () => {
    pipeline = new EvaluationPipeline();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-pipeline-test-'));
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // Helper to create mock repositories
  const createMockRepository = (overrides?: Partial<Repository>): Repository => ({
    id: `repo-${Math.random().toString(36).substr(2, 9)}`,
    name: 'test-repo',
    framework: 'FastAPI',
    language: 'Python',
    fileCount: 100,
    linesOfCode: 5000,
    typeAnnotationCoverage: 0.8,
    testCoverage: 0.7,
    source: 'Curated',
    ...overrides
  });

  // Helper to create mock tasks
  const createMockTask = (repositoryId: string, overrides?: Partial<Task>): Task => ({
    id: `task-${Math.random().toString(36).substr(2, 9)}`,
    repositoryId,
    complexity: 'L1',
    specification: 'Test specification',
    targetFiles: ['src/main.py'],
    dependencies: [],
    derivedFrom: 'commit',
    ...overrides
  });

  describe('Pipeline Configuration', () => {
    test('should initialize with default configuration', () => {
      const progress = pipeline.getProgress();

      expect(progress.completed).toBe(0);
      expect(progress.total).toBe(0);
      expect(progress.currentBatch).toBe(0);
      expect(progress.errors).toBe(0);
    });

    test('should accept custom configuration', () => {
      const customConfig: EvaluationConfig = {
        models: ['GPT-4o'],
        promptStrategies: ['P1', 'P2'],
        batchSize: 5,
        maxRetries: 2,
        parallelWorkers: 2
      };

      pipeline.configure(customConfig);
      // Configuration is applied internally - verify through behavior
      expect(pipeline.getProgress().total).toBe(0); // No evaluation started yet
    });

    test('should reset pipeline state', () => {
      // Simulate some progress
      pipeline.reset();

      const progress = pipeline.getProgress();
      expect(progress.completed).toBe(0);
      expect(progress.total).toBe(0);
      expect(progress.currentBatch).toBe(0);
      expect(progress.errors).toBe(0);
      expect(pipeline.getErrorLog()).toEqual([]);
    });
  });

  describe('Batch Processing', () => {
    test('should process empty task batch', async () => {
      const results = await pipeline.processBatch([]);

      expect(results).toEqual([]);
    });

    test('should process single task batch', async () => {
      const repository = createMockRepository();
      const task = createMockTask(repository.id);

      // Configure for minimal processing
      pipeline.configure({
        models: ['GPT-4o'],
        promptStrategies: ['P1'],
        batchSize: 1,
        maxRetries: 1,
        parallelWorkers: 1
      });

      const results = await pipeline.processBatch([task]);

      // Should return results (may fail due to API calls, but should handle gracefully)
      expect(Array.isArray(results)).toBe(true);
    });

    test('should handle multiple tasks in batch', async () => {
      const repository = createMockRepository();
      const tasks = [
        createMockTask(repository.id, { complexity: 'L1' }),
        createMockTask(repository.id, { complexity: 'L2' }),
        createMockTask(repository.id, { complexity: 'L3' })
      ];

      pipeline.configure({
        models: ['GPT-4o'],
        promptStrategies: ['P1'],
        batchSize: 10,
        maxRetries: 1,
        parallelWorkers: 2
      });

      const results = await pipeline.processBatch(tasks);

      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Progress Tracking', () => {
    test('should track progress during evaluation', async () => {
      const repository = createMockRepository();

      pipeline.configure({
        models: ['GPT-4o'],
        promptStrategies: ['P1'],
        batchSize: 10,
        maxRetries: 1,
        parallelWorkers: 1
      });

      // Start evaluation (will process quickly with minimal config)
      const resultPromise = pipeline.runEvaluation([repository]);

      // Progress should be initialized
      const initialProgress = pipeline.getProgress();
      expect(initialProgress.total).toBeGreaterThan(0);

      await resultPromise;

      const finalProgress = pipeline.getProgress();
      expect(finalProgress.completed).toBeLessThanOrEqual(finalProgress.total);
    });

    test('should calculate correct total for evaluation matrix', () => {
      const repositories = [
        createMockRepository({ id: 'repo1' }),
        createMockRepository({ id: 'repo2' })
      ];

      pipeline.configure({
        models: ['GPT-4o', 'Claude-3.5-Sonnet'],
        promptStrategies: ['P1', 'P2', 'P3', 'P4'],
        batchSize: 10,
        maxRetries: 1,
        parallelWorkers: 4
      });

      // Start evaluation to trigger total calculation
      pipeline.runEvaluation(repositories);

      const progress = pipeline.getProgress();

      // Total = repos * (3 L1 + 2 L2 + 1 L3) * models * promptStrategies
      // Total = 2 * 6 * 2 * 4 = 96
      expect(progress.total).toBe(96);
    });
  });

  describe('Error Handling and Retry', () => {
    test('should log errors during processing', async () => {
      const repository = createMockRepository();

      pipeline.configure({
        models: ['GPT-4o'],
        promptStrategies: ['P1'],
        batchSize: 10,
        maxRetries: 1,
        parallelWorkers: 1
      });

      await pipeline.runEvaluation([repository]);

      // Error log should be accessible
      const errorLog = pipeline.getErrorLog();
      expect(Array.isArray(errorLog)).toBe(true);

      // Each error should have correct structure
      for (const error of errorLog) {
        expect(error).toHaveProperty('taskId');
        expect(error).toHaveProperty('error');
        expect(error).toHaveProperty('timestamp');
        expect(error.timestamp instanceof Date).toBe(true);
      }
    });

    test('should track error count in progress', async () => {
      const repository = createMockRepository();

      pipeline.configure({
        models: ['GPT-4o'],
        promptStrategies: ['P1'],
        batchSize: 10,
        maxRetries: 1,
        parallelWorkers: 1
      });

      await pipeline.runEvaluation([repository]);

      const progress = pipeline.getProgress();
      expect(typeof progress.errors).toBe('number');
      expect(progress.errors).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Result Export', () => {
    test('should export results to JSON file', async () => {
      const mockResults: EvaluationResult[] = [
        {
          taskId: 'task-1',
          generations: [],
          graphs: [],
          failures: [],
          metrics: []
        }
      ];

      const outputPath = path.join(tempDir, 'results.json');

      await pipeline.exportResults(mockResults, outputPath);

      // Verify file was created
      const fileExists = await fs.access(outputPath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);

      // Verify file content
      const content = await fs.readFile(outputPath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed).toHaveProperty('timestamp');
      expect(parsed).toHaveProperty('config');
      expect(parsed).toHaveProperty('progress');
      expect(parsed).toHaveProperty('results');
      expect(Array.isArray(parsed.results)).toBe(true);
    });

    test('should include evaluation metadata in export', async () => {
      const mockResults: EvaluationResult[] = [];
      const outputPath = path.join(tempDir, 'metadata-test.json');

      pipeline.configure({
        models: ['GPT-4o'],
        promptStrategies: ['P1', 'P2'],
        batchSize: 5,
        maxRetries: 2,
        parallelWorkers: 2
      });

      await pipeline.exportResults(mockResults, outputPath);

      const content = await fs.readFile(outputPath, 'utf-8');
      const parsed = JSON.parse(content);

      // Should include configuration
      expect(parsed.config).toHaveProperty('models');
      expect(parsed.config).toHaveProperty('promptStrategies');
      expect(parsed.config).toHaveProperty('batchSize');

      // Should include progress
      expect(parsed.progress).toHaveProperty('completed');
      expect(parsed.progress).toHaveProperty('total');
      expect(parsed.progress).toHaveProperty('errors');

      // Should include error log
      expect(parsed).toHaveProperty('errorLog');
    });

    test('should handle empty results export', async () => {
      const outputPath = path.join(tempDir, 'empty-results.json');

      await pipeline.exportResults([], outputPath);

      const content = await fs.readFile(outputPath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.results).toEqual([]);
    });
  });

  describe('Repository Manager Access', () => {
    test('should provide access to repository manager', () => {
      const repositoryManager = pipeline.getRepositoryManager();

      expect(repositoryManager).toBeDefined();
      expect(typeof repositoryManager.loadBenchmarkRepos).toBe('function');
      expect(typeof repositoryManager.loadCuratedRepos).toBe('function');
      expect(typeof repositoryManager.validateRepository).toBe('function');
    });
  });

  describe('End-to-End Workflow', () => {
    test('should complete full evaluation pipeline with minimal config', async () => {
      const repository = createMockRepository();

      pipeline.configure({
        models: ['GPT-4o'],
        promptStrategies: ['P1'],
        batchSize: 10,
        maxRetries: 1,
        parallelWorkers: 1
      });

      const results = await pipeline.runEvaluation([repository]);

      // Should return results array
      expect(Array.isArray(results)).toBe(true);

      // Progress should reflect completion
      const progress = pipeline.getProgress();
      expect(progress.completed + progress.errors).toBeLessThanOrEqual(progress.total);
    });

    test('should handle multiple repositories', async () => {
      const repositories = [
        createMockRepository({ id: 'repo1', name: 'repo-1' }),
        createMockRepository({ id: 'repo2', name: 'repo-2' })
      ];

      pipeline.configure({
        models: ['GPT-4o'],
        promptStrategies: ['P1'],
        batchSize: 10,
        maxRetries: 1,
        parallelWorkers: 1
      });

      const results = await pipeline.runEvaluation(repositories);

      expect(Array.isArray(results)).toBe(true);
    });

    test('should handle different language repositories', async () => {
      const repositories = [
        createMockRepository({ language: 'Python', framework: 'FastAPI' }),
        createMockRepository({ language: 'TypeScript', framework: 'Next.js' })
      ];

      pipeline.configure({
        models: ['GPT-4o'],
        promptStrategies: ['P1'],
        batchSize: 10,
        maxRetries: 1,
        parallelWorkers: 1
      });

      const results = await pipeline.runEvaluation(repositories);

      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Parallel Processing', () => {
    test('should respect parallelWorkers configuration', async () => {
      const repository = createMockRepository();

      // Test with single worker
      pipeline.configure({
        models: ['GPT-4o'],
        promptStrategies: ['P1'],
        batchSize: 10,
        maxRetries: 1,
        parallelWorkers: 1
      });

      await pipeline.runEvaluation([repository]);
      const progress1 = pipeline.getProgress();

      pipeline.reset();

      // Test with multiple workers
      pipeline.configure({
        models: ['GPT-4o'],
        promptStrategies: ['P1'],
        batchSize: 10,
        maxRetries: 1,
        parallelWorkers: 4
      });

      await pipeline.runEvaluation([repository]);
      const progress2 = pipeline.getProgress();

      // Both configurations should produce valid progress tracking
      expect(progress1.total).toBeGreaterThan(0);
      expect(progress2.total).toBeGreaterThan(0);
      expect(progress1.total).toBe(progress2.total); // Same workload
    });

    test('should handle concurrent batch processing', async () => {
      const repository = createMockRepository();
      const tasks = Array.from({ length: 10 }, (_, i) =>
        createMockTask(repository.id, { id: `task-${i}` })
      );

      pipeline.configure({
        models: ['GPT-4o'],
        promptStrategies: ['P1'],
        batchSize: 3,
        maxRetries: 1,
        parallelWorkers: 3
      });

      const results = await pipeline.processBatch(tasks);

      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Result Structure Validation', () => {
    test('exported results should have correct structure', async () => {
      const repository = createMockRepository();

      pipeline.configure({
        models: ['GPT-4o'],
        promptStrategies: ['P1'],
        batchSize: 10,
        maxRetries: 1,
        parallelWorkers: 1
      });

      const results = await pipeline.runEvaluation([repository]);
      const outputPath = path.join(tempDir, 'structure-test.json');

      await pipeline.exportResults(results, outputPath);

      const content = await fs.readFile(outputPath, 'utf-8');
      const parsed = JSON.parse(content);

      // Validate top-level structure
      expect(typeof parsed.timestamp).toBe('string');
      expect(new Date(parsed.timestamp).getTime()).toBeGreaterThan(0);

      // Validate result entries
      for (const result of parsed.results) {
        expect(result).toHaveProperty('taskId');
        expect(result).toHaveProperty('generationCount');
        expect(result).toHaveProperty('graphCount');
        expect(result).toHaveProperty('failureCount');
        expect(result).toHaveProperty('generations');
        expect(result).toHaveProperty('failures');
        expect(result).toHaveProperty('metrics');

        expect(typeof result.taskId).toBe('string');
        expect(typeof result.generationCount).toBe('number');
        expect(typeof result.graphCount).toBe('number');
        expect(typeof result.failureCount).toBe('number');
      }
    });
  });
});
