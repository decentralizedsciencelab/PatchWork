/**
 * Tests for Task 2.1 — Registry Validation for DHI detection.
 *
 * Verifies:
 * - ToolBridge.executeNodeScript method exists and works
 * - Python validate_registry.py script runs correctly
 * - FailureDetector emits DHI failures for dependency nodes with registryExists === false
 */

import { ToolBridge } from '../services/ToolBridge';
import { FailureDetector } from '../services/FailureDetector';
import { TypeScriptAnalyzer } from '../services/TypeScriptAnalyzer';
import { Graph, Generation } from '../types';
import { v4 as uuidv4 } from 'uuid';

describe('Registry Validation (Task 2.1)', () => {

  describe('ToolBridge.executeNodeScript', () => {
    let toolBridge: ToolBridge;

    beforeEach(() => {
      toolBridge = new ToolBridge();
    });

    test('executeNodeScript method exists on ToolBridge', () => {
      expect(typeof toolBridge.executeNodeScript).toBe('function');
    });

    test('executeNodeScript runs validate_registry.js and returns JSON', () => {
      const input = JSON.stringify({ packages: ['express'], ecosystem: 'npm' });
      const result = toolBridge.executeNodeScript('validate_registry', input);

      expect(result).toHaveProperty('results');
      const results = result['results'] as Array<{ package: string; exists: boolean }>;
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(1);
      expect(results[0]).toHaveProperty('package', 'express');
      expect(results[0]).toHaveProperty('exists', true);
    });

    test('executeNodeScript returns exists: false for nonexistent npm package', () => {
      const input = JSON.stringify({ packages: ['nonexistent-xyzzy-9999999'], ecosystem: 'npm' });
      const result = toolBridge.executeNodeScript('validate_registry', input);

      const results = result['results'] as Array<{ package: string; exists: boolean }>;
      expect(results.length).toBe(1);
      expect(results[0]).toHaveProperty('package', 'nonexistent-xyzzy-9999999');
      expect(results[0]).toHaveProperty('exists', false);
    });

    test('executeNodeScript throws for missing script', () => {
      expect(() => {
        toolBridge.executeNodeScript('nonexistent_script', '{}');
      }).toThrow(/Node tool script not found/);
    });
  });

  describe('Python validate_registry.py', () => {
    let toolBridge: ToolBridge;

    beforeEach(() => {
      toolBridge = new ToolBridge();
    });

    test('validates a known pip package (requests)', () => {
      const input = JSON.stringify({ packages: ['requests'], ecosystem: 'pip' });
      const result = toolBridge.executePythonScript('validate_registry', input);

      expect(result).toHaveProperty('results');
      const results = result['results'] as Array<{ package: string; exists: boolean }>;
      expect(results.length).toBe(1);
      expect(results[0]).toHaveProperty('package', 'requests');
      expect(results[0]).toHaveProperty('exists', true);
    });

    test('returns exists: false for nonexistent pip package', () => {
      const input = JSON.stringify({ packages: ['nonexistent-xyzzy-9999999'], ecosystem: 'pip' });
      const result = toolBridge.executePythonScript('validate_registry', input);

      const results = result['results'] as Array<{ package: string; exists: boolean }>;
      expect(results.length).toBe(1);
      expect(results[0]).toHaveProperty('package', 'nonexistent-xyzzy-9999999');
      expect(results[0]).toHaveProperty('exists', false);
    });
  });

  describe('FailureDetector DHI for registryExists === false', () => {
    let failureDetector: FailureDetector;

    beforeEach(() => {
      failureDetector = new FailureDetector();
    });

    test('emits DHI failure for dependency node with registryExists: false', async () => {
      const generationId = uuidv4();

      const generation: Generation = {
        id: generationId,
        taskId: 'task-1',
        model: 'GPT-4o',
        promptStrategy: 'P1',
        contextFiles: [],
        generatedCode: 'import nonexistent_pkg',
        timestamp: new Date(),
      };

      const importGraph: Graph = {
        id: uuidv4(),
        generationId,
        type: 'import',
        nodes: [
          { id: 'mod1', label: 'nonexistent_pkg', type: 'module', properties: {} },
        ],
        edges: [],
        metadata: {},
      };

      const dependencyGraph: Graph = {
        id: uuidv4(),
        generationId,
        type: 'dependency',
        nodes: [
          {
            id: 'dep1',
            label: 'nonexistent_pkg',
            type: 'dependency',
            properties: { ecosystem: 'pip', registryExists: false },
          },
        ],
        edges: [],
        metadata: {},
      };

      const failures = await failureDetector.detectDependencyFailures(
        generation,
        [importGraph, dependencyGraph]
      );

      // Should find at least one DHI failure about registry
      const registryFailures = failures.filter(
        f => f.category === 'DHI' && f.description.includes('not found in')
      );
      expect(registryFailures.length).toBeGreaterThanOrEqual(1);
      expect(registryFailures[0]!.description).toContain("Package 'nonexistent_pkg' not found in pip registry");
      expect(registryFailures[0]!.severity).toBe('error');
      expect(registryFailures[0]!.detectedBy).toBe('graph-analysis');
    });

    test('does not emit DHI failure when registryExists is true', async () => {
      const generationId = uuidv4();

      const generation: Generation = {
        id: generationId,
        taskId: 'task-1',
        model: 'GPT-4o',
        promptStrategy: 'P1',
        contextFiles: [],
        generatedCode: 'import requests',
        timestamp: new Date(),
      };

      const importGraph: Graph = {
        id: uuidv4(),
        generationId,
        type: 'import',
        nodes: [
          { id: 'mod1', label: 'requests', type: 'module', properties: {} },
        ],
        edges: [],
        metadata: {},
      };

      const dependencyGraph: Graph = {
        id: uuidv4(),
        generationId,
        type: 'dependency',
        nodes: [
          {
            id: 'dep1',
            label: 'requests',
            type: 'dependency',
            properties: { ecosystem: 'pip', registryExists: true },
          },
        ],
        edges: [],
        metadata: {},
      };

      const failures = await failureDetector.detectDependencyFailures(
        generation,
        [importGraph, dependencyGraph]
      );

      // Should NOT find any registry-based DHI failures
      const registryFailures = failures.filter(
        f => f.category === 'DHI' && f.description.includes('not found in')
      );
      expect(registryFailures.length).toBe(0);
    });

    test('does not emit DHI failure when registryExists property is absent', async () => {
      const generationId = uuidv4();

      const generation: Generation = {
        id: generationId,
        taskId: 'task-1',
        model: 'GPT-4o',
        promptStrategy: 'P1',
        contextFiles: [],
        generatedCode: 'import somepkg',
        timestamp: new Date(),
      };

      const importGraph: Graph = {
        id: uuidv4(),
        generationId,
        type: 'import',
        nodes: [
          { id: 'mod1', label: 'somepkg', type: 'module', properties: {} },
        ],
        edges: [],
        metadata: {},
      };

      const dependencyGraph: Graph = {
        id: uuidv4(),
        generationId,
        type: 'dependency',
        nodes: [
          {
            id: 'dep1',
            label: 'somepkg',
            type: 'dependency',
            properties: { ecosystem: 'pip' },
          },
        ],
        edges: [],
        metadata: {},
      };

      const failures = await failureDetector.detectDependencyFailures(
        generation,
        [importGraph, dependencyGraph]
      );

      // Should NOT find registry-based DHI failures (property absent = validation not run)
      const registryFailures = failures.filter(
        f => f.category === 'DHI' && f.description.includes('not found in')
      );
      expect(registryFailures.length).toBe(0);
    });
  });

  describe('Path alias false-positive prevention', () => {
    let failureDetector: FailureDetector;
    let tsAnalyzer: TypeScriptAnalyzer;

    beforeEach(() => {
      failureDetector = new FailureDetector();
      tsAnalyzer = new TypeScriptAnalyzer();
    });

    describe('TypeScriptAnalyzer marks path aliases as relative', () => {
      test('@/ alias is treated as relative import', () => {
        const code = `import Button from '@/components/Button';`;
        const { imports } = tsAnalyzer.analyzeImports(code);
        expect(imports).toHaveLength(1);
        expect(imports[0]!.moduleName).toBe('@/components/Button');
        expect(imports[0]!.isRelative).toBe(true);
      });

      test('~/ alias is treated as relative import', () => {
        const code = `import { helpers } from '~/utils/helpers';`;
        const { imports } = tsAnalyzer.analyzeImports(code);
        expect(imports).toHaveLength(1);
        expect(imports[0]!.moduleName).toBe('~/utils/helpers');
        expect(imports[0]!.isRelative).toBe(true);
      });

      test('#/ alias is treated as relative import', () => {
        const code = `import config from '#/config';`;
        const { imports } = tsAnalyzer.analyzeImports(code);
        expect(imports).toHaveLength(1);
        expect(imports[0]!.moduleName).toBe('#/config');
        expect(imports[0]!.isRelative).toBe(true);
      });

      test('real scoped npm packages are NOT treated as relative', () => {
        const code = `
import { Component } from '@angular/core';
import { Injectable } from '@nestjs/common';
        `;
        const { imports } = tsAnalyzer.analyzeImports(code);
        expect(imports).toHaveLength(2);
        expect(imports[0]!.moduleName).toBe('@angular/core');
        expect(imports[0]!.isRelative).toBe(false);
        expect(imports[1]!.moduleName).toBe('@nestjs/common');
        expect(imports[1]!.isRelative).toBe(false);
      });

      test('require() with path alias is treated as relative', () => {
        const code = `const utils = require('@/utils/helpers');`;
        const { imports } = tsAnalyzer.analyzeImports(code);
        expect(imports).toHaveLength(1);
        expect(imports[0]!.moduleName).toBe('@/utils/helpers');
        expect(imports[0]!.isRelative).toBe(true);
      });
    });

    describe('FailureDetector skips path aliases in DHI detection', () => {
      function makeGeneration(code: string): { generation: Generation; generationId: string } {
        const generationId = uuidv4();
        return {
          generationId,
          generation: {
            id: generationId,
            taskId: 'task-1',
            model: 'GPT-4o',
            promptStrategy: 'P1',
            contextFiles: [],
            generatedCode: code,
            timestamp: new Date(),
          },
        };
      }

      test('@/components/Button does not produce DHI finding', async () => {
        const { generation, generationId } = makeGeneration(
          `import Button from '@/components/Button';`
        );

        const importGraph: Graph = {
          id: uuidv4(), generationId, type: 'import',
          nodes: [{ id: 'mod1', label: '@/components/Button', type: 'module', properties: {} }],
          edges: [], metadata: {},
        };
        const depGraph: Graph = {
          id: uuidv4(), generationId, type: 'dependency',
          nodes: [{ id: 'dep1', label: '@/components/Button', type: 'dependency', properties: { ecosystem: 'npm', registryExists: false } }],
          edges: [], metadata: {},
        };

        const failures = await failureDetector.detectDependencyFailures(generation, [importGraph, depGraph]);
        const dhiFailures = failures.filter(f => f.category === 'DHI');
        expect(dhiFailures).toHaveLength(0);
      });

      test('~/utils/helpers does not produce DHI finding', async () => {
        const { generation, generationId } = makeGeneration(
          `import { helpers } from '~/utils/helpers';`
        );

        const importGraph: Graph = {
          id: uuidv4(), generationId, type: 'import',
          nodes: [{ id: 'mod1', label: '~/utils/helpers', type: 'module', properties: {} }],
          edges: [], metadata: {},
        };
        const depGraph: Graph = {
          id: uuidv4(), generationId, type: 'dependency',
          nodes: [{ id: 'dep1', label: '~/utils/helpers', type: 'dependency', properties: { ecosystem: 'npm', registryExists: false } }],
          edges: [], metadata: {},
        };

        const failures = await failureDetector.detectDependencyFailures(generation, [importGraph, depGraph]);
        const dhiFailures = failures.filter(f => f.category === 'DHI');
        expect(dhiFailures).toHaveLength(0);
      });

      test('#/config does not produce DHI finding', async () => {
        const { generation, generationId } = makeGeneration(
          `import config from '#/config';`
        );

        const importGraph: Graph = {
          id: uuidv4(), generationId, type: 'import',
          nodes: [{ id: 'mod1', label: '#/config', type: 'module', properties: {} }],
          edges: [], metadata: {},
        };
        const depGraph: Graph = {
          id: uuidv4(), generationId, type: 'dependency',
          nodes: [{ id: 'dep1', label: '#/config', type: 'dependency', properties: { ecosystem: 'npm', registryExists: false } }],
          edges: [], metadata: {},
        };

        const failures = await failureDetector.detectDependencyFailures(generation, [importGraph, depGraph]);
        const dhiFailures = failures.filter(f => f.category === 'DHI');
        expect(dhiFailures).toHaveLength(0);
      });

      test('@angular/core still produces DHI finding when registryExists is false', async () => {
        const { generation, generationId } = makeGeneration(
          `import { Component } from '@angular/core';`
        );

        const importGraph: Graph = {
          id: uuidv4(), generationId, type: 'import',
          nodes: [{ id: 'mod1', label: '@angular/core', type: 'module', properties: {} }],
          edges: [], metadata: {},
        };
        const depGraph: Graph = {
          id: uuidv4(), generationId, type: 'dependency',
          nodes: [{ id: 'dep1', label: '@angular/core', type: 'dependency', properties: { ecosystem: 'npm', registryExists: false } }],
          edges: [], metadata: {},
        };

        const failures = await failureDetector.detectDependencyFailures(generation, [importGraph, depGraph]);
        const registryFailures = failures.filter(
          f => f.category === 'DHI' && f.description.includes('not found in')
        );
        expect(registryFailures.length).toBeGreaterThanOrEqual(1);
      });

      test('@nestjs/common still produces DHI finding when registryExists is false', async () => {
        const { generation, generationId } = makeGeneration(
          `import { Injectable } from '@nestjs/common';`
        );

        const importGraph: Graph = {
          id: uuidv4(), generationId, type: 'import',
          nodes: [{ id: 'mod1', label: '@nestjs/common', type: 'module', properties: {} }],
          edges: [], metadata: {},
        };
        const depGraph: Graph = {
          id: uuidv4(), generationId, type: 'dependency',
          nodes: [{ id: 'dep1', label: '@nestjs/common', type: 'dependency', properties: { ecosystem: 'npm', registryExists: false } }],
          edges: [], metadata: {},
        };

        const failures = await failureDetector.detectDependencyFailures(generation, [importGraph, depGraph]);
        const registryFailures = failures.filter(
          f => f.category === 'DHI' && f.description.includes('not found in')
        );
        expect(registryFailures.length).toBeGreaterThanOrEqual(1);
      });
    });
  });
});
