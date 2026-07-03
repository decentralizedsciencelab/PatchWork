/**
 * **Feature: code-generation-evaluation, Property 2: P1 prompting minimality**
 * Property-based test for P1 prompting minimality
 * Validates: Requirements 1.2
 */

import * as fc from 'fast-check';
import { ModelEvaluator } from '../services/ModelEvaluator';
import { Task } from '../types';

describe('Property 2: P1 prompting minimality', () => {
  let modelEvaluator: ModelEvaluator;

  beforeEach(() => {
    modelEvaluator = new ModelEvaluator();
  });

  test('P1 prompting should contain only task description and target path (no additional context files)', () => {
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
          // Apply P1 prompting strategy
          const contextFiles = await modelEvaluator.applyP1Prompting(task);
          
          // P1 prompting should return no additional context files
          // Only task description and target path should be used (which are part of the task itself)
          expect(contextFiles).toEqual([]);
        }
      ),
      { numRuns: 10 }
    );
  });
});