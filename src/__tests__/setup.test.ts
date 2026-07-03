// Basic setup verification tests

import * as fc from 'fast-check';
import { VERSION, DEFAULT_CONFIG } from '../index';
import { Repository, Task, Generation } from '../types';

describe('Project Setup', () => {
  test('should have correct version', () => {
    expect(VERSION).toBe('1.0.0');
  });

  test('should have default configuration', () => {
    expect(DEFAULT_CONFIG).toEqual({
      models: ['GPT-4o', 'Claude-3.5-Sonnet'],
      promptStrategies: ['P1', 'P2', 'P3', 'P4'],
      batchSize: 10,
      maxRetries: 3,
      parallelWorkers: 1,
    });
  });

  test('should have fast-check available', () => {
    expect(fc).toBeDefined();
    expect(typeof fc.property).toBe('function');
  });

  test('Repository interface should be properly typed', () => {
    const repo: Repository = {
      id: 'test-repo',
      name: 'Test Repository',
      framework: 'FastAPI',
      language: 'Python',
      fileCount: 100,
      linesOfCode: 5000,
      typeAnnotationCoverage: 0.8,
      testCoverage: 0.7,
      source: 'Curated'
    };

    expect(repo.id).toBe('test-repo');
    expect(repo.framework).toBe('FastAPI');
    expect(repo.language).toBe('Python');
  });

  test('Task interface should be properly typed', () => {
    const task: Task = {
      id: 'task-1',
      repositoryId: 'repo-1',
      complexity: 'L1',
      specification: 'Implement user authentication',
      targetFiles: ['auth.py'],
      dependencies: [],
      derivedFrom: 'issue'
    };

    expect(task.complexity).toBe('L1');
    expect(task.derivedFrom).toBe('issue');
  });

  test('Generation interface should be properly typed', () => {
    const generation: Generation = {
      id: 'gen-1',
      taskId: 'task-1',
      model: 'GPT-4o',
      promptStrategy: 'P1',
      contextFiles: ['context.py'],
      generatedCode: 'def authenticate(): pass',
      timestamp: new Date()
    };

    expect(generation.model).toBe('GPT-4o');
    expect(generation.promptStrategy).toBe('P1');
  });
});