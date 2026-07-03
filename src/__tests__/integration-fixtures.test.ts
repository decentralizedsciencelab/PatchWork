/**
 * Integration tests: Fixture code samples with planted failures.
 *
 * These tests verify that the FailureDetector correctly identifies structural
 * failures when provided with graphs built from realistic code snippets.
 *
 * Strategy:
 *   - For graph types that the regex-based GraphConstructor can build (import,
 *     call, dependency, schema, config, cfg), we use GraphConstructor directly
 *     since it requires no external tools.
 *   - For detection categories that depend on specific graph structures (e.g.
 *     resource, routing, CCV field-name mismatch, DHI registry validation),
 *     we build graphs manually to ensure deterministic detection.
 *
 * Note: The regex-based GraphConstructor creates dependency nodes for ALL
 * imports, which means import-vs-dependency mismatches (DHI) will not fire
 * from regex-only graphs. DHI tests therefore use manually constructed graphs
 * or augmented dependency graphs with registryExists: false.
 */

import { FailureDetector } from '../services/FailureDetector';
import { GraphConstructor } from '../services/GraphConstructor';
import { Generation, Graph, GraphNode } from '../types';
import { GraphModel, GraphNodeModel, GraphEdgeModel } from '../models/Graph';
import { v4 as uuidv4 } from 'uuid';

import {
  FIXTURE_PIA_PHANTOM_IMPORT,
  FIXTURE_DHI_MISSING_DEPENDENCY,
  FIXTURE_CCV_NAMING_MISMATCH,
  FIXTURE_SSR_UNGUARDED_ROUTE,
  FIXTURE_COMBINED_FAILURES,
} from '../../test/fixtures/code-with-failures';

import {
  CLEAN_PYTHON_STDLIB,
  CLEAN_TYPESCRIPT_PROPER,
  CLEAN_PYTHON_FASTAPI,
  ALL_CLEAN_FIXTURES,
} from '../../test/fixtures/code-clean';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeGeneration(code: string, id?: string): Generation {
  return {
    id: id ?? uuidv4(),
    taskId: uuidv4(),
    model: 'GPT-4o',
    promptStrategy: 'P1',
    contextFiles: [],
    generatedCode: code,
    timestamp: new Date(),
  };
}

// ── Test Suites ──────────────────────────────────────────────────────────────

describe('Integration Tests: Fixture-based Failure Detection', () => {
  let detector: FailureDetector;
  let graphConstructor: GraphConstructor;

  beforeEach(() => {
    detector = new FailureDetector();
    graphConstructor = new GraphConstructor();
  });

  // ─── PIA Tests ───────────────────────────────────────────────────────────

  describe('PIA (Phantom Import/API)', () => {
    test('should detect PIA when import graph has dangling edge targets', async () => {
      const genId = uuidv4();

      const moduleNodeId = uuidv4();
      const importGraph: Graph = new GraphModel(
        uuidv4(), genId, 'import',
        [
          new GraphNodeModel(moduleNodeId, 'foo', 'module', { importType: 'direct', line: 1 }),
        ],
        [
          // Edge target 'nonexistent_id' does not exist as a node
          new GraphEdgeModel(moduleNodeId, 'nonexistent_id', 'imports', {}),
        ],
        { language: 'Python' }
      );

      const failures = await detector.detectImportFailures([importGraph]);
      expect(failures.length).toBeGreaterThanOrEqual(1);
      expect(failures[0]!.category).toBe('PIA');
      expect(failures[0]!.description).toContain('referenced but not defined');
    });

    test('should detect PIA via circular dependency in import graph', async () => {
      const genId = uuidv4();
      const nodeA = uuidv4();
      const nodeB = uuidv4();

      const importGraph: Graph = new GraphModel(
        uuidv4(), genId, 'import',
        [
          new GraphNodeModel(nodeA, 'module_a', 'module', {}),
          new GraphNodeModel(nodeB, 'module_b', 'module', {}),
        ],
        [
          // Circular: A -> B -> A
          new GraphEdgeModel(nodeA, nodeB, 'imports', {}),
          new GraphEdgeModel(nodeB, nodeA, 'imports', {}),
        ],
        {}
      );

      const failures = await detector.detectImportFailures([importGraph]);
      const circularFailures = failures.filter(f =>
        f.category === 'PIA' && f.description.includes('Circular')
      );
      expect(circularFailures.length).toBeGreaterThanOrEqual(1);
    });

    test('should detect DHI when importing nonexistent modules via manual graph', async () => {
      // The regex-based GraphConstructor creates dependency nodes for all imports.
      // To test DHI, we manually construct an import graph with modules that
      // do NOT appear in the dependency graph.
      const genId = uuidv4();
      const generation = makeGeneration(FIXTURE_PIA_PHANTOM_IMPORT.code, genId);

      const phantomModId = uuidv4();
      const nonexistentId = uuidv4();
      const collectionsId = uuidv4();

      const importGraph: Graph = new GraphModel(
        uuidv4(), genId, 'import',
        [
          new GraphNodeModel(phantomModId, 'phantom_module', 'module', { line: 2 }),
          new GraphNodeModel(nonexistentId, 'nonexistent_pkg', 'module', { line: 4 }),
          new GraphNodeModel(collectionsId, 'collections', 'module', { line: 3 }),
        ],
        [],
        {}
      );

      // Dependency graph only declares collections (stdlib)
      const depGraph: Graph = new GraphModel(
        uuidv4(), genId, 'dependency',
        [
          new GraphNodeModel(uuidv4(), 'collections', 'dependency', { ecosystem: 'pip' }),
        ],
        [],
        {}
      );

      const failures = await detector.detectDependencyFailures(generation, [importGraph, depGraph]);
      const dhiFailures = failures.filter(f => f.category === 'DHI');
      expect(dhiFailures.length).toBeGreaterThanOrEqual(1);

      const mentionsFake = dhiFailures.some(
        f => f.description.includes('phantom_module') ||
             f.description.includes('nonexistent_pkg')
      );
      expect(mentionsFake).toBe(true);
    });
  });

  // ─── SRF Tests ───────────────────────────────────────────────────────────

  describe('SRF (Schema/Resource/Return Failures)', () => {
    test('should detect SRF when call graph has edges to missing node IDs', async () => {
      const genId = uuidv4();

      const funcId = uuidv4();
      const callGraph: Graph = new GraphModel(
        uuidv4(), genId, 'call',
        [
          new GraphNodeModel(funcId, 'main', 'function', { line: 1 }),
        ],
        [
          // Edge target points to a non-existent node ID
          new GraphEdgeModel(funcId, 'deleted_function_node_id', 'calls', {}),
        ],
        { language: 'Python' }
      );

      const failures = await detector.detectCallFailures([callGraph]);
      expect(failures.length).toBeGreaterThanOrEqual(1);
      expect(failures[0]!.category).toBe('SRF');
      expect(failures[0]!.description).toContain('Undefined function call');
    });

    test('should detect signature mismatch when edge has argument/parameter data', async () => {
      const genId = uuidv4();

      const callerId = uuidv4();
      const calleeId = uuidv4();
      const callGraph: Graph = new GraphModel(
        uuidv4(), genId, 'call',
        [
          new GraphNodeModel(callerId, 'caller_func', 'function', { line: 1 }),
          new GraphNodeModel(calleeId, 'target_func', 'function', { line: 5 }),
        ],
        [
          new GraphEdgeModel(callerId, calleeId, 'calls', {
            arguments: ['a', 'b', 'c'],
            expectedParameters: ['x', 'y'],
          }),
        ],
        { language: 'Python' }
      );

      const failures = await detector.detectCallFailures([callGraph]);
      const sigFailures = failures.filter(f =>
        f.category === 'SRF' && f.description.includes('Signature mismatch')
      );
      expect(sigFailures.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── DHI Tests ───────────────────────────────────────────────────────────

  describe('DHI (Dependency Hallucination)', () => {
    test('should detect DHI when package has registryExists: false', async () => {
      const genId = uuidv4();
      const generation = makeGeneration(FIXTURE_DHI_MISSING_DEPENDENCY.code, genId);

      // Build import and dependency graphs; manually mark a dependency as not found
      const importGraph = await graphConstructor.buildImportGraph(generation);
      const depGraph = await graphConstructor.buildDependencyGraph(generation);

      // Manually add a dependency node marked as not in registry
      depGraph.nodes.push(
        new GraphNodeModel(uuidv4(), 'fake_analytics_sdk', 'dependency', {
          ecosystem: 'pip',
          type: 'inferred',
          registryExists: false,
        })
      );

      // Set all graph generationIds to match
      (importGraph as GraphModel).generationId = genId;
      (depGraph as GraphModel).generationId = genId;

      const failures = await detector.detectDependencyFailures(generation, [importGraph, depGraph]);

      const registryFailures = failures.filter(f =>
        f.category === 'DHI' && f.description.includes('not found')
      );
      expect(registryFailures.length).toBeGreaterThanOrEqual(1);
      expect(registryFailures.some(f => f.description.includes('fake_analytics_sdk'))).toBe(true);
    });

    test('should detect DHI for missing dependency via manual import/dependency graph mismatch', async () => {
      const genId = uuidv4();
      const generation = makeGeneration(FIXTURE_DHI_MISSING_DEPENDENCY.code, genId);

      // Import graph has modules that the dependency graph does NOT include
      const importGraph: Graph = new GraphModel(
        uuidv4(), genId, 'import',
        [
          new GraphNodeModel(uuidv4(), 'fastapi', 'module', { line: 1 }),
          new GraphNodeModel(uuidv4(), 'pydantic', 'module', { line: 2 }),
          new GraphNodeModel(uuidv4(), 'fake_analytics_sdk', 'module', { line: 3 }),
          new GraphNodeModel(uuidv4(), 'totally_made_up_package', 'module', { line: 4 }),
        ],
        [],
        {}
      );

      // Dependency graph only declares fastapi and pydantic
      const depGraph: Graph = new GraphModel(
        uuidv4(), genId, 'dependency',
        [
          new GraphNodeModel(uuidv4(), 'fastapi', 'dependency', { ecosystem: 'pip' }),
          new GraphNodeModel(uuidv4(), 'pydantic', 'dependency', { ecosystem: 'pip' }),
        ],
        [],
        {}
      );

      const failures = await detector.detectDependencyFailures(generation, [importGraph, depGraph]);
      const dhiFailures = failures.filter(f => f.category === 'DHI');
      expect(dhiFailures.length).toBeGreaterThanOrEqual(2);
      expect(dhiFailures.some(f => f.description.includes('fake_analytics_sdk'))).toBe(true);
      expect(dhiFailures.some(f => f.description.includes('totally_made_up_package'))).toBe(true);
    });

    test('should detect cross-graph inconsistency when called function module is not imported', async () => {
      const genId = uuidv4();

      const importGraph: Graph = new GraphModel(
        uuidv4(), genId, 'import',
        [
          new GraphNodeModel(uuidv4(), 'os', 'module', {}),
        ],
        [],
        {}
      );

      // Dependency graph establishes missing_lib as a known package so the
      // cross-graph check recognises it as a real missing import (not a local variable).
      const depGraph: Graph = new GraphModel(
        uuidv4(), genId, 'dependency',
        [
          new GraphNodeModel(uuidv4(), 'missing_lib', 'dependency', { registryExists: true }),
        ],
        [],
        {}
      );

      const funcId = uuidv4();
      const extId = uuidv4();
      const callGraph: Graph = new GraphModel(
        uuidv4(), genId, 'call',
        [
          new GraphNodeModel(funcId, 'main', 'function', {}),
          new GraphNodeModel(extId, 'missing_lib.do_stuff', 'function', { isExternal: true }),
        ],
        [
          new GraphEdgeModel(funcId, extId, 'calls', {}),
        ],
        {}
      );

      const failures = await detector.analyzeStructuralInconsistencies([importGraph, callGraph, depGraph]);
      const crossGraphFailures = failures.filter(f =>
        f.category === 'DHI' && f.description.includes('Cross-graph')
      );
      expect(crossGraphFailures.length).toBeGreaterThanOrEqual(1);
      expect(crossGraphFailures[0]!.description).toContain('missing_lib');
    });
  });

  // ─── BCI Tests ───────────────────────────────────────────────────────────

  describe('BCI (Build/Configuration Incoherence)', () => {
    test('should detect BCI for config nodes with no value', async () => {
      const genId = uuidv4();

      const configGraph: Graph = new GraphModel(
        uuidv4(), genId, 'config',
        [
          new GraphNodeModel(uuidv4(), 'DATABASE_URL', 'config', {
            value: undefined,
            type: 'configuration',
            line: 3,
          }),
          new GraphNodeModel(uuidv4(), 'DEBUG', 'config', {
            value: 'true',
            expectedType: 'bool',
            type: 'configuration',
            line: 5,
          }),
        ],
        [],
        {}
      );

      const failures = await detector.detectConfigFailures([configGraph]);
      const bciFailures = failures.filter(f => f.category === 'BCI');
      expect(bciFailures.length).toBeGreaterThanOrEqual(1);

      // DATABASE_URL has no value
      expect(bciFailures.some(f => f.description.includes('DATABASE_URL'))).toBe(true);
    });

    test('should detect BCI for type mismatch (int expected, string given)', async () => {
      const genId = uuidv4();

      const configGraph: Graph = new GraphModel(
        uuidv4(), genId, 'config',
        [
          new GraphNodeModel(uuidv4(), 'MAX_RETRIES', 'config', {
            value: 'not_a_number',
            expectedType: 'int',
            type: 'configuration',
            line: 7,
          }),
        ],
        [],
        {}
      );

      const failures = await detector.detectConfigFailures([configGraph]);
      const typeFailures = failures.filter(f =>
        f.category === 'BCI' && f.description.includes('expects')
      );
      expect(typeFailures.length).toBeGreaterThanOrEqual(1);
    });

    test('should detect BCI for invalid URL config', async () => {
      const genId = uuidv4();

      const configGraph: Graph = new GraphModel(
        uuidv4(), genId, 'config',
        [
          new GraphNodeModel(uuidv4(), 'API_ENDPOINT', 'config', {
            value: 'not-a-valid-url',
            expectedType: 'url',
            type: 'configuration',
            line: 2,
          }),
        ],
        [],
        {}
      );

      const failures = await detector.detectConfigFailures([configGraph]);
      const invalidConfig = failures.filter(f =>
        f.category === 'BCI' && f.description.includes('invalid value')
      );
      expect(invalidConfig.length).toBeGreaterThanOrEqual(1);
    });

    test('should NOT flag required dataclass fields with type annotation but no default', async () => {
      const genId = uuidv4();

      const configGraph: Graph = new GraphModel(
        uuidv4(), genId, 'config',
        [
          // Required field: db_type: str (has expectedType, no value) → skip
          new GraphNodeModel(uuidv4(), 'db_type', 'config', {
            value: undefined,
            expectedType: 'str',
            type: 'configuration',
            source: 'DatabaseConfig',
            line: 23,
          }),
          // Required field: secret_key: str → skip
          new GraphNodeModel(uuidv4(), 'secret_key', 'config', {
            value: undefined,
            expectedType: 'str',
            type: 'configuration',
            source: 'AuthConfig',
            line: 77,
          }),
          // Config with no type AND no value → should still be flagged
          new GraphNodeModel(uuidv4(), 'MISSING_KEY', 'config', {
            value: undefined,
            type: 'configuration',
            line: 99,
          }),
        ],
        [],
        {}
      );

      const failures = await detector.detectConfigFailures([configGraph]);
      const bciFailures = failures.filter(f =>
        f.category === 'BCI' && f.description.includes('no value set')
      );
      // Only MISSING_KEY should be flagged, not db_type or secret_key
      expect(bciFailures.length).toBe(1);
      expect(bciFailures[0]!.description).toContain('MISSING_KEY');
    });
  });

  // ─── BCI Unsafe Access Detection Tests ─────────────────────────────────

  describe('BCI Unsafe Access Detection', () => {
    test('should flag os.environ["KEY"] (hard subscript) without safety context', async () => {
      const genId = uuidv4();

      const configGraph: Graph = new GraphModel(
        uuidv4(), genId, 'config',
        [
          new GraphNodeModel(uuidv4(), 'DATABASE_URL', 'environment', {
            type: 'environment-variable',
            accessMethod: 'subscript',
            line: 5,
            safetyContext: null,
          }),
        ],
        [],
        {}
      );

      const failures = await detector.detectConfigFailures([configGraph]);
      const bciFailures = failures.filter(f => f.category === 'BCI');
      expect(bciFailures.length).toBe(1);
      expect(bciFailures[0]!.description).toContain('DATABASE_URL');
      expect(bciFailures[0]!.description).toContain('Unguarded');
      expect(bciFailures[0]!.severity).toBe('error');
    });

    test('should NOT flag env var with hasDefault: true (legacy node)', async () => {
      const genId = uuidv4();

      const configGraph: Graph = new GraphModel(
        uuidv4(), genId, 'config',
        [
          new GraphNodeModel(uuidv4(), 'SECRET_KEY', 'environment', {
            type: 'environment-variable',
            hasDefault: true,
          }),
        ],
        [],
        {}
      );

      const failures = await detector.detectConfigFailures([configGraph]);
      const bciFailures = failures.filter(f => f.category === 'BCI');
      expect(bciFailures.length).toBe(0);
    });

    test('should NOT flag os.environ["KEY"] inside try/except', async () => {
      const genId = uuidv4();

      const configGraph: Graph = new GraphModel(
        uuidv4(), genId, 'config',
        [
          new GraphNodeModel(uuidv4(), 'DATABASE_URL', 'environment', {
            type: 'environment-variable',
            accessMethod: 'subscript',
            line: 8,
            safetyContext: 'try_except',
          }),
        ],
        [],
        {}
      );

      const failures = await detector.detectConfigFailures([configGraph]);
      const bciFailures = failures.filter(f => f.category === 'BCI');
      expect(bciFailures.length).toBe(0);
    });

    test('should NOT flag env var with guard_check safety context', async () => {
      const genId = uuidv4();

      const configGraph: Graph = new GraphModel(
        uuidv4(), genId, 'config',
        [
          new GraphNodeModel(uuidv4(), 'API_KEY', 'environment', {
            type: 'environment-variable',
            accessMethod: 'subscript',
            line: 12,
            safetyContext: 'guard_check',
          }),
        ],
        [],
        {}
      );

      const failures = await detector.detectConfigFailures([configGraph]);
      const bciFailures = failures.filter(f => f.category === 'BCI');
      expect(bciFailures.length).toBe(0);
    });

    test('should flag process.env.KEY! (non_null_assertion) without safety', async () => {
      const genId = uuidv4();

      const configGraph: Graph = new GraphModel(
        uuidv4(), genId, 'config',
        [
          new GraphNodeModel(uuidv4(), 'JWT_SECRET', 'environment', {
            type: 'environment-variable',
            accessMethod: 'non_null_assertion',
            line: 3,
            safetyContext: null,
          }),
        ],
        [],
        {}
      );

      const failures = await detector.detectConfigFailures([configGraph]);
      const bciFailures = failures.filter(f => f.category === 'BCI');
      expect(bciFailures.length).toBe(1);
      expect(bciFailures[0]!.description).toContain('JWT_SECRET');
      expect(bciFailures[0]!.severity).toBe('error');
    });

    test('should flag dot_access and getenv_no_default but not safe patterns', async () => {
      const genId = uuidv4();

      const configGraph: Graph = new GraphModel(
        uuidv4(), genId, 'config',
        [
          // Unsafe: bare dot access
          new GraphNodeModel(uuidv4(), 'REDIS_URL', 'environment', {
            type: 'environment-variable',
            accessMethod: 'dot_access',
            line: 1,
            safetyContext: null,
          }),
          // Unsafe: getenv without default
          new GraphNodeModel(uuidv4(), 'CACHE_HOST', 'environment', {
            type: 'environment-variable',
            accessMethod: 'getenv_no_default',
            line: 2,
            safetyContext: null,
          }),
          // Safe: has try_catch safety context
          new GraphNodeModel(uuidv4(), 'OPTIONAL_KEY', 'environment', {
            type: 'environment-variable',
            accessMethod: 'dot_access',
            line: 10,
            safetyContext: 'try_catch',
          }),
        ],
        [],
        {}
      );

      const failures = await detector.detectConfigFailures([configGraph]);
      const bciFailures = failures.filter(f => f.category === 'BCI');
      expect(bciFailures.length).toBe(2);
      expect(bciFailures.some(f => f.description.includes('REDIS_URL'))).toBe(true);
      expect(bciFailures.some(f => f.description.includes('CACHE_HOST'))).toBe(true);
      expect(bciFailures.some(f => f.description.includes('OPTIONAL_KEY'))).toBe(false);
    });
  });

  // ─── RCF Tests ───────────────────────────────────────────────────────────

  describe('RCF (Resource Coherence Failures)', () => {
    test('should detect RCF for unusual template path without standard extension', async () => {
      const genId = uuidv4();
      const generation = makeGeneration('', genId);

      const resourceGraph: Graph = new GraphModel(
        uuidv4(), genId, 'resource',
        [
          new GraphNodeModel(uuidv4(), 'generated_code', 'source_file', { language: 'Python' }),
          new GraphNodeModel(uuidv4(), 'dashboard.pyc', 'resource_reference', {
            resourceType: 'template',
            line: 9,
          }),
        ],
        [],
        {}
      );

      const failures = await detector.detectResourceFailures(generation, [resourceGraph]);
      const templateFailures = failures.filter(f =>
        f.category === 'RCF' && f.description.toLowerCase().includes('template')
      );
      expect(templateFailures.length).toBeGreaterThanOrEqual(1);
    });

    test('should detect RCF for suspicious directory traversal in resource paths', async () => {
      const genId = uuidv4();
      const generation = makeGeneration('', genId);

      const resourceGraph: Graph = new GraphModel(
        uuidv4(), genId, 'resource',
        [
          new GraphNodeModel(uuidv4(), 'generated_code', 'source_file', { language: 'Python' }),
          new GraphNodeModel(uuidv4(), '../../etc/passwd', 'resource_reference', {
            resourceType: 'file',
            line: 12,
          }),
        ],
        [],
        {}
      );

      const failures = await detector.detectResourceFailures(generation, [resourceGraph]);
      const traversalFailures = failures.filter(f =>
        f.category === 'RCF' && f.description.toLowerCase().includes('traversal')
      );
      expect(traversalFailures.length).toBeGreaterThanOrEqual(1);
    });

    test('should detect RCF for missing return path in function with return type', async () => {
      const genId = uuidv4();
      const generation = makeGeneration('', genId);

      const funcId = uuidv4();
      const condId = uuidv4();

      const cfgGraph: Graph = new GraphModel(
        uuidv4(), genId, 'cfg',
        [
          new GraphNodeModel(funcId, 'calculate', 'function', {
            line: 1,
            hasReturnType: true,
            isAsync: false,
          }),
          new GraphNodeModel(condId, 'if', 'conditional', {
            line: 2,
            functionScope: funcId,
          }),
        ],
        [
          // Only edge from function to conditional, no return path
          new GraphEdgeModel(funcId, condId, 'control-flow', {}),
        ],
        {}
      );

      const failures = await detector.detectReturnFailures(generation, [cfgGraph]);
      const rcfFailures = failures.filter(f =>
        f.category === 'RCF' && f.description.includes('Missing return')
      );
      expect(rcfFailures.length).toBeGreaterThanOrEqual(1);
    });

    test('should detect RCF for missing resource flagged as non-existent', async () => {
      const genId = uuidv4();
      const generation = makeGeneration('', genId);

      const resourceGraph: Graph = new GraphModel(
        uuidv4(), genId, 'resource',
        [
          new GraphNodeModel(uuidv4(), 'generated_code', 'source_file', {}),
          new GraphNodeModel(uuidv4(), 'missing_data.csv', 'resource_reference', {
            resourceType: 'file',
            line: 5,
            exists: false,
          }),
        ],
        [],
        {}
      );

      const failures = await detector.detectResourceFailures(generation, [resourceGraph]);
      const missingResource = failures.filter(f =>
        f.category === 'RCF' && f.description.includes('Missing resource')
      );
      expect(missingResource.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── CFC Tests ───────────────────────────────────────────────────────────

  describe('CFC (Control Flow Coherence) - Tool-Based Detection', () => {
    // CFC detection now uses pylint (Python) and ESLint (TypeScript) instead
    // of custom graph-based BFS. Tests check the tool wrapper integration.
    // If pylint/ESLint are not installed, detection gracefully returns [].

    let pylintAvailable: boolean;

    beforeAll(() => {
      try {
        require('child_process').execSync('pylint --version', {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 10000,
        });
        pylintAvailable = true;
      } catch {
        pylintAvailable = false;
      }
    });

    test('should detect unreachable code in Python via pylint', async () => {
      if (!pylintAvailable) {
        // Skip if pylint is not installed — not a test failure
        return;
      }

      const code = `
def calculate_discount(price):
    return price * 0.9
    print("This is unreachable")
    x = price * 2
`;
      const generation = makeGeneration(code);
      const failures = await detector.detectCFCFailures(generation);
      const cfcFailures = failures.filter(f => f.category === 'CFC');

      // pylint W0101 should flag the unreachable print and assignment
      expect(cfcFailures.length).toBeGreaterThanOrEqual(1);
      expect(cfcFailures[0]!.description).toContain('unreachable');
      expect(cfcFailures[0]!.detectedBy).toBe('sast');
    });

    test('should not flag reachable code in Python', async () => {
      if (!pylintAvailable) {
        return;
      }

      const code = `
def process(data):
    if data:
        return data
    return None
`;
      const generation = makeGeneration(code);
      const failures = await detector.detectCFCFailures(generation);
      const cfcFailures = failures.filter(f => f.category === 'CFC');
      expect(cfcFailures.length).toBe(0);
    });

    test('should not flag code after yield in generator', async () => {
      if (!pylintAvailable) {
        return;
      }

      const code = `
def gen_items(items):
    for item in items:
        yield item
    print("Generator exhausted")
`;
      const generation = makeGeneration(code);
      const failures = await detector.detectCFCFailures(generation);
      const cfcFailures = failures.filter(f => f.category === 'CFC');
      expect(cfcFailures.length).toBe(0);
    });

    test('should not flag code in try/except where only try branch returns', async () => {
      if (!pylintAvailable) {
        return;
      }

      const code = `
def safe_parse(data):
    try:
        return int(data)
    except ValueError:
        pass
    return -1
`;
      const generation = makeGeneration(code);
      const failures = await detector.detectCFCFailures(generation);
      const cfcFailures = failures.filter(f => f.category === 'CFC');
      expect(cfcFailures.length).toBe(0);
    });

    test('should gracefully return empty when tool is not available', async () => {
      // Even with valid code, if tool path is wrong, should return []
      // The real test: empty code should produce no findings
      const generation = makeGeneration('');
      const failures = await detector.detectCFCFailures(generation);
      expect(failures.length).toBe(0);
    });
  });

  // ─── CCV Tests ───────────────────────────────────────────────────────────

  describe('CCV (Cross-file Contract Violations)', () => {
    test('should detect CCV for field name convention mismatch across related models', async () => {
      const genId = uuidv4();
      const generation = makeGeneration(FIXTURE_CCV_NAMING_MISMATCH.code, genId);

      const requestId = uuidv4();
      const responseId = uuidv4();
      const field1Id = uuidv4();
      const field2Id = uuidv4();
      const field3Id = uuidv4();
      const field4Id = uuidv4();

      const schemaGraph: Graph = new GraphModel(
        uuidv4(), genId, 'schema',
        [
          new GraphNodeModel(requestId, 'UserRequest', 'model', { line: 1, framework: 'interface' }),
          new GraphNodeModel(field1Id, 'first_name', 'field', { dataType: 'string', line: 2 }),
          new GraphNodeModel(field2Id, 'last_name', 'field', { dataType: 'string', line: 3 }),
          new GraphNodeModel(responseId, 'UserResponse', 'model', { line: 8, framework: 'interface' }),
          new GraphNodeModel(field3Id, 'firstName', 'field', { dataType: 'string', line: 9 }),
          new GraphNodeModel(field4Id, 'lastName', 'field', { dataType: 'string', line: 10 }),
        ],
        [
          new GraphEdgeModel(requestId, field1Id, 'hasType', {}),
          new GraphEdgeModel(requestId, field2Id, 'hasType', {}),
          new GraphEdgeModel(responseId, field3Id, 'hasType', {}),
          new GraphEdgeModel(responseId, field4Id, 'hasType', {}),
        ],
        {}
      );

      const callGraph: Graph = new GraphModel(
        uuidv4(), genId, 'call', [], [], {}
      );

      const failures = await detector.detectCrossCuttingViolations(
        generation,
        [callGraph, schemaGraph]
      );

      const ccvFailures = failures.filter(f =>
        f.category === 'CCV' && f.description.includes('convention mismatch')
      );
      expect(ccvFailures.length).toBeGreaterThanOrEqual(1);
      expect(ccvFailures[0]!.description).toContain('UserRequest');
      expect(ccvFailures[0]!.description).toContain('UserResponse');
    });

    test('should detect CCV for disconnected middleware', async () => {
      const genId = uuidv4();
      const generation = makeGeneration('', genId);

      const callGraph: Graph = new GraphModel(
        uuidv4(), genId, 'call',
        [
          new GraphNodeModel(uuidv4(), 'authMiddleware', 'middleware', { line: 5 }),
        ],
        [],
        {}
      );

      const failures = await detector.detectCrossCuttingViolations(generation, [callGraph]);
      const disconnectedMw = failures.filter(f =>
        f.category === 'CCV' && f.description.includes('Disconnected middleware')
      );
      expect(disconnectedMw.length).toBeGreaterThanOrEqual(1);
    });

    test('should detect CCV for individual field name casing mismatch (user_id vs userId)', async () => {
      const genId = uuidv4();
      const generation = makeGeneration('', genId);

      const pyModelId = uuidv4();
      const tsModelId = uuidv4();
      const f1 = uuidv4();
      const f2 = uuidv4();
      const f3 = uuidv4();
      const f4 = uuidv4();

      const schemaGraph: Graph = new GraphModel(
        uuidv4(), genId, 'schema',
        [
          new GraphNodeModel(pyModelId, 'UserResponse', 'model', { line: 1 }),
          new GraphNodeModel(f1, 'user_id', 'field', { dataType: 'int', line: 2 }),
          new GraphNodeModel(f2, 'display_name', 'field', { dataType: 'str', line: 3 }),
          new GraphNodeModel(tsModelId, 'UserDTO', 'model', { line: 10 }),
          new GraphNodeModel(f3, 'userId', 'field', { dataType: 'number', line: 11 }),
          new GraphNodeModel(f4, 'displayName', 'field', { dataType: 'string', line: 12 }),
        ],
        [
          new GraphEdgeModel(pyModelId, f1, 'hasType', {}),
          new GraphEdgeModel(pyModelId, f2, 'hasType', {}),
          new GraphEdgeModel(tsModelId, f3, 'hasType', {}),
          new GraphEdgeModel(tsModelId, f4, 'hasType', {}),
        ],
        {}
      );

      const callGraph: Graph = new GraphModel(uuidv4(), genId, 'call', [], [], {});

      const failures = await detector.detectCrossCuttingViolations(
        generation,
        [callGraph, schemaGraph]
      );

      // Should detect individual field mismatches (user_id vs userId, display_name vs displayName)
      const fieldMismatches = failures.filter(f =>
        f.category === 'CCV' && f.description.includes('Field name mismatch')
      );
      expect(fieldMismatches.length).toBeGreaterThanOrEqual(1);
      expect(fieldMismatches.some(f => f.description.includes('user_id') && f.description.includes('userId'))).toBe(true);
    });

    test('should not detect CCV when models use consistent naming', async () => {
      const genId = uuidv4();
      const generation = makeGeneration('', genId);

      const reqId = uuidv4();
      const resId = uuidv4();
      const f1 = uuidv4();
      const f2 = uuidv4();
      const f3 = uuidv4();
      const f4 = uuidv4();

      const schemaGraph: Graph = new GraphModel(
        uuidv4(), genId, 'schema',
        [
          new GraphNodeModel(reqId, 'ItemRequest', 'model', { line: 1 }),
          new GraphNodeModel(f1, 'item_name', 'field', { dataType: 'string', line: 2 }),
          new GraphNodeModel(f2, 'item_price', 'field', { dataType: 'number', line: 3 }),
          new GraphNodeModel(resId, 'ItemResponse', 'model', { line: 5 }),
          new GraphNodeModel(f3, 'item_name', 'field', { dataType: 'string', line: 6 }),
          new GraphNodeModel(f4, 'item_price', 'field', { dataType: 'number', line: 7 }),
        ],
        [
          new GraphEdgeModel(reqId, f1, 'hasType', {}),
          new GraphEdgeModel(reqId, f2, 'hasType', {}),
          new GraphEdgeModel(resId, f3, 'hasType', {}),
          new GraphEdgeModel(resId, f4, 'hasType', {}),
        ],
        {}
      );

      const callGraph: Graph = new GraphModel(uuidv4(), genId, 'call', [], [], {});

      const failures = await detector.detectCrossCuttingViolations(generation, [callGraph, schemaGraph]);
      const namingFailures = failures.filter(f =>
        f.category === 'CCV' && f.description.includes('convention mismatch')
      );
      expect(namingFailures.length).toBe(0);
    });
  });

  // ─── SSR Tests ───────────────────────────────────────────────────────────

  describe('SSR (Security Structural Regressions) — Resource-Clustered Auth', () => {
    // Helper: build N guarded routes for a resource + unguarded deviants
    function buildClusterRoutes(genId: string, resource: string, guardedCount: number, unguardedRoutes: Array<{method: string; path: string; line: number}>): Graph {
      const nodes: GraphNode[] = [];
      const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
      for (let i = 0; i < guardedCount; i++) {
        nodes.push(new GraphNodeModel(uuidv4(), `/${resource}/${i === 0 ? '' : 'sub' + i}`, 'route', {
          method: methods[i % methods.length], line: 10 + i * 4, hasAuth: true, guards: ['get_current_user'],
        }));
      }
      for (const route of unguardedRoutes) {
        nodes.push(new GraphNodeModel(uuidv4(), route.path, 'route', {
          method: route.method, line: route.line, hasAuth: false, guards: [],
        }));
      }
      return new GraphModel(uuidv4(), genId, 'routing', nodes, [], {});
    }

    test('should flag deviant route in cluster with 90%+ auth (10 routes, 1 deviant)', async () => {
      const genId = uuidv4();
      const generation = makeGeneration(FIXTURE_SSR_UNGUARDED_ROUTE.code, genId);

      // 9 guarded + 1 unguarded in /users/* cluster = 90%
      const routingGraph = buildClusterRoutes(genId, 'users', 9, [
        { method: 'POST', path: '/users/import', line: 67 },
      ]);

      const failures = await detector.detectRoutingFailures(generation, [routingGraph]);
      const ssrFailures = failures.filter(f => f.category === 'SSR');
      expect(ssrFailures.length).toBe(1);
      expect(ssrFailures[0]!.description).toContain('get_current_user');
      expect(ssrFailures[0]!.description).toContain('9/10');
      expect(ssrFailures[0]!.description).toContain('/users/');
      // POST is destructive → error severity
      expect(ssrFailures[0]!.severity).toBe('error');
    });

    test('should not flag when cluster is below 90% threshold', async () => {
      const genId = uuidv4();
      const generation = makeGeneration('', genId);

      // 6 guarded + 4 unguarded in /orders/* cluster = 60%
      const nodes: GraphNode[] = [];
      for (let i = 0; i < 6; i++) {
        nodes.push(new GraphNodeModel(uuidv4(), `/orders/route${i}`, 'route', {
          method: 'GET', line: i * 4, hasAuth: true, guards: ['auth'],
        }));
      }
      for (let i = 0; i < 4; i++) {
        nodes.push(new GraphNodeModel(uuidv4(), `/orders/open${i}`, 'route', {
          method: 'GET', line: 50 + i * 4, hasAuth: false, guards: [],
        }));
      }
      const routingGraph = new GraphModel(uuidv4(), genId, 'routing', nodes, [], {});

      const failures = await detector.detectRoutingFailures(generation, [routingGraph]);
      const ssrFailures = failures.filter(f => f.category === 'SSR');
      expect(ssrFailures.length).toBe(0);
    });

    test('should not flag clusters smaller than 4 routes', async () => {
      const genId = uuidv4();
      const generation = makeGeneration('', genId);

      // 3 routes in /users cluster — below min size
      // Plus 2 routes in /items to reach total >= 4 (so the graph isn't skipped)
      const nodes: GraphNode[] = [
        new GraphNodeModel(uuidv4(), '/users', 'route', { method: 'GET', line: 1, hasAuth: true, guards: ['auth'] }),
        new GraphNodeModel(uuidv4(), '/users/create', 'route', { method: 'POST', line: 5, hasAuth: true, guards: ['auth'] }),
        new GraphNodeModel(uuidv4(), '/users/export', 'route', { method: 'GET', line: 9, hasAuth: false, guards: [] }),
        new GraphNodeModel(uuidv4(), '/items', 'route', { method: 'GET', line: 13, hasAuth: false, guards: [] }),
      ];
      const routingGraph = new GraphModel(uuidv4(), genId, 'routing', nodes, [], {});

      const failures = await detector.detectRoutingFailures(generation, [routingGraph]);
      const ssrFailures = failures.filter(f => f.category === 'SSR');
      expect(ssrFailures.length).toBe(0);
    });

    test('should not flag whitelisted resource clusters (health, auth, docs)', async () => {
      const genId = uuidv4();
      const generation = makeGeneration('', genId);

      // 10 guarded routes + 1 unguarded /health + 1 unguarded /auth/login
      const nodes: GraphNode[] = [];
      for (let i = 0; i < 10; i++) {
        nodes.push(new GraphNodeModel(uuidv4(), `/data/item${i}`, 'route', {
          method: 'GET', line: i * 4, hasAuth: true, guards: ['auth'],
        }));
      }
      // Whitelisted: health and auth
      nodes.push(new GraphNodeModel(uuidv4(), '/health', 'route', { method: 'GET', line: 100, hasAuth: false, guards: [] }));
      nodes.push(new GraphNodeModel(uuidv4(), '/auth/login', 'route', { method: 'POST', line: 104, hasAuth: false, guards: [] }));
      nodes.push(new GraphNodeModel(uuidv4(), '/docs', 'route', { method: 'GET', line: 108, hasAuth: false, guards: [] }));

      const routingGraph = new GraphModel(uuidv4(), genId, 'routing', nodes, [], {});

      const failures = await detector.detectRoutingFailures(generation, [routingGraph]);
      const ssrFailures = failures.filter(f => f.category === 'SSR');
      // health, auth, docs are whitelisted — should not be flagged
      // /data cluster is all guarded — nothing to flag
      expect(ssrFailures.length).toBe(0);
    });

    test('should not flag when all routes in cluster are unguarded', async () => {
      const genId = uuidv4();
      const generation = makeGeneration('', genId);

      // 5 routes in /products, none guarded — no auth pattern to violate
      const nodes: GraphNode[] = [];
      for (let i = 0; i < 5; i++) {
        nodes.push(new GraphNodeModel(uuidv4(), `/products/item${i}`, 'route', {
          method: 'GET', line: i * 4, hasAuth: false, guards: [],
        }));
      }
      const routingGraph = new GraphModel(uuidv4(), genId, 'routing', nodes, [], {});

      const failures = await detector.detectRoutingFailures(generation, [routingGraph]);
      const ssrFailures = failures.filter(f => f.category === 'SSR');
      expect(ssrFailures.length).toBe(0);
    });

    test('GET deviant gets warning severity, DELETE deviant gets error severity', async () => {
      const genId = uuidv4();
      const generation = makeGeneration('', genId);

      // 18 guarded + 2 unguarded (1 GET, 1 DELETE) in /accounts/* = 90%
      const routingGraph = buildClusterRoutes(genId, 'accounts', 18, [
        { method: 'GET', path: '/accounts/public-info', line: 80 },
        { method: 'DELETE', path: '/accounts/purge', line: 84 },
      ]);

      const failures = await detector.detectRoutingFailures(generation, [routingGraph]);
      const ssrFailures = failures.filter(f => f.category === 'SSR');
      expect(ssrFailures.length).toBe(2);

      const getFailure = ssrFailures.find(f => f.description.includes('GET'));
      const deleteFailure = ssrFailures.find(f => f.description.includes('DELETE'));
      expect(getFailure!.severity).toBe('warning');
      expect(deleteFailure!.severity).toBe('error');
    });
  });

  // ─── Combined Failure Tests ──────────────────────────────────────────────

  describe('Combined Failures', () => {
    test('should detect multiple failure categories in combined fixture', async () => {
      const genId = uuidv4();
      const generation = makeGeneration(FIXTURE_COMBINED_FAILURES.code, genId);

      // Manually build graphs that will trigger specific detections
      // 1. Import graph with phantom modules
      const importGraph: Graph = new GraphModel(
        uuidv4(), genId, 'import',
        [
          new GraphNodeModel(uuidv4(), 'ghost_orm', 'module', { line: 1 }),
          new GraphNodeModel(uuidv4(), 'nonexistent_logger', 'module', { line: 3 }),
          new GraphNodeModel(uuidv4(), 'typing', 'module', { line: 2 }),
        ],
        [],
        {}
      );

      // 2. Dependency graph (only typing is stdlib)
      const depGraph: Graph = new GraphModel(
        uuidv4(), genId, 'dependency',
        [],
        [],
        {}
      );

      // 3. CFG with unreachable code
      const funcId = uuidv4();
      const returnNodeId = uuidv4();
      const unreachableNodeId = uuidv4();

      const cfgGraph: Graph = new GraphModel(
        uuidv4(), genId, 'cfg',
        [
          new GraphNodeModel(funcId, 'setup_database', 'function', {
            line: 12,
            hasReturnType: false,
            isAsync: false,
          }),
          new GraphNodeModel(returnNodeId, 'return', 'return', {
            line: 14,
            functionScope: funcId,
          }),
          new GraphNodeModel(unreachableNodeId, 'print', 'statement', {
            line: 15,
            functionScope: funcId,
          }),
        ],
        [
          new GraphEdgeModel(funcId, returnNodeId, 'control-flow', {}),
          new GraphEdgeModel(returnNodeId, unreachableNodeId, 'control-flow', {}),
        ],
        {}
      );

      // 4. Empty graphs for other types
      const callGraph: Graph = new GraphModel(uuidv4(), genId, 'call', [], [], {});
      const schemaGraph: Graph = new GraphModel(uuidv4(), genId, 'schema', [], [], {});
      const configGraph: Graph = new GraphModel(uuidv4(), genId, 'config', [], [], {});

      const allGraphs = [importGraph, depGraph, cfgGraph, callGraph, schemaGraph, configGraph];
      const failures = await detector.detectAllFailures(generation, allGraphs);

      // Should detect DHI (ghost_orm, nonexistent_logger are not stdlib)
      const dhiFailures = failures.filter(f => f.category === 'DHI');
      expect(dhiFailures.length).toBeGreaterThanOrEqual(1);

      // CFC detection now uses pylint/ESLint (tool-based, may not be available in CI)
      // If pylint is available, it may detect CFC in the fixture code; if not, 0 findings

      // All failures should have valid structure
      for (const failure of failures) {
        expect(failure.id).toBeTruthy();
        expect(failure.generationId).toBe(genId);
        expect(['graph-analysis', 'sast']).toContain(failure.detectedBy);
        expect(['error', 'warning']).toContain(failure.severity);
      }
    });
  });

  // ─── Clean Code Tests ────────────────────────────────────────────────────

  describe('Clean Code - No False Positives', () => {
    test('should produce no error-level failures for clean Python stdlib code', async () => {
      const generation = makeGeneration(CLEAN_PYTHON_STDLIB.code);
      const graphs = await graphConstructor.buildAllGraphs(generation);
      const failures = await detector.detectAllFailures(generation, graphs);

      const errorFailures = failures.filter(f => f.severity === 'error');
      expect(errorFailures.length).toBe(0);
    });

    test('should produce no error-level failures for clean TypeScript code', async () => {
      const generation = makeGeneration(CLEAN_TYPESCRIPT_PROPER.code);
      const graphs = await graphConstructor.buildAllGraphs(generation);
      const failures = await detector.detectAllFailures(generation, graphs);

      const errorFailures = failures.filter(f => f.severity === 'error');
      expect(errorFailures.length).toBe(0);
    });

    test('should produce no error-level failures for clean Python FastAPI code', async () => {
      const generation = makeGeneration(CLEAN_PYTHON_FASTAPI.code);
      const graphs = await graphConstructor.buildAllGraphs(generation);
      const failures = await detector.detectAllFailures(generation, graphs);

      const errorFailures = failures.filter(f => f.severity === 'error');
      expect(errorFailures.length).toBe(0);
    });

    test('clean code should have no PIA, SRF, or CFC failures', async () => {
      for (const fixture of ALL_CLEAN_FIXTURES) {
        const generation = makeGeneration(fixture.code);
        const graphs = await graphConstructor.buildAllGraphs(generation);
        const failures = await detector.detectAllFailures(generation, graphs);

        const criticalCategories = ['PIA', 'SRF', 'CFC'];
        const criticalFailures = failures.filter(f =>
          criticalCategories.includes(f.category as string)
        );
        expect(criticalFailures.length).toBe(0);
      }
    });
  });

  // ─── detectAllFailures completeness ──────────────────────────────────────

  describe('detectAllFailures Completeness', () => {
    test('should return failures with valid FailureDetection structure', async () => {
      const genId = uuidv4();
      const generation = makeGeneration(FIXTURE_DHI_MISSING_DEPENDENCY.code, genId);

      // Use manual graphs to guarantee failures are produced
      const importGraph: Graph = new GraphModel(
        uuidv4(), genId, 'import',
        [
          new GraphNodeModel(uuidv4(), 'fake_analytics_sdk', 'module', { line: 3 }),
        ],
        [],
        {}
      );
      const depGraph: Graph = new GraphModel(uuidv4(), genId, 'dependency', [], [], {});
      const graphs = [importGraph, depGraph];

      const failures = await detector.detectAllFailures(generation, graphs);

      for (const failure of failures) {
        expect(typeof failure.id).toBe('string');
        expect(failure.id.length).toBeGreaterThan(0);
        expect(failure.generationId).toBe(generation.id);

        const validCategories = ['SRF', 'PIA', 'DHI', 'BCI', 'RCF', 'CFC', 'CCV', 'SSR',
                                  'import', 'call', 'schema', 'config', 'type', 'dependency'];
        expect(validCategories).toContain(failure.category);
        expect(['error', 'warning']).toContain(failure.severity);
        expect(typeof failure.description).toBe('string');
        expect(failure.description.length).toBeGreaterThan(0);
        expect(failure.location).toBeDefined();
        expect(typeof failure.location.file).toBe('string');
        expect(typeof failure.location.line).toBe('number');
        expect(failure.location.line).toBeGreaterThanOrEqual(1);
        expect(['graph-analysis', 'sast']).toContain(failure.detectedBy);
      }
    });

    test('should filter graphs by generationId', async () => {
      const gen1 = makeGeneration(FIXTURE_PIA_PHANTOM_IMPORT.code);
      const gen2 = makeGeneration(CLEAN_PYTHON_STDLIB.code);

      const graphs1 = await graphConstructor.buildAllGraphs(gen1);
      const graphs2 = await graphConstructor.buildAllGraphs(gen2);

      // Pass graphs from both generations but ask for gen2 failures
      const allGraphs = [...graphs1, ...graphs2];
      const failures = await detector.detectAllFailures(gen2, allGraphs);

      // All failures should belong to gen2
      for (const failure of failures) {
        expect(failure.generationId).toBe(gen2.id);
      }
    });
  });
});
