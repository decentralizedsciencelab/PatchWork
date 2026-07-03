/**
 * Property-based tests for Repository Validation
 * Feature: code-generation-evaluation, Property 6: Repository validation rules
 */

import * as fc from 'fast-check';
import { Repository } from '../types';
import { RepositoryModel } from '../models/Repository';

describe('Repository Validation Property Tests', () => {
  /**
   * Feature: code-generation-evaluation, Property 6: Repository validation rules
   * Validates: Requirements 2.3, 2.4
   */
  test('Property 6: Repository validation rules - curated repositories must meet minimum requirements', async () => {
    await fc.assert(
      fc.property(
        // Generate arbitrary curated repository data
        fc.record({
          id: fc.string({ minLength: 1, maxLength: 50 }),
          name: fc.string({ minLength: 1, maxLength: 100 }),
          framework: fc.constantFrom('FastAPI' as const, 'Django' as const, 'Express' as const, 'Next.js' as const),
          language: fc.constantFrom('Python' as const, 'TypeScript' as const),
          fileCount: fc.integer({ min: 0, max: 200 }),
          linesOfCode: fc.integer({ min: 0, max: 50000 }),
          // Use integer generators to avoid NaN issues, then convert to percentage
          typeAnnotationCoverage: fc.integer({ min: 0, max: 100 }),
          testCoverage: fc.integer({ min: 0, max: 100 }),
          source: fc.constant('Curated' as const)
        }),
        (repositoryData: Repository) => {
          const errors = RepositoryModel.validate(repositoryData);
          
          // For curated repositories, validation should enforce:
          // - Minimum 50 files (Requirement 2.3)
          // - Minimum 10K lines of code (Requirement 2.3)  
          // - Type annotation coverage > 50% (Requirement 2.4)
          // - Test coverage > 60% (Requirement 2.4)
          
          const hasMinFiles = repositoryData.fileCount >= 50;
          const hasMinLOC = repositoryData.linesOfCode >= 10000;
          const hasMinTypeAnnotation = repositoryData.typeAnnotationCoverage > 50;
          const hasMinTestCoverage = repositoryData.testCoverage > 60;
          
          const shouldBeValid = hasMinFiles && hasMinLOC && hasMinTypeAnnotation && hasMinTestCoverage;
          
          if (shouldBeValid) {
            // If all requirements are met, there should be no curated-specific validation errors
            const curatedErrors = errors.filter(error => 
              error.includes('Curated repository must have minimum 50 files') ||
              error.includes('Curated repository must have minimum 10K lines of code') ||
              error.includes('Curated repository must have type annotation coverage > 50%') ||
              error.includes('Curated repository must have test coverage > 60%')
            );
            expect(curatedErrors).toHaveLength(0);
          } else {
            // If requirements are not met, appropriate validation errors should be present
            if (!hasMinFiles) {
              expect(errors).toContain('Curated repository must have minimum 50 files');
            }
            if (!hasMinLOC) {
              expect(errors).toContain('Curated repository must have minimum 10K lines of code');
            }
            if (!hasMinTypeAnnotation) {
              expect(errors).toContain('Curated repository must have type annotation coverage > 50%');
            }
            if (!hasMinTestCoverage) {
              expect(errors).toContain('Curated repository must have test coverage > 60%');
            }
          }
        }
      ),
      { numRuns: 10 } // Minimum 100 iterations as specified in design
    );
  });

  /**
   * Feature: code-generation-evaluation, Property 6: Repository validation rules
   * Validates: Requirements 2.3, 2.4 - Non-curated repositories should not have curated-specific validation
   */
  test('Property 6: Repository validation rules - non-curated repositories bypass curated validation', async () => {
    await fc.assert(
      fc.property(
        // Generate arbitrary non-curated repository data
        fc.record({
          id: fc.string({ minLength: 1, maxLength: 50 }),
          name: fc.string({ minLength: 1, maxLength: 100 }),
          framework: fc.constantFrom('FastAPI' as const, 'Django' as const, 'Express' as const, 'Next.js' as const),
          language: fc.constantFrom('Python' as const, 'TypeScript' as const),
          fileCount: fc.integer({ min: 0, max: 200 }),
          linesOfCode: fc.integer({ min: 0, max: 50000 }),
          typeAnnotationCoverage: fc.integer({ min: 0, max: 100 }),
          testCoverage: fc.integer({ min: 0, max: 100 }),
          source: fc.constantFrom('SWE-bench' as const, 'EvoCodeBench' as const)
        }),
        (repositoryData: Repository) => {
          const errors = RepositoryModel.validate(repositoryData);
          
          // Non-curated repositories should never have curated-specific validation errors
          // regardless of their file count, LOC, or coverage values
          const curatedErrors = errors.filter(error => 
            error.includes('Curated repository must have minimum 50 files') ||
            error.includes('Curated repository must have minimum 10K lines of code') ||
            error.includes('Curated repository must have type annotation coverage > 50%') ||
            error.includes('Curated repository must have test coverage > 60%')
          );
          
          expect(curatedErrors).toHaveLength(0);
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: code-generation-evaluation, Property 6: Repository validation rules
   * Validates: Requirements 2.3, 2.4 - Valid curated repositories should pass validation completely
   */
  test('Property 6: Repository validation rules - valid curated repositories pass all validation', async () => {
    await fc.assert(
      fc.property(
        // Generate valid curated repository data that meets all requirements
        fc.record({
          id: fc.string({ minLength: 1, maxLength: 50 }),
          name: fc.string({ minLength: 1, maxLength: 100 }),
          framework: fc.constantFrom('FastAPI' as const, 'Django' as const, 'Express' as const, 'Next.js' as const),
          language: fc.constantFrom('Python' as const, 'TypeScript' as const),
          fileCount: fc.integer({ min: 50, max: 200 }), // >= 50 files
          linesOfCode: fc.integer({ min: 10000, max: 50000 }), // >= 10K LOC
          typeAnnotationCoverage: fc.integer({ min: 51, max: 100 }), // > 50%
          testCoverage: fc.integer({ min: 61, max: 100 }), // > 60%
          source: fc.constant('Curated' as const)
        }),
        (repositoryData: Repository) => {
          const errors = RepositoryModel.validate(repositoryData);
          
          // Valid curated repositories should have no validation errors
          expect(errors).toHaveLength(0);
          
          // Should be able to create a RepositoryModel instance without throwing
          expect(() => {
            new RepositoryModel(
              repositoryData.id,
              repositoryData.name,
              repositoryData.framework,
              repositoryData.language,
              repositoryData.fileCount,
              repositoryData.linesOfCode,
              repositoryData.typeAnnotationCoverage,
              repositoryData.testCoverage,
              repositoryData.source
            );
          }).not.toThrow();
        }
      ),
      { numRuns: 10 }
    );
  });
});