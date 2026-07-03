/**
 * **Feature: code-generation-evaluation, Property 3: P2 prompting file constraints**
 * Property-based test for P2 prompting file constraints
 * Validates: Requirements 1.3
 */

import * as fc from 'fast-check';
import { ModelEvaluator } from '../services/ModelEvaluator';
import { Task } from '../types';

describe('Property 3: P2 prompting file constraints', () => {
  let modelEvaluator: ModelEvaluator;

  beforeEach(() => {
    modelEvaluator = new ModelEvaluator();
  });

  test('P2 prompting should include imports at depth one containing between 2-5 files', () => {
    fc.assert(
      fc.asyncProperty(
        // Generate arbitrary tasks
        fc.record({
          id: fc.string({ minLength: 1 }),
          repositoryId: fc.string({ minLength: 1 }),
          complexity: fc.constantFrom('L1' as const, 'L2' as const, 'L3' as const),
          specification: fc.string({ minLength: 10 }),
          targetFiles: fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 5 }),
          dependencies: fc.array(fc.string({ minLength: 1 }), { minLength: 2, maxLength: 10 }),
          derivedFrom: fc.constantFrom('issue' as const, 'commit' as const)
        }),
        async (task: Task) => {
          // Apply P2 prompting strategy
          const contextFiles = await modelEvaluator.applyP2Prompting(task);
          
          // P2 prompting should return between 2-5 files as per requirement
          expect(contextFiles.length).toBeGreaterThanOrEqual(2);
          expect(contextFiles.length).toBeLessThanOrEqual(5);
          
          // All context files should be unique
          const uniqueFiles = new Set(contextFiles);
          expect(uniqueFiles.size).toBe(contextFiles.length);
        }
      ),
      { numRuns: 10 }
    );
  });
});