import * as fc from 'fast-check';
import { TaskGenerator } from '../services/TaskGenerator';
import { Repository } from '../types';

/**
 * **Feature: code-generation-evaluation, Property 8: Task generation consistency**
 * **Validates: Requirements 3.1, 3.2, 3.3**
 * 
 * Property: For any repository, task generation should produce exactly 3 L1 tasks, 2 L2 tasks, and 1 L3 task
 */

describe('Task Generation Consistency Property Tests', () => {
  let taskGenerator: TaskGenerator;

  beforeEach(() => {
    taskGenerator = new TaskGenerator();
  });

  // Generator for valid Repository objects
  const repositoryArbitrary: fc.Arbitrary<Repository> = fc.record({
    id: fc.string({ minLength: 1, maxLength: 50 }),
    name: fc.string({ minLength: 1, maxLength: 100 }),
    framework: fc.constantFrom('FastAPI', 'Django', 'Express', 'Next.js') as fc.Arbitrary<Repository['framework']>,
    language: fc.constantFrom('Python', 'TypeScript') as fc.Arbitrary<Repository['language']>,
    fileCount: fc.integer({ min: 50, max: 10000 }), // Based on requirement 2.3
    linesOfCode: fc.integer({ min: 10000, max: 1000000 }), // Based on requirement 2.3
    typeAnnotationCoverage: fc.float({ min: Math.fround(0.5), max: Math.fround(1.0) }), // Based on requirement 2.4
    testCoverage: fc.float({ min: Math.fround(0.6), max: Math.fround(1.0) }), // Based on requirement 2.4
    source: fc.constantFrom('SWE-bench', 'EvoCodeBench', 'Curated') as fc.Arbitrary<Repository['source']>
  }).map((data): Repository => ({
    ...data,
    // Ensure language matches framework
    language: (data.framework === 'FastAPI' || data.framework === 'Django') ? 'Python' : 'TypeScript'
  }));

  test('Property 8: Task generation consistency - L1 tasks', async () => {
    await fc.assert(
      fc.asyncProperty(repositoryArbitrary, async (repository: Repository) => {
        const l1Tasks = await taskGenerator.generateL1Tasks(repository);
        
        // Requirements 3.1: Generate 3 single-file tasks per repository
        expect(l1Tasks).toHaveLength(3);
        
        // Verify all tasks are L1 complexity
        l1Tasks.forEach(task => {
          expect(task.complexity).toBe('L1');
          expect(task.repositoryId).toBe(repository.id);
          expect(task.targetFiles).toHaveLength(1); // Single-file tasks
          expect(task.dependencies).toHaveLength(0); // L1 tasks have no dependencies
          expect(task.specification).toBeTruthy();
          expect(task.id).toBeTruthy();
          
          // Verify derivedFrom based on source
          if (repository.source === 'Curated') {
            expect(task.derivedFrom).toBe('commit');
          } else {
            expect(task.derivedFrom).toBe('issue');
          }
        });
      }),
      { numRuns: 10 }
    );
  });

  test('Property 8: Task generation consistency - L2 tasks', async () => {
    await fc.assert(
      fc.asyncProperty(repositoryArbitrary, async (repository: Repository) => {
        const l2Tasks = await taskGenerator.generateL2Tasks(repository);
        
        // Requirements 3.2: Generate 2 multiple-file tasks with cross dependencies per repository
        expect(l2Tasks).toHaveLength(2);
        
        // Verify all tasks are L2 complexity
        l2Tasks.forEach(task => {
          expect(task.complexity).toBe('L2');
          expect(task.repositoryId).toBe(repository.id);
          expect(task.targetFiles.length).toBeGreaterThan(1); // Multiple-file tasks
          expect(task.dependencies.length).toBeGreaterThan(0); // Must have cross dependencies
          expect(task.specification).toBeTruthy();
          expect(task.id).toBeTruthy();
          
          // Verify derivedFrom based on source
          if (repository.source === 'Curated') {
            expect(task.derivedFrom).toBe('commit');
          } else {
            expect(task.derivedFrom).toBe('issue');
          }
        });
      }),
      { numRuns: 10 }
    );
  });

  test('Property 8: Task generation consistency - L3 tasks', async () => {
    await fc.assert(
      fc.asyncProperty(repositoryArbitrary, async (repository: Repository) => {
        const l3Tasks = await taskGenerator.generateL3Tasks(repository);
        
        // Requirements 3.3: Generate 1 cross-cutting task across layers per repository
        expect(l3Tasks).toHaveLength(1);
        
        // Verify the task is L3 complexity
        const task = l3Tasks[0]!;
        expect(task.complexity).toBe('L3');
        expect(task.repositoryId).toBe(repository.id);
        expect(task.targetFiles.length).toBeGreaterThan(1); // Cross-cutting tasks span multiple files
        expect(task.dependencies.length).toBeGreaterThan(0); // Must have dependencies
        expect(task.specification).toBeTruthy();
        expect(task.id).toBeTruthy();
        
        // Verify derivedFrom based on source
        if (repository.source === 'Curated') {
          expect(task.derivedFrom).toBe('commit');
        } else {
          expect(task.derivedFrom).toBe('issue');
        }
      }),
      { numRuns: 10 }
    );
  });

  test('Property 8: Task generation consistency - Combined L1, L2, L3 generation', async () => {
    await fc.assert(
      fc.asyncProperty(repositoryArbitrary, async (repository: Repository) => {
        // Generate all task types
        const l1Tasks = await taskGenerator.generateL1Tasks(repository);
        const l2Tasks = await taskGenerator.generateL2Tasks(repository);
        const l3Tasks = await taskGenerator.generateL3Tasks(repository);
        
        // Verify exact counts per requirements 3.1, 3.2, 3.3
        expect(l1Tasks).toHaveLength(3);
        expect(l2Tasks).toHaveLength(2);
        expect(l3Tasks).toHaveLength(1);
        
        // Verify all tasks belong to the same repository
        const allTasks = [...l1Tasks, ...l2Tasks, ...l3Tasks];
        allTasks.forEach(task => {
          expect(task.repositoryId).toBe(repository.id);
        });
        
        // Verify unique task IDs
        const taskIds = allTasks.map(task => task.id);
        const uniqueTaskIds = new Set(taskIds);
        expect(uniqueTaskIds.size).toBe(taskIds.length);
        
        // Verify complexity distribution
        const complexityCounts = {
          L1: allTasks.filter(t => t.complexity === 'L1').length,
          L2: allTasks.filter(t => t.complexity === 'L2').length,
          L3: allTasks.filter(t => t.complexity === 'L3').length
        };
        
        expect(complexityCounts.L1).toBe(3);
        expect(complexityCounts.L2).toBe(2);
        expect(complexityCounts.L3).toBe(1);
      }),
      { numRuns: 10 }
    );
  });

  test('Property 8: Task generation consistency - Framework-specific validation', async () => {
    await fc.assert(
      fc.asyncProperty(repositoryArbitrary, async (repository: Repository) => {
        const allTasks = [
          ...(await taskGenerator.generateL1Tasks(repository)),
          ...(await taskGenerator.generateL2Tasks(repository)),
          ...(await taskGenerator.generateL3Tasks(repository))
        ];
        
        // Verify file extensions match language
        const expectedExtension = repository.language === 'Python' ? '.py' : '.ts';
        
        allTasks.forEach(task => {
          task.targetFiles.forEach(file => {
            expect(file).toMatch(new RegExp(`\\${expectedExtension}$`));
          });
        });
        
        // Verify framework-specific dependencies
        allTasks.forEach(task => {
          if (task.dependencies.length > 0) {
            if (repository.language === 'Python') {
              // Should have Python-specific dependencies
              const hasPythonDeps = task.dependencies.some(dep => 
                ['typing', 'pydantic', 'fastapi', 'django', 'sqlalchemy'].includes(dep)
              );
              expect(hasPythonDeps).toBe(true);
            } else {
              // Should have TypeScript-specific dependencies
              const hasTypescriptDeps = task.dependencies.some(dep => 
                ['@types/node', 'express', '@types/express', 'next', 'react', '@types/react'].includes(dep)
              );
              expect(hasTypescriptDeps).toBe(true);
            }
          }
        });
      }),
      { numRuns: 10 }
    );
  });
});