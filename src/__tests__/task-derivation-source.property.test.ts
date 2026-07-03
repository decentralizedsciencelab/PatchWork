import * as fc from 'fast-check';
import { TaskGenerator } from '../services/TaskGenerator';
import { Repository } from '../types';

/**
 * **Feature: code-generation-evaluation, Property 9: Task derivation source correctness**
 * **Validates: Requirements 3.4, 3.5**
 * 
 * Property: For any benchmark task, the specification should derive from existing repository issues,
 * and for any curated task, the specification should derive from git commit messages
 */

describe('Task Derivation Source Correctness Property Tests', () => {
  let taskGenerator: TaskGenerator;

  beforeEach(() => {
    taskGenerator = new TaskGenerator();
  });

  // Generator for benchmark repositories (SWE-bench, EvoCodeBench)
  const benchmarkRepositoryArbitrary: fc.Arbitrary<Repository> = fc.record({
    id: fc.string({ minLength: 1, maxLength: 50 }),
    name: fc.string({ minLength: 1, maxLength: 100 }),
    framework: fc.constantFrom('FastAPI', 'Django', 'Express', 'Next.js') as fc.Arbitrary<Repository['framework']>,
    language: fc.constantFrom('Python', 'TypeScript') as fc.Arbitrary<Repository['language']>,
    fileCount: fc.integer({ min: 50, max: 10000 }),
    linesOfCode: fc.integer({ min: 10000, max: 1000000 }),
    typeAnnotationCoverage: fc.float({ min: Math.fround(0.5), max: Math.fround(1.0) }),
    testCoverage: fc.float({ min: Math.fround(0.6), max: Math.fround(1.0) }),
    source: fc.constantFrom('SWE-bench', 'EvoCodeBench') as fc.Arbitrary<Repository['source']>
  }).map((data): Repository => ({
    ...data,
    // Ensure language matches framework
    language: (data.framework === 'FastAPI' || data.framework === 'Django') ? 'Python' : 'TypeScript'
  }));

  // Generator for curated repositories
  const curatedRepositoryArbitrary: fc.Arbitrary<Repository> = fc.record({
    id: fc.string({ minLength: 1, maxLength: 50 }),
    name: fc.string({ minLength: 1, maxLength: 100 }),
    framework: fc.constantFrom('FastAPI', 'Django', 'Express', 'Next.js') as fc.Arbitrary<Repository['framework']>,
    language: fc.constantFrom('Python', 'TypeScript') as fc.Arbitrary<Repository['language']>,
    fileCount: fc.integer({ min: 50, max: 10000 }),
    linesOfCode: fc.integer({ min: 10000, max: 1000000 }),
    typeAnnotationCoverage: fc.float({ min: Math.fround(0.5), max: Math.fround(1.0) }),
    testCoverage: fc.float({ min: Math.fround(0.6), max: Math.fround(1.0) }),
    source: fc.constant('Curated') as fc.Arbitrary<Repository['source']>
  }).map((data): Repository => ({
    ...data,
    // Ensure language matches framework
    language: (data.framework === 'FastAPI' || data.framework === 'Django') ? 'Python' : 'TypeScript'
  }));

  test('Property 9: Benchmark tasks derive from repository issues', async () => {
    await fc.assert(
      fc.asyncProperty(benchmarkRepositoryArbitrary, async (repository: Repository) => {
        // Test deriveFromIssues method for benchmark repositories
        const issueTasks = await taskGenerator.deriveFromIssues(repository);
        
        // Requirement 3.4: Derive benchmark tasks from repository issues
        issueTasks.forEach(task => {
          expect(task.derivedFrom).toBe('issue');
          expect(task.repositoryId).toBe(repository.id);
          expect(task.specification).toBeTruthy();
          expect(task.id).toBeTruthy();
          expect(['L1', 'L2', 'L3']).toContain(task.complexity);
        });

        // Test that standard L1, L2, L3 tasks also derive from issues for benchmark repos
        const l1Tasks = await taskGenerator.generateL1Tasks(repository);
        const l2Tasks = await taskGenerator.generateL2Tasks(repository);
        const l3Tasks = await taskGenerator.generateL3Tasks(repository);
        
        const allStandardTasks = [...l1Tasks, ...l2Tasks, ...l3Tasks];
        allStandardTasks.forEach(task => {
          expect(task.derivedFrom).toBe('issue');
          expect(task.repositoryId).toBe(repository.id);
        });
      }),
      { numRuns: 10 }
    );
  });

  test('Property 9: Curated tasks derive from git commit messages', async () => {
    await fc.assert(
      fc.asyncProperty(curatedRepositoryArbitrary, async (repository: Repository) => {
        // Test extractFromGitHistory method for curated repositories
        const gitTasks = await taskGenerator.extractFromGitHistory(repository);
        
        // Requirement 3.5: Create curated tasks from git history and commit messages
        gitTasks.forEach(task => {
          expect(task.derivedFrom).toBe('commit');
          expect(task.repositoryId).toBe(repository.id);
          expect(task.specification).toBeTruthy();
          expect(task.id).toBeTruthy();
          expect(['L1', 'L2', 'L3']).toContain(task.complexity);
        });

        // Test that standard L1, L2, L3 tasks also derive from commits for curated repos
        const l1Tasks = await taskGenerator.generateL1Tasks(repository);
        const l2Tasks = await taskGenerator.generateL2Tasks(repository);
        const l3Tasks = await taskGenerator.generateL3Tasks(repository);
        
        const allStandardTasks = [...l1Tasks, ...l2Tasks, ...l3Tasks];
        allStandardTasks.forEach(task => {
          expect(task.derivedFrom).toBe('commit');
          expect(task.repositoryId).toBe(repository.id);
        });
      }),
      { numRuns: 10 }
    );
  });

  test('Property 9: Source-specific task derivation exclusivity', async () => {
    await fc.assert(
      fc.asyncProperty(benchmarkRepositoryArbitrary, async (benchmarkRepo: Repository) => {
        // Benchmark repositories should not extract from git history
        const gitTasks = await taskGenerator.extractFromGitHistory(benchmarkRepo);
        expect(gitTasks).toHaveLength(0);
        
        // But should derive from issues
        const issueTasks = await taskGenerator.deriveFromIssues(benchmarkRepo);
        expect(issueTasks.length).toBeGreaterThan(0);
        issueTasks.forEach(task => {
          expect(task.derivedFrom).toBe('issue');
        });
      }),
      { numRuns: 10 }
    );

    await fc.assert(
      fc.asyncProperty(curatedRepositoryArbitrary, async (curatedRepo: Repository) => {
        // Curated repositories should not derive from issues
        const issueTasks = await taskGenerator.deriveFromIssues(curatedRepo);
        expect(issueTasks).toHaveLength(0);
        
        // But should extract from git history
        const gitTasks = await taskGenerator.extractFromGitHistory(curatedRepo);
        expect(gitTasks.length).toBeGreaterThan(0);
        gitTasks.forEach(task => {
          expect(task.derivedFrom).toBe('commit');
        });
      }),
      { numRuns: 10 }
    );
  });

  test('Property 9: All tasks have correct derivation source in generateAllTasks', async () => {
    // Test with benchmark repository
    await fc.assert(
      fc.asyncProperty(benchmarkRepositoryArbitrary, async (benchmarkRepo: Repository) => {
        const allTasks = await taskGenerator.generateAllTasks(benchmarkRepo);
        
        // All tasks from benchmark repos should derive from issues
        allTasks.forEach(task => {
          expect(task.derivedFrom).toBe('issue');
          expect(task.repositoryId).toBe(benchmarkRepo.id);
        });
        
        // Should have at least the standard 6 tasks (3 L1 + 2 L2 + 1 L3)
        expect(allTasks.length).toBeGreaterThanOrEqual(6);
      }),
      { numRuns: 10 }
    );

    // Test with curated repository
    await fc.assert(
      fc.asyncProperty(curatedRepositoryArbitrary, async (curatedRepo: Repository) => {
        const allTasks = await taskGenerator.generateAllTasks(curatedRepo);
        
        // All tasks from curated repos should derive from commits
        allTasks.forEach(task => {
          expect(task.derivedFrom).toBe('commit');
          expect(task.repositoryId).toBe(curatedRepo.id);
        });
        
        // Should have at least the standard 6 tasks (3 L1 + 2 L2 + 1 L3)
        expect(allTasks.length).toBeGreaterThanOrEqual(6);
      }),
      { numRuns: 10 }
    );
  });

  test('Property 9: Task specifications reflect derivation source', async () => {
    await fc.assert(
      fc.asyncProperty(benchmarkRepositoryArbitrary, async (benchmarkRepo: Repository) => {
        const issueTasks = await taskGenerator.deriveFromIssues(benchmarkRepo);
        
        // Issue-derived tasks should have specifications that reflect issue descriptions
        issueTasks.forEach(task => {
          expect(task.derivedFrom).toBe('issue');
          expect(task.specification).toBeTruthy();
          expect(typeof task.specification).toBe('string');
          expect(task.specification.length).toBeGreaterThan(0);
        });
      }),
      { numRuns: 10 }
    );

    await fc.assert(
      fc.asyncProperty(curatedRepositoryArbitrary, async (curatedRepo: Repository) => {
        const gitTasks = await taskGenerator.extractFromGitHistory(curatedRepo);
        
        // Commit-derived tasks should have specifications that reflect commit messages
        gitTasks.forEach(task => {
          expect(task.derivedFrom).toBe('commit');
          expect(task.specification).toBeTruthy();
          expect(typeof task.specification).toBe('string');
          expect(task.specification.length).toBeGreaterThan(0);
        });
      }),
      { numRuns: 10 }
    );
  });
});