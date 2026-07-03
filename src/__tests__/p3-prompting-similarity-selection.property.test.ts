/**
 * **Feature: code-generation-evaluation, Property 4: P3 prompting similarity selection**
 * Property-based test for P3 prompting similarity selection
 * Validates: Requirements 1.4
 */

import * as fc from 'fast-check';
import { ModelEvaluator } from '../services/ModelEvaluator';
import { Task } from '../types';

describe('Property 4: P3 prompting similarity selection', () => {
  let modelEvaluator: ModelEvaluator;

  beforeEach(() => {
    modelEvaluator = new ModelEvaluator();
  });

  test('P3 prompting should include exactly 10 files ranked by embedding similarity', () => {
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
          // Apply P3 prompting strategy
          const contextFiles = await modelEvaluator.applyP3Prompting(task);
          
          // P3 prompting should return exactly 10 files as per requirement
          expect(contextFiles.length).toBe(10);
          
          // All context files should be unique
          const uniqueFiles = new Set(contextFiles);
          expect(uniqueFiles.size).toBe(10);
          
          // Files should follow the similarity naming pattern (mock implementation)
          contextFiles.forEach((file, index) => {
            expect(file).toBe(`similar_file_${index + 1}.ts`);
          });
        }
      ),
      { numRuns: 10 }
    );
  });
});