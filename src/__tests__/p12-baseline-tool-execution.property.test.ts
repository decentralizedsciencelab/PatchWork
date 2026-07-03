/**
 * **Feature: code-generation-evaluation, Property 12: Baseline tool execution**
 * 
 * Property: For any baseline check, the system should execute mypy/tsc in strict mode 
 * for compile checks, repository test suites for test execution, bandit/semgrep for SAST, 
 * and pattern matching for regex heuristics
 * 
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4
 */

import * as fc from 'fast-check';
import { BaselineChecker } from '../services/BaselineChecker';
import { Generation } from '../types';

describe('Property 12: Baseline tool execution', () => {
  let baselineChecker: BaselineChecker;

  beforeEach(() => {
    baselineChecker = new BaselineChecker();
  });

  const generationArbitrary = fc.record({
    id: fc.uuid(),
    taskId: fc.uuid(),
    model: fc.constantFrom('GPT-4o', 'Claude-3.5-Sonnet') as fc.Arbitrary<'GPT-4o' | 'Claude-3.5-Sonnet'>,
    promptStrategy: fc.constantFrom('P1', 'P2', 'P3', 'P4') as fc.Arbitrary<'P1' | 'P2' | 'P3' | 'P4'>,
    contextFiles: fc.array(fc.string(), { minLength: 0, maxLength: 15 }),
    generatedCode: fc.oneof(
      // TypeScript code samples
      fc.constant(`
interface User {
  id: string;
  name: string;
}

export function createUser(name: string): User {
  return { id: Math.random().toString(), name };
}
      `),
      // Python code samples
      fc.constant(`
from typing import Dict, Any

def process_data(data: Dict[str, Any]) -> Dict[str, Any]:
    return {"processed": True, "data": data}

class DataProcessor:
    def __init__(self):
        self.processed_count = 0
      `),
      // Code with potential issues
      fc.constant(`
function buggyFunction() {
  let x = undefined;
  return x.toString(); // This will cause an error
}
      `),
      // Empty/minimal code
      fc.constant('// Empty implementation'),
      fc.constant('# TODO: Implement this function')
    ),
    timestamp: fc.date()
  });

  it('should execute compile checks with appropriate tools', async () => {
    await fc.assert(
      fc.asyncProperty(generationArbitrary, async (generation: Generation) => {
        // Act
        const failures = await baselineChecker.runCompileCheck(generation);
        
        // Assert - compile check should always return an array
        expect(Array.isArray(failures)).toBe(true);
        
        // All failures should be detected by 'compile'
        failures.forEach(failure => {
          expect(failure.detectedBy).toBe('compile');
          expect(failure.generationId).toBe(generation.id);
          expect(['type', 'import', 'call', 'schema', 'config', 'dependency']).toContain(failure.category);
          expect(['error', 'warning']).toContain(failure.severity);
        });
      }),
      { numRuns: 10 }
    );
  });

  it('should execute test suites for test execution checks', async () => {
    await fc.assert(
      fc.asyncProperty(generationArbitrary, async (generation: Generation) => {
        // Act
        const failures = await baselineChecker.runTestExecution(generation);
        
        // Assert - test execution should always return an array
        expect(Array.isArray(failures)).toBe(true);
        
        // All failures should be detected by 'test'
        failures.forEach(failure => {
          expect(failure.detectedBy).toBe('test');
          expect(failure.generationId).toBe(generation.id);
          expect(['type', 'import', 'call', 'schema', 'config', 'dependency']).toContain(failure.category);
          expect(['error', 'warning']).toContain(failure.severity);
        });
      }),
      { numRuns: 10 }
    );
  });

  it('should execute SAST analysis with bandit and semgrep', async () => {
    await fc.assert(
      fc.asyncProperty(generationArbitrary, async (generation: Generation) => {
        // Act
        const failures = await baselineChecker.runSASTAnalysis(generation);
        
        // Assert - SAST analysis should always return an array
        expect(Array.isArray(failures)).toBe(true);
        
        // All failures should be detected by 'sast'
        failures.forEach(failure => {
          expect(failure.detectedBy).toBe('sast');
          expect(failure.generationId).toBe(generation.id);
          expect(['type', 'import', 'call', 'schema', 'config', 'dependency']).toContain(failure.category);
          expect(['error', 'warning']).toContain(failure.severity);
        });
      }),
      { numRuns: 10 }
    );
  });

  it('should execute regex heuristics with pattern matching', async () => {
    await fc.assert(
      fc.asyncProperty(generationArbitrary, async (generation: Generation) => {
        // Act
        const failures = await baselineChecker.runRegexHeuristics(generation);
        
        // Assert - regex heuristics should always return an array
        expect(Array.isArray(failures)).toBe(true);
        
        // All failures should be detected by 'regex'
        failures.forEach(failure => {
          expect(failure.detectedBy).toBe('regex');
          expect(failure.generationId).toBe(generation.id);
          expect(['type', 'import', 'call', 'schema', 'config', 'dependency']).toContain(failure.category);
          expect(['error', 'warning']).toContain(failure.severity);
          
          // Regex failures should have valid location information
          expect(failure.location.line).toBeGreaterThan(0);
          expect(failure.location.column).toBeGreaterThanOrEqual(0);
          expect(failure.location.file).toBe('generated_code');
        });
      }),
      { numRuns: 10 }
    );
  });

  it('should execute all baseline checks comprehensively', async () => {
    await fc.assert(
      fc.asyncProperty(generationArbitrary, async (generation: Generation) => {
        // Act
        const allFailures = await baselineChecker.runAllChecks(generation);
        
        // Assert - should always return an array
        expect(Array.isArray(allFailures)).toBe(true);
        
        // Should include results from all four baseline check types
        // Note: We don't assert that all methods are present since some may not find failures
        const detectionMethods = new Set(allFailures.map(f => f.detectedBy));
        // Verify detection methods are valid
        detectionMethods.forEach(method => {
          expect(['compile', 'test', 'sast', 'regex']).toContain(method);
        });
        
        // All failures should have valid detection methods
        allFailures.forEach(failure => {
          expect(['compile', 'test', 'sast', 'regex']).toContain(failure.detectedBy);
          expect(failure.generationId).toBe(generation.id);
          expect(['type', 'import', 'call', 'schema', 'config', 'dependency']).toContain(failure.category);
          expect(['error', 'warning']).toContain(failure.severity);
          expect(failure.description).toBeTruthy();
          expect(failure.location).toBeTruthy();
          expect(failure.location.file).toBeTruthy();
        });
        
        // Verify that runAllChecks includes results from individual methods
        const [compileFailures, testFailures, sastFailures, regexFailures] = await Promise.all([
          baselineChecker.runCompileCheck(generation),
          baselineChecker.runTestExecution(generation),
          baselineChecker.runSASTAnalysis(generation),
          baselineChecker.runRegexHeuristics(generation)
        ]);
        
        const expectedTotalFailures = compileFailures.length + testFailures.length + 
                                    sastFailures.length + regexFailures.length;
        
        // runAllChecks should return the same total number of failures
        expect(allFailures.length).toBe(expectedTotalFailures);
      }),
      { numRuns: 10 }
    );
  });

  it('should handle code with known patterns correctly', async () => {
    // Test specific code patterns that should trigger regex heuristics
    const codeWithIssues: Generation = {
      id: 'test-id',
      taskId: 'test-task',
      model: 'GPT-4o',
      promptStrategy: 'P1',
      contextFiles: [],
      generatedCode: `
        // TODO: Fix this later
        function test() {
          console.log("debug statement");
          let x = undefined;
          return x.toString();
        }
        
        class EmptyClass {
        }
      `,
      timestamp: new Date()
    };

    const failures = await baselineChecker.runRegexHeuristics(codeWithIssues);
    
    // Should detect multiple issues
    expect(failures.length).toBeGreaterThan(0);
    
    // Should detect TODO comment
    const todoFailure = failures.find(f => f.description.includes('TODO'));
    expect(todoFailure).toBeTruthy();
    
    // Should detect console.log
    const debugFailure = failures.find(f => f.description.includes('Debug statements'));
    expect(debugFailure).toBeTruthy();
    
    // Should detect undefined reference
    const undefinedFailure = failures.find(f => f.description.includes('null/undefined'));
    expect(undefinedFailure).toBeTruthy();
  });
});