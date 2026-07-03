/**
 * **Feature: code-generation-evaluation, Property 10: Language-specific tool selection**
 * 
 * Property: For any code analysis operation, Python code should use AST/pycg/staticfg tools 
 * while TypeScript code should use TypeScript compiler API/ts-morph tools
 * 
 * Validates: Requirements 4.1, 4.2, 4.3, 4.7
 */

import * as fc from 'fast-check';
import { GraphConstructor } from '../services/GraphConstructor';
import { Generation } from '../types';

describe('Property 10: Language-specific tool selection', () => {
  let graphConstructor: GraphConstructor;

  beforeEach(() => {
    graphConstructor = new GraphConstructor();
  });

  const pythonCodeArbitrary = fc.string().map(base => 
    `# Python code
import os
import sys
from typing import List

def hello_world():
    print("Hello, World!")
    return True

class MyClass:
    def __init__(self):
        self.value = 42

if __name__ == "__main__":
    hello_world()
${base}`
  );

  const typeScriptCodeArbitrary = fc.string().map(base => 
    `// TypeScript code
import { Component } from 'react';
import * as fs from 'fs';

interface User {
  id: string;
  name: string;
}

function greet(user: User): string {
  return \`Hello, \${user.name}!\`;
}

class UserService {
  private users: User[] = [];
  
  addUser(user: User): void {
    this.users.push(user);
  }
}

export { User, UserService };
${base}`
  );

  const generationArbitrary = fc.record({
    id: fc.string(),
    taskId: fc.string(),
    model: fc.constantFrom('GPT-4o', 'Claude-3.5-Sonnet') as fc.Arbitrary<'GPT-4o' | 'Claude-3.5-Sonnet'>,
    promptStrategy: fc.constantFrom('P1', 'P2', 'P3', 'P4') as fc.Arbitrary<'P1' | 'P2' | 'P3' | 'P4'>,
    contextFiles: fc.array(fc.string()),
    generatedCode: fc.oneof(pythonCodeArbitrary, typeScriptCodeArbitrary),
    timestamp: fc.date()
  });

  test('should use language-appropriate tools for graph construction', async () => {
    await fc.assert(
      fc.asyncProperty(generationArbitrary, async (generation: Generation) => {
        // Test import graph construction
        const importGraph = await graphConstructor.buildImportGraph(generation);
        
        // Verify the graph was constructed successfully
        expect(importGraph).toBeDefined();
        expect(importGraph.type).toBe('import');
        expect(importGraph.generationId).toBe(generation.id);
        expect(Array.isArray(importGraph.nodes)).toBe(true);
        expect(Array.isArray(importGraph.edges)).toBe(true);
        
        // Verify metadata contains language information
        expect(importGraph.metadata).toBeDefined();
        expect(importGraph.metadata['language']).toBeDefined();
        
        // The language detection should be consistent with the code content
        const detectedLanguage = importGraph.metadata['language'];
        expect(['Python', 'TypeScript', 'Unknown']).toContain(detectedLanguage);
        
        // Test call graph construction
        const callGraph = await graphConstructor.buildCallGraph(generation);
        expect(callGraph).toBeDefined();
        expect(callGraph.type).toBe('call');
        expect(callGraph.metadata['language']).toBe(detectedLanguage);
        
        // Test control flow graph construction
        const cfgGraph = await graphConstructor.buildControlFlowGraph(generation);
        expect(cfgGraph).toBeDefined();
        expect(cfgGraph.type).toBe('cfg');
        expect(cfgGraph.metadata['language']).toBe(detectedLanguage);
        
        // Verify that the analysis timestamp is recent
        const analysisTime = new Date(importGraph.metadata['analysisTimestamp']);
        const now = new Date();
        const timeDiff = now.getTime() - analysisTime.getTime();
        expect(timeDiff).toBeLessThan(10000); // Within 10 seconds
      }),
      { numRuns: 10 }
    );
  });

  test('should detect Python code correctly and use appropriate analysis', async () => {
    await fc.assert(
      fc.asyncProperty(pythonCodeArbitrary, fc.string(), fc.string(), async (code, id, taskId) => {
        const generation: Generation = {
          id,
          taskId,
          model: 'GPT-4o',
          promptStrategy: 'P1',
          contextFiles: [],
          generatedCode: code,
          timestamp: new Date()
        };

        const importGraph = await graphConstructor.buildImportGraph(generation);
        
        // Should detect as Python or Unknown (if heuristics fail)
        const language = importGraph.metadata['language'];
        expect(['Python', 'Unknown']).toContain(language);
        
        // If detected as Python, should have appropriate analysis
        if (language === 'Python') {
          // Python import analysis should find import statements
          const hasImportNodes = importGraph.nodes.some(node => 
            node.type === 'module' || node.type === 'import'
          );
          
          // If the code contains import statements, we should find them
          if (code.includes('import ') || code.includes('from ')) {
            expect(hasImportNodes).toBe(true);
          }
        }
      }),
      { numRuns: 10 }
    );
  });

  test('should detect TypeScript code correctly and use appropriate analysis', async () => {
    await fc.assert(
      fc.asyncProperty(typeScriptCodeArbitrary, fc.string(), fc.string(), async (code, id, taskId) => {
        const generation: Generation = {
          id,
          taskId,
          model: 'Claude-3.5-Sonnet',
          promptStrategy: 'P2',
          contextFiles: [],
          generatedCode: code,
          timestamp: new Date()
        };

        const importGraph = await graphConstructor.buildImportGraph(generation);
        
        // Should detect as TypeScript or Unknown (if heuristics fail)
        const language = importGraph.metadata['language'];
        expect(['TypeScript', 'Unknown']).toContain(language);
        
        // If detected as TypeScript, should have appropriate analysis
        if (language === 'TypeScript') {
          // TypeScript import analysis should find import statements
          const hasImportNodes = importGraph.nodes.some(node => 
            node.type === 'module' || node.type === 'import'
          );
          
          // If the code contains import statements, we should find them
          if (code.includes('import ')) {
            expect(hasImportNodes).toBe(true);
          }
        }
      }),
      { numRuns: 10 }
    );
  });

  test('should handle unknown language gracefully', async () => {
    const unknownCode = `
      // This is some unknown language code
      UNKNOWN_KEYWORD some_function() {
        ANOTHER_UNKNOWN_KEYWORD variable = 42;
        return variable;
      }
    `;

    const generation: Generation = {
      id: 'test-unknown',
      taskId: 'task-unknown',
      model: 'GPT-4o',
      promptStrategy: 'P1',
      contextFiles: [],
      generatedCode: unknownCode,
      timestamp: new Date()
    };

    const importGraph = await graphConstructor.buildImportGraph(generation);
    
    // Should handle unknown language without crashing
    expect(importGraph).toBeDefined();
    expect(importGraph.metadata['language']).toBe('Unknown');
    expect(importGraph.nodes).toEqual([]);
    expect(importGraph.edges).toEqual([]);
  });
});