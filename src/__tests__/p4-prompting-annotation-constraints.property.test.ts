/**
 * **Feature: code-generation-evaluation, Property 5: P4 prompting annotation constraints**
 * Property-based test for P4 prompting annotation constraints
 * Validates: Requirements 1.5
 */

import * as fc from 'fast-check';
import { ModelEvaluator } from '../services/ModelEvaluator';
import { Task } from '../types';

describe('Property 5: P4 prompting annotation constraints', () => {
  let modelEvaluator: ModelEvaluator;

  beforeEach(() => {
    modelEvaluator = new ModelEvaluator();
  });

  test('P4 prompting should include human-annotated files numbering between 5-15', () => {
    fc.assert(
      fc.asyncProperty(
        // Generate arbitrary tasks
        fc.record({
          id: fc.string({ minLength: 1 }),
          repositoryId: fc.string({ minLength: 1 }),
          complexity: fc.constantFrom('L1' as const, 'L2' as const, 'L3' as const),
          specification: fc.string({ minLength: 10 }),
          targetFiles: fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 5 }),
          dependencies: fc.array(fc.string({ minLength: 1 }), { maxLength: 10 }),
          derivedFrom: fc.constantFrom('issue' as const, 'commit' as const)
        }),
        async (task: Task) => {
          // Apply P4 prompting strategy
          const contextFiles = await modelEvaluator.applyP4Prompting(task);
          
          // P4 prompting should return between 5-15 files as per requirement
          expect(contextFiles.length).toBeGreaterThanOrEqual(5);
          expect(contextFiles.length).toBeLessThanOrEqual(15);
          
          // All context files should be unique
          const uniqueFiles = new Set(contextFiles);
          expect(uniqueFiles.size).toBe(contextFiles.length);
          
          // Files should follow the annotated naming pattern (mock implementation)
          contextFiles.forEach((file, index) => {
            expect(file).toBe(`annotated_file_${index + 1}.ts`);
          });
        }
      ),
      { numRuns: 10 }
    );
  });
});