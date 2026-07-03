import { IGraphConstructor } from '../interfaces/IGraphConstructor';
import { Graph, Generation, GraphNode, GraphEdge } from '../types';
import { GraphModel, GraphNodeModel, GraphEdgeModel } from '../models/Graph';
import { v4 as uuidv4 } from 'uuid';
import * as ts from 'typescript';

export class GraphConstructor implements IGraphConstructor {

  /**
   * Extract actual code from markdown-formatted LLM output
   */
  private extractCodeFromMarkdown(content: string): string {
    // Check if content contains markdown code blocks
    const codeBlockRegex = /```(?:python|typescript|ts|py|javascript|js)?\s*\n([\s\S]*?)```/g;
    const matches: string[] = [];
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match[1]) {
        matches.push(match[1].trim());
      }
    }

    // If we found code blocks, join them
    if (matches.length > 0) {
      return matches.join('\n\n');
    }

    // If no code blocks, find the earliest code-like pattern
    const patterns = ['import ', 'from ', 'def ', 'function ', 'class ', 'const ', 'let ', 'var ', 'export '];
    let earliestStart = -1;
    for (const pattern of patterns) {
      const idx = content.indexOf(pattern);
      if (idx !== -1 && (earliestStart === -1 || idx < earliestStart)) {
        earliestStart = idx;
      }
    }
    if (earliestStart !== -1) {
      return content.substring(earliestStart);
    }

    return content;
  }

  /**
   * Build import graph using AST analysis for Python or TypeScript compiler API
   */
  async buildImportGraph(generation: Generation): Promise<Graph> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Extract actual code from markdown
    const code = this.extractCodeFromMarkdown(generation.generatedCode);

    // Determine language from generation context or code analysis
    const language = this.detectLanguage(code);

    if (language === 'TypeScript') {
      await this.buildTypeScriptImportGraph(code, nodes, edges);
    } else if (language === 'Python') {
      await this.buildPythonImportGraph(code, nodes, edges);
    }
    
    return new GraphModel(
      uuidv4(),
      generation.id,
      'import',
      nodes,
      edges,
      {
        language,
        analysisTimestamp: new Date().toISOString(),
        nodeCount: nodes.length,
        edgeCount: edges.length
      }
    );
  }

  /**
   * Build call graph using AST analysis for Python or TypeScript compiler API
   */
  async buildCallGraph(generation: Generation): Promise<Graph> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    const code = this.extractCodeFromMarkdown(generation.generatedCode);
    const language = this.detectLanguage(code);

    if (language === 'TypeScript') {
      await this.buildTypeScriptCallGraph(code, nodes, edges);
    } else if (language === 'Python') {
      await this.buildPythonCallGraph(code, nodes, edges);
    }
    
    return new GraphModel(
      uuidv4(),
      generation.id,
      'call',
      nodes,
      edges,
      {
        language,
        analysisTimestamp: new Date().toISOString(),
        nodeCount: nodes.length,
        edgeCount: edges.length
      }
    );
  }

  /**
   * Build dependency graph from manifest and lockfile parsing
   */
  async buildDependencyGraph(generation: Generation): Promise<Graph> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    const code = this.extractCodeFromMarkdown(generation.generatedCode);
    const language = this.detectLanguage(code);

    if (language === 'TypeScript') {
      await this.buildTypeScriptDependencyGraph(code, nodes, edges);
    } else if (language === 'Python') {
      await this.buildPythonDependencyGraph(code, nodes, edges);
    }
    
    return new GraphModel(
      uuidv4(),
      generation.id,
      'dependency',
      nodes,
      edges,
      {
        language,
        analysisTimestamp: new Date().toISOString(),
        nodeCount: nodes.length,
        edgeCount: edges.length
      }
    );
  }

  /**
   * Build schema graph from framework-specific schema extraction
   */
  async buildSchemaGraph(generation: Generation): Promise<Graph> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    const code = this.extractCodeFromMarkdown(generation.generatedCode);
    const language = this.detectLanguage(code);

    if (language === 'TypeScript') {
      await this.buildTypeScriptSchemaGraph(code, nodes, edges);
    } else if (language === 'Python') {
      await this.buildPythonSchemaGraph(code, nodes, edges);
    }
    
    return new GraphModel(
      uuidv4(),
      generation.id,
      'schema',
      nodes,
      edges,
      {
        language,
        analysisTimestamp: new Date().toISOString(),
        nodeCount: nodes.length,
        edgeCount: edges.length
      }
    );
  }

  /**
   * Build configuration graph using framework-specific parsers
   */
  async buildConfigGraph(generation: Generation): Promise<Graph> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    const code = this.extractCodeFromMarkdown(generation.generatedCode);
    const language = this.detectLanguage(code);

    if (language === 'TypeScript') {
      await this.buildTypeScriptConfigGraph(code, nodes, edges);
    } else if (language === 'Python') {
      await this.buildPythonConfigGraph(code, nodes, edges);
    }
    
    return new GraphModel(
      uuidv4(),
      generation.id,
      'config',
      nodes,
      edges,
      {
        language,
        analysisTimestamp: new Date().toISOString(),
        nodeCount: nodes.length,
        edgeCount: edges.length
      }
    );
  }

  /**
   * Build control flow graph using Python ast module or TypeScript compiler API
   */
  async buildControlFlowGraph(generation: Generation): Promise<Graph> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    const code = this.extractCodeFromMarkdown(generation.generatedCode);
    const language = this.detectLanguage(code);

    if (language === 'TypeScript') {
      await this.buildTypeScriptControlFlowGraph(code, nodes, edges);
    } else if (language === 'Python') {
      await this.buildPythonControlFlowGraph(code, nodes, edges);
    }
    
    return new GraphModel(
      uuidv4(),
      generation.id,
      'cfg',
      nodes,
      edges,
      {
        language,
        analysisTimestamp: new Date().toISOString(),
        nodeCount: nodes.length,
        edgeCount: edges.length
      }
    );
  }

  /**
   * Build resource graph detecting file/template path references
   */
  async buildResourceGraph(generation: Generation): Promise<Graph> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    return new GraphModel(
      uuidv4(),
      generation.id,
      'resource',
      nodes,
      edges,
      {
        language: 'Unknown',
        analysisTimestamp: new Date().toISOString(),
        nodeCount: nodes.length,
        edgeCount: edges.length
      }
    );
  }

  /**
   * Build routing/middleware graph for SSR detection (auth guards, route patterns)
   */
  async buildRoutingGraph(generation: Generation): Promise<Graph> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    return new GraphModel(
      uuidv4(),
      generation.id,
      'routing',
      nodes,
      edges,
      {
        language: 'Unknown',
        analysisTimestamp: new Date().toISOString(),
        nodeCount: nodes.length,
        edgeCount: edges.length
      }
    );
  }

  /**
   * Build all graph types for a generation
   */
  async buildAllGraphs(generation: Generation): Promise<Graph[]> {
    const graphs: Graph[] = [];

    try {
      graphs.push(await this.buildImportGraph(generation));
      graphs.push(await this.buildCallGraph(generation));
      graphs.push(await this.buildDependencyGraph(generation));
      graphs.push(await this.buildSchemaGraph(generation));
      graphs.push(await this.buildConfigGraph(generation));
      graphs.push(await this.buildControlFlowGraph(generation));
      graphs.push(await this.buildResourceGraph(generation));
      graphs.push(await this.buildRoutingGraph(generation));
    } catch (error) {
      console.error('Error building graphs:', error);
      // Continue with partial results
    }

    return graphs;
  }

  // Private helper methods

  private detectLanguage(code: string): 'Python' | 'TypeScript' | 'Unknown' {
    // Simple heuristics to detect language
    // Check for TypeScript-specific patterns first
    if (code.includes('interface ') || code.includes('type ') || 
        code.includes(': string') || code.includes(': number') ||
        code.includes('export ') || code.includes('import type') ||
        code.includes('class ') && code.includes('private ') ||
        code.includes('function ') && code.includes(': ')) {
      return 'TypeScript';
    }
    
    // Check for Python-specific patterns
    if (code.includes('def ') || code.includes('from ') && code.includes(' import ') ||
        code.includes('class ') && code.includes('__init__') ||
        code.includes('if __name__ == "__main__"') ||
        code.includes('print(')) {
      return 'Python';
    }
    
    return 'Unknown';
  }

  private async buildTypeScriptImportGraph(code: string, nodes: GraphNode[], edges: GraphEdge[]): Promise<void> {
    try {
      const sourceFile = ts.createSourceFile(
        'temp.ts',
        code,
        ts.ScriptTarget.Latest,
        true
      );

      const moduleNodes = new Map<string, string>();

      // Visit all import declarations
      const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node)) {
          const moduleSpecifier = node.moduleSpecifier;
          if (ts.isStringLiteral(moduleSpecifier)) {
            const moduleName = moduleSpecifier.text;
            const nodeId = uuidv4();
            
            moduleNodes.set(moduleName, nodeId);
            
            nodes.push(new GraphNodeModel(
              nodeId,
              moduleName,
              'module',
              {
                importType: 'external',
                line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1
              }
            ));

            // Add imports from this module
            if (node.importClause) {
              if (node.importClause.name) {
                // Default import
                const importId = uuidv4();
                nodes.push(new GraphNodeModel(
                  importId,
                  node.importClause.name.text,
                  'import',
                  { importType: 'default' }
                ));
                
                edges.push(new GraphEdgeModel(
                  nodeId,
                  importId,
                  'exports',
                  {}
                ));
              }
              
              if (node.importClause.namedBindings) {
                if (ts.isNamedImports(node.importClause.namedBindings)) {
                  node.importClause.namedBindings.elements.forEach(element => {
                    const importId = uuidv4();
                    nodes.push(new GraphNodeModel(
                      importId,
                      element.name.text,
                      'import',
                      { importType: 'named' }
                    ));
                    
                    edges.push(new GraphEdgeModel(
                      nodeId,
                      importId,
                      'exports',
                      {}
                    ));
                  });
                }
              }
            }
          }
        }
        
        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    } catch (error) {
      console.error('Error analyzing TypeScript imports:', error);
    }
  }

  private async buildPythonImportGraph(code: string, nodes: GraphNode[], edges: GraphEdge[]): Promise<void> {
    // Simple regex-based Python import analysis
    // In a real implementation, you'd use the Python AST module
    const importRegex = /^(?:from\s+(\S+)\s+)?import\s+(.+)$/gm;
    let match;
    
    while ((match = importRegex.exec(code)) !== null) {
      const [, fromModule, imports] = match;
      if (!imports) continue;
      
      const moduleName = fromModule || (imports?.split(',')[0]?.trim() || '');
      
      const moduleId = uuidv4();
      nodes.push(new GraphNodeModel(
        moduleId,
        moduleName,
        'module',
        {
          importType: fromModule ? 'from' : 'direct',
          line: code.substring(0, match.index).split('\n').length
        }
      ));
      
      // Parse individual imports
      const importList = imports.split(',').map(imp => imp.trim());
      importList.forEach(importName => {
        const importId = uuidv4();
        nodes.push(new GraphNodeModel(
          importId,
          importName,
          'import',
          { importType: fromModule ? 'from' : 'direct' }
        ));
        
        edges.push(new GraphEdgeModel(
          moduleId,
          importId,
          'exports',
          {}
        ));
      });
    }
  }

  private async buildTypeScriptCallGraph(code: string, nodes: GraphNode[], edges: GraphEdge[]): Promise<void> {
    try {
      const sourceFile = ts.createSourceFile(
        'temp.ts',
        code,
        ts.ScriptTarget.Latest,
        true
      );

      const functions = new Map<string, string>();
      const calls = new Set<string>();

      const visit = (node: ts.Node) => {
        // Find function declarations
        if (ts.isFunctionDeclaration(node) && node.name?.text) {
          const funcName = node.name.text;
          const funcId = uuidv4();
          functions.set(funcName, funcId);
          
          nodes.push(new GraphNodeModel(
            funcId,
            funcName,
            'function',
            {
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
              parameters: node.parameters.length
            }
          ));
        }
        
        // Find method declarations
        if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
          const methodName = node.name.text;
          const methodId = uuidv4();
          functions.set(methodName, methodId);
          
          nodes.push(new GraphNodeModel(
            methodId,
            methodName,
            'method',
            {
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
              parameters: node.parameters.length
            }
          ));
        }
        
        // Find function calls
        if (ts.isCallExpression(node)) {
          if (ts.isIdentifier(node.expression)) {
            const callName = node.expression.text;
            if (functions.has(callName)) {
              calls.add(callName);
            }
          }
        }
        
        ts.forEachChild(node, visit);
      };

      visit(sourceFile);

      // Create edges for function calls
      calls.forEach(callName => {
        if (functions.has(callName)) {
          const callerId = uuidv4();
          nodes.push(new GraphNodeModel(
            callerId,
            'caller',
            'call-site',
            { target: callName }
          ));
          
          edges.push(new GraphEdgeModel(
            callerId,
            functions.get(callName)!,
            'calls',
            {}
          ));
        }
      });
    } catch (error) {
      console.error('Error analyzing TypeScript call graph:', error);
    }
  }

  private async buildPythonCallGraph(code: string, nodes: GraphNode[], edges: GraphEdge[]): Promise<void> {
    // Simple regex-based Python function analysis
    const funcRegex = /^def\s+(\w+)\s*\(/gm;
    const callRegex = /(\w+)\s*\(/g;
    
    const functions = new Map<string, string>();
    const calls = new Set<string>();
    
    let match;
    
    // Find function definitions
    while ((match = funcRegex.exec(code)) !== null) {
      const funcName = match[1];
      if (funcName) {
        const funcId = uuidv4();
        functions.set(funcName, funcId);
        
        nodes.push(new GraphNodeModel(
          funcId,
          funcName,
          'function',
          {
            line: code.substring(0, match.index).split('\n').length,
            language: 'Python'
          }
        ));
      }
    }
    
    // Find function calls
    while ((match = callRegex.exec(code)) !== null) {
      const callName = match[1];
      if (callName && functions.has(callName)) {
        calls.add(callName);
      }
    }
    
    // Create call edges
    calls.forEach(callName => {
      if (functions.has(callName)) {
        const callerId = uuidv4();
        nodes.push(new GraphNodeModel(
          callerId,
          'caller',
          'call-site',
          { target: callName }
        ));
        
        edges.push(new GraphEdgeModel(
          callerId,
          functions.get(callName)!,
          'calls',
          {}
        ));
      }
    });
  }

  private async buildTypeScriptDependencyGraph(code: string, nodes: GraphNode[], _edges: GraphEdge[]): Promise<void> {
    // Extract package.json-like dependencies from code comments or imports
    const packageRegex = /@types\/[\w-]+|[\w-]+(?=\/)/g;
    const dependencies = new Set<string>();
    
    let match;
    while ((match = packageRegex.exec(code)) !== null) {
      dependencies.add(match[0]);
    }
    
    dependencies.forEach(dep => {
      const depId = uuidv4();
      nodes.push(new GraphNodeModel(
        depId,
        dep,
        'dependency',
        {
          type: dep.startsWith('@types/') ? 'devDependency' : 'dependency',
          ecosystem: 'npm'
        }
      ));
    });
  }

  private async buildPythonDependencyGraph(code: string, nodes: GraphNode[], _edges: GraphEdge[]): Promise<void> {
    // Extract pip-like dependencies from imports
    const importRegex = /^(?:from\s+)?import\s+(\w+)/gm;
    const dependencies = new Set<string>();
    
    let match;
    while ((match = importRegex.exec(code)) !== null) {
      const dep = match[1];
      if (dep && !dep.startsWith('.') && dep !== 'os' && dep !== 'sys') { // Skip relative and built-in modules
        dependencies.add(dep);
      }
    }
    
    dependencies.forEach(dep => {
      const depId = uuidv4();
      nodes.push(new GraphNodeModel(
        depId,
        dep,
        'dependency',
        {
          type: 'dependency',
          ecosystem: 'pip'
        }
      ));
    });
  }

  private async buildTypeScriptSchemaGraph(code: string, nodes: GraphNode[], _edges: GraphEdge[]): Promise<void> {
    // Look for Zod schemas, TypeScript interfaces, and Prisma models
    const interfaceRegex = /interface\s+(\w+)/g;
    const typeRegex = /type\s+(\w+)/g;
    const zodRegex = /z\.(\w+)\(\)/g;
    
    let match;
    
    // TypeScript interfaces
    while ((match = interfaceRegex.exec(code)) !== null) {
      const interfaceName = match[1];
      if (interfaceName) {
        const interfaceId = uuidv4();
        
        nodes.push(new GraphNodeModel(
          interfaceId,
          interfaceName,
          'interface',
          {
            framework: 'TypeScript',
            schemaType: 'interface'
          }
        ));
      }
    }
    
    // TypeScript types
    while ((match = typeRegex.exec(code)) !== null) {
      const typeName = match[1];
      if (typeName) {
        const typeId = uuidv4();
        
        nodes.push(new GraphNodeModel(
          typeId,
          typeName,
          'type',
          {
            framework: 'TypeScript',
            schemaType: 'type'
          }
        ));
      }
    }
    
    // Zod schemas
    while ((match = zodRegex.exec(code)) !== null) {
      const schemaType = match[1];
      if (schemaType) {
        const schemaId = uuidv4();
        
        nodes.push(new GraphNodeModel(
          schemaId,
          schemaType,
          'schema',
          {
            framework: 'Zod',
            schemaType: 'validation'
          }
        ));
      }
    }
  }

  private async buildPythonSchemaGraph(code: string, nodes: GraphNode[], _edges: GraphEdge[]): Promise<void> {
    // Look for Pydantic models and SQLAlchemy schemas
    const pydanticRegex = /class\s+(\w+)\s*\(\s*BaseModel\s*\)/g;
    const sqlalchemyRegex = /class\s+(\w+)\s*\(\s*Base\s*\)/g;
    
    let match;
    
    // Pydantic models
    while ((match = pydanticRegex.exec(code)) !== null) {
      const modelName = match[1];
      if (modelName) {
        const modelId = uuidv4();
        
        nodes.push(new GraphNodeModel(
          modelId,
          modelName,
          'model',
          {
            framework: 'Pydantic',
            schemaType: 'validation'
          }
        ));
      }
    }
    
    // SQLAlchemy models
    while ((match = sqlalchemyRegex.exec(code)) !== null) {
      const modelName = match[1];
      if (modelName) {
        const modelId = uuidv4();
        
        nodes.push(new GraphNodeModel(
          modelId,
          modelName,
          'model',
          {
            framework: 'SQLAlchemy',
            schemaType: 'database'
          }
        ));
      }
    }
  }

  private async buildTypeScriptConfigGraph(code: string, nodes: GraphNode[], _edges: GraphEdge[]): Promise<void> {
    // Look for configuration objects and environment variables
    const configRegex = /const\s+(\w*[Cc]onfig\w*)\s*=/g;
    const envRegex = /process\.env\.(\w+)/g;
    
    let match;
    
    // Configuration objects
    while ((match = configRegex.exec(code)) !== null) {
      const configName = match[1];
      if (configName) {
        const configId = uuidv4();
        
        nodes.push(new GraphNodeModel(
          configId,
          configName,
          'config',
          {
            type: 'configuration',
            framework: 'TypeScript'
          }
        ));
      }
    }
    
    // Environment variables
    while ((match = envRegex.exec(code)) !== null) {
      const envVar = match[1];
      if (envVar) {
        const envId = uuidv4();
        
        nodes.push(new GraphNodeModel(
          envId,
          envVar,
          'environment',
          {
            type: 'environment-variable',
            framework: 'Node.js'
          }
        ));
      }
    }
  }

  private async buildPythonConfigGraph(code: string, nodes: GraphNode[], _edges: GraphEdge[]): Promise<void> {
    // Look for configuration classes and environment variables
    const configRegex = /class\s+(\w*[Cc]onfig\w*)/g;
    const envRegex = /os\.environ\.get\(['"](\w+)['"]\)/g;
    
    let match;
    
    // Configuration classes
    while ((match = configRegex.exec(code)) !== null) {
      const configName = match[1];
      if (configName) {
        const configId = uuidv4();
        
        nodes.push(new GraphNodeModel(
          configId,
          configName,
          'config',
          {
            type: 'configuration',
            framework: 'Python'
          }
        ));
      }
    }
    
    // Environment variables
    while ((match = envRegex.exec(code)) !== null) {
      const envVar = match[1];
      if (envVar) {
        const envId = uuidv4();
        
        nodes.push(new GraphNodeModel(
          envId,
          envVar,
          'environment',
          {
            type: 'environment-variable',
            framework: 'Python'
          }
        ));
      }
    }
  }

  private async buildTypeScriptControlFlowGraph(code: string, nodes: GraphNode[], edges: GraphEdge[]): Promise<void> {
    try {
      const sourceFile = ts.createSourceFile(
        'temp.ts',
        code,
        ts.ScriptTarget.Latest,
        true
      );

      let nodeCounter = 0;
      const createNode = (label: string, type: string, line?: number) => {
        const nodeId = `cfg_${nodeCounter++}`;
        nodes.push(new GraphNodeModel(
          nodeId,
          label,
          type,
          {
            line: line || 0,
            cfgType: type
          }
        ));
        return nodeId;
      };

      const visit = (node: ts.Node, parentId?: string) => {
        let currentId: string | undefined;
        
        if (ts.isIfStatement(node)) {
          const ifId = createNode('if', 'conditional', sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1);
          const thenId = createNode('then', 'block');
          const elseId = createNode('else', 'block');
          
          if (parentId) {
            edges.push(new GraphEdgeModel(parentId, ifId, 'control-flow', {}));
          }
          
          edges.push(new GraphEdgeModel(ifId, thenId, 'true-branch', {}));
          edges.push(new GraphEdgeModel(ifId, elseId, 'false-branch', {}));
          
          currentId = ifId;
        } else if (ts.isForStatement(node) || ts.isWhileStatement(node)) {
          const loopId = createNode('loop', 'loop', sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1);
          const bodyId = createNode('loop-body', 'block');
          
          if (parentId) {
            edges.push(new GraphEdgeModel(parentId, loopId, 'control-flow', {}));
          }
          
          edges.push(new GraphEdgeModel(loopId, bodyId, 'loop-entry', {}));
          edges.push(new GraphEdgeModel(bodyId, loopId, 'loop-back', {}));
          
          currentId = loopId;
        } else if (ts.isBlock(node)) {
          const blockId = createNode('block', 'block', sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1);
          
          if (parentId) {
            edges.push(new GraphEdgeModel(parentId, blockId, 'control-flow', {}));
          }
          
          currentId = blockId;
        }
        
        ts.forEachChild(node, child => visit(child, currentId || parentId));
      };

      visit(sourceFile);
    } catch (error) {
      console.error('Error analyzing TypeScript control flow:', error);
    }
  }

  private async buildPythonControlFlowGraph(code: string, nodes: GraphNode[], edges: GraphEdge[]): Promise<void> {
    // Regex-based control flow analysis for Python with function scope tracking
    const lines = code.split('\n');
    let nodeCounter = 0;

    const createNode = (label: string, type: string, line: number, extraProps?: Record<string, unknown>) => {
      const nodeId = `cfg_${nodeCounter++}`;
      const props: Record<string, unknown> = { line, cfgType: type };
      // Note: functionScope is intentionally NOT set here because the regex-based
      // CFG builder creates linear chains without branching, which leads to false
      // positive CFC detections (returns inside if-blocks make subsequent code
      // appear unreachable). Use EnhancedGraphConstructor for CFC detection.
      if (extraProps) Object.assign(props, extraProps);
      nodes.push(new GraphNodeModel(nodeId, label, type, props));
      return nodeId;
    };

    let previousId: string | undefined;

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      let currentId: string | undefined;

      if (trimmed.startsWith('def ') || trimmed.startsWith('async def ')) {
        const funcName = trimmed.match(/(?:async\s+)?def\s+(\w+)/)?.[1] || 'function';
        // Check for return type annotation, but exclude -> None since it doesn't need a return statement
        const returnMatch = trimmed.match(/->\s*(\w+)/);
        const hasReturnType = returnMatch !== null && returnMatch[1] !== 'None';
        currentId = createNode(funcName, 'function', index + 1, { hasReturnType });
      } else if (trimmed.startsWith('if ')) {
        currentId = createNode('if', 'conditional', index + 1);
      } else if (trimmed.startsWith('elif ')) {
        currentId = createNode('elif', 'conditional', index + 1);
      } else if (trimmed.startsWith('else:')) {
        currentId = createNode('else', 'conditional', index + 1);
      } else if (trimmed.startsWith('for ') || trimmed.startsWith('while ')) {
        currentId = createNode('loop', 'loop', index + 1);
      } else if (trimmed.startsWith('return ') || trimmed === 'return') {
        currentId = createNode('return', 'return', index + 1);
      } else if (trimmed.startsWith('raise ') || trimmed === 'raise') {
        currentId = createNode('raise', 'raise', index + 1);
      } else if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('@')) {
        currentId = createNode('statement', 'statement', index + 1);
      }

      if (previousId && currentId) {
        edges.push(new GraphEdgeModel(previousId, currentId, 'control-flow', {}));
      }

      if (currentId) {
        previousId = currentId;
      }
    });
  }
}