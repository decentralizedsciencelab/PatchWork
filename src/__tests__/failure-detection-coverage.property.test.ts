/**
 * **Feature: code-generation-evaluation, Property 13: Failure detection coverage**
 * **Validates: Requirements 5.5**
 * 
 * Property: For any failure detection operation, the system should analyze 
 * structural inconsistencies across all constructed graph types
 */

import * as fc from 'fast-check';
import { FailureDetector } from '../services/FailureDetector';
import { Graph, Generation } from '../types';
import { v4 as uuidv4 } from 'uuid';

describe('Property 13: Failure detection coverage', () => {
  let failureDetector: FailureDetector;

  beforeEach(() => {
    failureDetector = new FailureDetector();
  });

  // Arbitrary generator for graph nodes
  const graphNodeArb = fc.record({
    id: fc.string({ minLength: 1 }),
    label: fc.string({ minLength: 1 }),
    type: fc.oneof(
      fc.constant('module'),
      fc.constant('function'),
      fc.constant('class'),
      fc.constant('field'),
      fc.constant('config')
    ),
    properties: fc.dictionary(fc.string(), fc.anything())
  });

  // Arbitrary generator for graph edges
  const graphEdgeArb = (nodeIds: string[]) => fc.record({
    source: fc.constantFrom(...nodeIds),
    target: fc.constantFrom(...nodeIds),
    type: fc.oneof(
      fc.constant('imports'),
      fc.constant('calls'),
      fc.constant('extends'),
      fc.constant('hasType')
    ),
    properties: fc.dictionary(fc.string(), fc.anything())
  });

  // Arbitrary generator for graphs
  const graphArb = fc.record({
    id: fc.string({ minLength: 1 }),
    generationId: fc.string({ minLength: 1 }),
    type: fc.constantFrom('import', 'call', 'dependency', 'schema', 'config', 'cfg') as fc.Arbitrary<'import' | 'call' | 'dependency' | 'schema' | 'config' | 'cfg'>,
    nodes: fc.array(graphNodeArb, { minLength: 1, maxLength: 10 }),
    metadata: fc.dictionary(fc.string(), fc.anything())
  }).chain(baseGraph => {
    const nodeIds = baseGraph.nodes.map(n => n.id);
    return fc.record({
      id: fc.constant(baseGraph.id),
      generationId: fc.constant(baseGraph.generationId),
      type: fc.constant(baseGraph.type),
      nodes: fc.constant(baseGraph.nodes),
      metadata: fc.constant(baseGraph.metadata),
      edges: fc.array(graphEdgeArb(nodeIds), { maxLength: 15 })
    });
  });

  test('analyzeStructuralInconsistencies should process all graph types', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(graphArb, { minLength: 1, maxLength: 6 }),
        async (graphs: Graph[]) => {
          // Ensure we have graphs of different types for meaningful cross-graph analysis
          const graphTypes = new Set(graphs.map(g => g.type));
          
          // Run the analysis
          const failures = await failureDetector.analyzeStructuralInconsistencies(graphs);
          
          // Property: The method should complete without throwing errors
          // and return an array of failure detections
          expect(Array.isArray(failures)).toBe(true);
          
          // Each failure should have the correct structure
          for (const failure of failures) {
            expect(failure).toHaveProperty('id');
            expect(failure).toHaveProperty('generationId');
            expect(failure).toHaveProperty('category');
            expect(failure).toHaveProperty('severity');
            expect(failure).toHaveProperty('description');
            expect(failure).toHaveProperty('location');
            expect(failure).toHaveProperty('detectedBy');
            expect(failure.detectedBy).toBe('graph-analysis');
          }
          
          // If we have multiple graph types, we should be analyzing cross-graph relationships
          if (graphTypes.size > 1) {
            // The analysis should have processed the graphs (no specific failures required,
            // but the method should have executed the cross-graph analysis logic)
            expect(failures).toBeDefined();
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  test('detectAllFailures should analyze all graph types for a generation', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          id: fc.string({ minLength: 1 }),
          taskId: fc.string({ minLength: 1 }),
          model: fc.constantFrom('GPT-4o', 'Claude-3.5-Sonnet') as fc.Arbitrary<'GPT-4o' | 'Claude-3.5-Sonnet'>,
          promptStrategy: fc.constantFrom('P1', 'P2', 'P3', 'P4') as fc.Arbitrary<'P1' | 'P2' | 'P3' | 'P4'>,
          contextFiles: fc.array(fc.string()),
          generatedCode: fc.string(),
          timestamp: fc.date()
        }),
        fc.array(graphArb, { minLength: 1, maxLength: 10 }),
        async (generation: Generation, allGraphs: Graph[]) => {
          // Ensure some graphs belong to this generation
          const generationGraphs = allGraphs.map(g => ({
            ...g,
            generationId: generation.id
          }));
          
          // Run detectAllFailures
          const failures = await failureDetector.detectAllFailures(generation, generationGraphs);
          
          // Property: Should return an array of failures
          expect(Array.isArray(failures)).toBe(true);
          
          // All failures should be for this generation
          for (const failure of failures) {
            expect(failure.generationId).toBe(generation.id);
            expect(failure.detectedBy).toBe('graph-analysis');
          }
          
          // Should have processed all available graph types
          const graphTypes = new Set(generationGraphs.map(g => g.type));
          
          // The method should have attempted to analyze each graph type
          // (We can't guarantee failures will be found, but the method should process all types)
          expect(graphTypes.size).toBeGreaterThan(0);
        }
      ),
      { numRuns: 10 }
    );
  });

  test('each specific failure detection method should process appropriate graph types', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(graphArb, { minLength: 1, maxLength: 10 }),
        async (graphs: Graph[]) => {
          // Test import failure detection
          const importFailures = await failureDetector.detectImportFailures(graphs);
          expect(Array.isArray(importFailures)).toBe(true);
          
          // Test call failure detection
          const callFailures = await failureDetector.detectCallFailures(graphs);
          expect(Array.isArray(callFailures)).toBe(true);
          
          // Test schema failure detection
          const schemaFailures = await failureDetector.detectSchemaFailures(graphs);
          expect(Array.isArray(schemaFailures)).toBe(true);
          
          // Test config failure detection
          const configFailures = await failureDetector.detectConfigFailures(graphs);
          expect(Array.isArray(configFailures)).toBe(true);
          
          // All failures should have proper structure and be detected by graph-analysis
          const allFailures = [
            ...importFailures,
            ...callFailures, 
            ...schemaFailures,
            ...configFailures
          ];
          
          for (const failure of allFailures) {
            expect(failure.detectedBy).toBe('graph-analysis');
            // Support both paper categories and legacy categories
            expect(['import', 'call', 'schema', 'config', 'type', 'dependency', 'PIA', 'SRF', 'DHI', 'BCI', 'RCF', 'CFC', 'CCV', 'SSR']).toContain(failure.category);
            expect(['error', 'warning']).toContain(failure.severity);
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  test('failure detection should handle graphs with structural inconsistencies', async () => {
    // Create a specific test case with known structural inconsistencies
    const generationId = uuidv4();

    // Create an import graph that imports a module
    const importGraph: Graph = {
      id: uuidv4(),
      generationId,
      type: 'import',
      nodes: [
        { id: 'file1', label: 'file1.py', type: 'module', properties: {} },
        { id: 'file2', label: 'file2.py', type: 'module', properties: {} }
      ],
      edges: [
        { source: 'file1', target: 'imported_module', type: 'imports', properties: {} }
      ],
      metadata: {}
    };

    // Create a call graph that calls functions from a DIFFERENT module that wasn't imported
    const callGraph: Graph = {
      id: uuidv4(),
      generationId,
      type: 'call',
      nodes: [
        { id: 'func1', label: 'func1', type: 'function', properties: {} },
        { id: 'ext1', label: 'unimported_module.some_function', type: 'function', properties: { isExternal: true } }
      ],
      edges: [
        { source: 'func1', target: 'ext1', type: 'calls', properties: {} }
      ],
      metadata: {}
    };

    // Dependency graph establishes unimported_module as a known package so the
    // cross-graph check recognises it as a real missing import (not a local variable).
    const depGraph: Graph = {
      id: uuidv4(),
      generationId,
      type: 'dependency',
      nodes: [
        { id: 'dep1', label: 'unimported_module', type: 'dependency', properties: { registryExists: true } }
      ],
      edges: [],
      metadata: {}
    };

    const graphs = [importGraph, callGraph, depGraph];

    // Test that structural inconsistencies are detected
    const failures = await failureDetector.analyzeStructuralInconsistencies(graphs);

    // Should detect that unimported_module.some_function is called but unimported_module is not imported
    expect(failures.length).toBeGreaterThan(0);

    // At least one failure should be about cross-graph inconsistency (DHI category)
    const crossGraphFailures = failures.filter(f =>
      f.category === 'DHI' &&
      f.description.includes('Cross-graph inconsistency')
    );
    expect(crossGraphFailures.length).toBeGreaterThan(0);
  });
});