/**
 * **Feature: code-generation-evaluation, Property 11: Graph construction completeness**
 * 
 * Property: For any generated code, graph construction should produce all six graph types: 
 * import, call, dependency, schema, configuration, and control flow
 * 
 * Validates: Requirements 4.4, 4.5, 4.6
 */

import * as fc from 'fast-check';
import { GraphConstructor } from '../services/GraphConstructor';
import { Generation } from '../types';

describe('Property 11: Graph construction completeness', () => {
  let graphConstructor: GraphConstructor;

  beforeEach(() => {
    graphConstructor = new GraphConstructor();
  });

  const pythonCodeArbitrary = fc.string().map(base => 
    `# Python code with various constructs
import os
import sys
from typing import List, Dict
from pydantic import BaseModel
from sqlalchemy import Base

class Config:
    DATABASE_URL = os.environ.get('DATABASE_URL')
    DEBUG = True

class User(BaseModel):
    id: int
    name: str
    email: str

class UserModel(Base):
    __tablename__ = 'users'

def create_user(name: str, email: str) -> User:
    user = User(id=1, name=name, email=email)
    save_user(user)
    return user

def save_user(user: User):
    if user.email:
        print(f"Saving user: {user.name}")
        return True
    return False

def main():
    for i in range(10):
        if i % 2 == 0:
            create_user(f"User{i}", f"user{i}@example.com")
        else:
            print(f"Skipping user {i}")

if __name__ == "__main__":
    main()

${base}`
  );

  const typeScriptCodeArbitrary = fc.string().map(base => 
    `// TypeScript code with various constructs
import { Component } from 'react';
import * as fs from 'fs';
import { z } from 'zod';

interface User {
  id: string;
  name: string;
  email: string;
}

type UserConfig = {
  maxUsers: number;
  enableNotifications: boolean;
};

const appConfig = {
  apiUrl: process.env.API_URL || 'http://localhost:3000',
  debug: process.env.NODE_ENV === 'development'
};

const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email()
});

class UserService {
  private users: User[] = [];
  private config: UserConfig;
  
  constructor(config: UserConfig) {
    this.config = config;
  }
  
  addUser(user: User): boolean {
    if (this.users.length >= this.config.maxUsers) {
      return false;
    }
    
    try {
      const validatedUser = UserSchema.parse(user);
      this.users.push(validatedUser);
      
      if (this.config.enableNotifications) {
        this.notifyUserAdded(validatedUser);
      }
      
      return true;
    } catch (error) {
      console.error('Invalid user data:', error);
      return false;
    }
  }
  
  private notifyUserAdded(user: User): void {
    console.log(\`User added: \${user.name}\`);
  }
  
  getUsers(): User[] {
    return [...this.users];
  }
}

function createUserService(): UserService {
  const config: UserConfig = {
    maxUsers: 100,
    enableNotifications: true
  };
  
  return new UserService(config);
}

export { User, UserService, createUserService };
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

  test('should produce all six graph types for any generated code', async () => {
    await fc.assert(
      fc.asyncProperty(generationArbitrary, async (generation: Generation) => {
        // Build all graphs using the buildAllGraphs method
        const graphs = await graphConstructor.buildAllGraphs(generation);
        
        // Should produce exactly 8 graphs (6 original + resource + routing)
        expect(graphs).toBeDefined();
        expect(Array.isArray(graphs)).toBe(true);
        expect(graphs.length).toBe(8);

        // Extract graph types
        const graphTypes = graphs.map(graph => graph.type);

        // Should contain all eight graph types
        const expectedTypes = ['import', 'call', 'dependency', 'schema', 'config', 'cfg', 'resource', 'routing'];
        expectedTypes.forEach(expectedType => {
          expect(graphTypes).toContain(expectedType);
        });

        // Each graph should have the correct structure
        graphs.forEach(graph => {
          expect(graph.id).toBeDefined();
          expect(graph.generationId).toBe(generation.id);
          expect(expectedTypes).toContain(graph.type);
          expect(Array.isArray(graph.nodes)).toBe(true);
          expect(Array.isArray(graph.edges)).toBe(true);
          expect(graph.metadata).toBeDefined();
          expect(typeof graph.metadata).toBe('object');
          
          // Metadata should contain analysis information
          expect(graph.metadata['analysisTimestamp']).toBeDefined();
          expect(graph.metadata['nodeCount']).toBe(graph.nodes.length);
          expect(graph.metadata['edgeCount']).toBe(graph.edges.length);
        });
        
        // All graphs should have the same generation ID
        graphs.forEach(graph => {
          expect(graph.generationId).toBe(generation.id);
        });
      }),
      { numRuns: 10 }
    );
  });

  test('should build individual graph types correctly', async () => {
    await fc.assert(
      fc.asyncProperty(generationArbitrary, async (generation: Generation) => {
        // Test each graph type individually
        const importGraph = await graphConstructor.buildImportGraph(generation);
        expect(importGraph.type).toBe('import');
        expect(importGraph.generationId).toBe(generation.id);
        
        const callGraph = await graphConstructor.buildCallGraph(generation);
        expect(callGraph.type).toBe('call');
        expect(callGraph.generationId).toBe(generation.id);
        
        const dependencyGraph = await graphConstructor.buildDependencyGraph(generation);
        expect(dependencyGraph.type).toBe('dependency');
        expect(dependencyGraph.generationId).toBe(generation.id);
        
        const schemaGraph = await graphConstructor.buildSchemaGraph(generation);
        expect(schemaGraph.type).toBe('schema');
        expect(schemaGraph.generationId).toBe(generation.id);
        
        const configGraph = await graphConstructor.buildConfigGraph(generation);
        expect(configGraph.type).toBe('config');
        expect(configGraph.generationId).toBe(generation.id);
        
        const cfgGraph = await graphConstructor.buildControlFlowGraph(generation);
        expect(cfgGraph.type).toBe('cfg');
        expect(cfgGraph.generationId).toBe(generation.id);
        
        // All graphs should have valid structure
        const allGraphs = [importGraph, callGraph, dependencyGraph, schemaGraph, configGraph, cfgGraph];
        allGraphs.forEach(graph => {
          expect(graph.nodes).toBeDefined();
          expect(graph.edges).toBeDefined();
          expect(graph.metadata).toBeDefined();
          
          // Validate node structure
          graph.nodes.forEach(node => {
            expect(node.id).toBeDefined();
            expect(node.label).toBeDefined();
            expect(node.type).toBeDefined();
            expect(node.properties).toBeDefined();
            expect(typeof node.properties).toBe('object');
          });
          
          // Validate edge structure
          graph.edges.forEach(edge => {
            expect(edge.source).toBeDefined();
            expect(edge.target).toBeDefined();
            expect(edge.type).toBeDefined();
            expect(edge.properties).toBeDefined();
            expect(typeof edge.properties).toBe('object');
            
            // Edge references should point to existing nodes
            const nodeIds = graph.nodes.map(n => n.id);
            expect(nodeIds).toContain(edge.source);
            expect(nodeIds).toContain(edge.target);
          });
        });
      }),
      { numRuns: 10 }
    );
  });

  test('should handle empty or minimal code gracefully', async () => {
    const minimalCodes = [
      '', // Empty code
      '// Just a comment',
      '# Just a comment',
      'console.log("hello");',
      'print("hello")',
      'const x = 1;',
      'x = 1'
    ];

    for (const code of minimalCodes) {
      const generation: Generation = {
        id: 'test-minimal',
        taskId: 'task-minimal',
        model: 'GPT-4o',
        promptStrategy: 'P1',
        contextFiles: [],
        generatedCode: code,
        timestamp: new Date()
      };

      const graphs = await graphConstructor.buildAllGraphs(generation);
      
      // Should still produce all 8 graph types, even if they're empty
      expect(graphs.length).toBe(8);

      const graphTypes = graphs.map(g => g.type);
      expect(graphTypes).toContain('import');
      expect(graphTypes).toContain('call');
      expect(graphTypes).toContain('dependency');
      expect(graphTypes).toContain('schema');
      expect(graphTypes).toContain('config');
      expect(graphTypes).toContain('cfg');
      expect(graphTypes).toContain('resource');
      expect(graphTypes).toContain('routing');
      
      // Each graph should be valid even if empty
      graphs.forEach(graph => {
        expect(graph.id).toBeDefined();
        expect(graph.generationId).toBe(generation.id);
        expect(Array.isArray(graph.nodes)).toBe(true);
        expect(Array.isArray(graph.edges)).toBe(true);
        expect(graph.metadata).toBeDefined();
      });
    }
  });

  test('should maintain graph consistency across multiple calls', async () => {
    const generation: Generation = {
      id: 'test-consistency',
      taskId: 'task-consistency',
      model: 'Claude-3.5-Sonnet',
      promptStrategy: 'P2',
      contextFiles: ['context.ts'],
      generatedCode: `
        import { User } from './types';
        
        interface Config {
          apiUrl: string;
        }
        
        function processUser(user: User): boolean {
          if (user.id) {
            console.log(user.name);
            return true;
          }
          return false;
        }
        
        export { processUser };
      `,
      timestamp: new Date()
    };

    // Build graphs multiple times
    const firstRun = await graphConstructor.buildAllGraphs(generation);
    const secondRun = await graphConstructor.buildAllGraphs(generation);
    
    // Should produce the same number of graphs
    expect(firstRun.length).toBe(secondRun.length);
    expect(firstRun.length).toBe(8);
    
    // Graph types should be consistent
    const firstTypes = firstRun.map(g => g.type).sort();
    const secondTypes = secondRun.map(g => g.type).sort();
    expect(firstTypes).toEqual(secondTypes);
    
    // Each corresponding graph should have the same structure
    for (let i = 0; i < firstRun.length; i++) {
      const first = firstRun.find(g => g.type === firstTypes[i]);
      const second = secondRun.find(g => g.type === secondTypes[i]);
      
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      
      if (first && second) {
        expect(first.type).toBe(second.type);
        expect(first.nodes.length).toBe(second.nodes.length);
        expect(first.edges.length).toBe(second.edges.length);
      }
    }
  });
});