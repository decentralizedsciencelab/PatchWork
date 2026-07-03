import { IGraphConstructor } from '../interfaces/IGraphConstructor';
import { Graph, Generation, GraphNode, GraphEdge } from '../types';
import { GraphModel, GraphNodeModel, GraphEdgeModel } from '../models/Graph';
import { v4 as uuidv4 } from 'uuid';
import { ToolBridge } from './ToolBridge';
import { TypeScriptAnalyzer } from './TypeScriptAnalyzer';
import { GraphConstructor } from './GraphConstructor';
import { PipelineConfig, GraphTypeName } from './PipelineConfig';

/**
 * Enhanced graph constructor that uses real analysis tools:
 * - Python: ast module, PyCG, mypy (via Python helper scripts)
 * - TypeScript: ts compiler API (via TypeScriptAnalyzer)
 * Falls back to regex-based GraphConstructor on any error.
 *
 * Accepts an optional PipelineConfig to control which graph types are built.
 */
export class EnhancedGraphConstructor implements IGraphConstructor {
  private toolBridge: ToolBridge;
  private tsAnalyzer: TypeScriptAnalyzer;
  private fallback: GraphConstructor;
  private config: PipelineConfig | null;

  constructor(config?: PipelineConfig) {
    this.config = config ?? null;
    this.toolBridge = new ToolBridge();
    this.tsAnalyzer = new TypeScriptAnalyzer();
    this.fallback = new GraphConstructor();
  }

  // ─── Shared Helpers ──────────────────────────────────────────────

  private extractCodeFromMarkdown(content: string): string {
    // If content has markdown code blocks, extract them
    const codeBlockRegex = /```(?:python|typescript|ts|py|javascript|js)?\s*\n([\s\S]*?)```/g;
    const matches: string[] = [];
    let match;
    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match[1]) matches.push(match[1].trim());
    }
    if (matches.length > 0) return matches.join('\n\n');

    // No markdown blocks found — return full content as-is.
    // This handles raw source files (not LLM markdown output).
    return content;
  }

  private detectLanguage(code: string): 'Python' | 'TypeScript' | 'Unknown' {
    // Score-based detection to avoid false positives
    let pyScore = 0;
    let tsScore = 0;

    // Strong Python indicators
    if (code.includes('def ')) pyScore += 3;
    if (code.includes('if __name__')) pyScore += 3;
    if (/^\s*class\s+\w+.*:/m.test(code)) pyScore += 2;
    if (code.includes('self.')) pyScore += 2;
    if (/^\s*from\s+\S+\s+import\s/m.test(code)) pyScore += 2;
    if (/^\s*import\s+\w+/m.test(code) && !code.includes('{')) pyScore += 1;
    if (code.includes('print(')) pyScore += 1;
    if (code.includes('elif ')) pyScore += 2;
    if (code.includes('except ') || code.includes('except:')) pyScore += 2;
    if (code.includes('raise ')) pyScore += 1;
    if (code.includes('"""') || code.includes("'''")) pyScore += 2;
    if (code.includes('None')) pyScore += 1;
    if (code.includes('True') || code.includes('False')) pyScore += 1;

    // Strong TypeScript/JavaScript indicators
    if (code.includes('interface ')) tsScore += 3;
    if (code.includes('export ')) tsScore += 2;
    if (code.includes('import type')) tsScore += 3;
    if (code.includes(': string') || code.includes(': number') || code.includes(': boolean')) tsScore += 2;
    if (code.includes('const ') || code.includes('let ')) tsScore += 1;
    if (code.includes('=> ')) tsScore += 1;
    if (code.includes('function ')) tsScore += 1;
    if (code.includes('async ') && code.includes('await ')) tsScore += 1;

    if (pyScore > tsScore && pyScore >= 2) return 'Python';
    if (tsScore > pyScore && tsScore >= 2) return 'TypeScript';
    if (pyScore >= 2) return 'Python';
    if (tsScore >= 2) return 'TypeScript';
    return 'Unknown';
  }

  private makeMetadata(language: string, toolUsed: string, nodeCount: number, edgeCount: number): Record<string, unknown> {
    return {
      language,
      analysisTimestamp: new Date().toISOString(),
      toolUsed,
      nodeCount,
      edgeCount,
    };
  }

  // ─── Import Graph ────────────────────────────────────────────────

  async buildImportGraph(generation: Generation): Promise<Graph> {
    const code = this.extractCodeFromMarkdown(generation.generatedCode);
    const language = this.detectLanguage(code);

    try {
      if (language === 'Python') {
        return this.buildPythonImportGraph(code, generation);
      } else if (language === 'TypeScript') {
        return this.buildTSImportGraph(code, generation);
      }
    } catch (err) {
      console.warn(`[EnhancedGraphConstructor] Import graph failed, using fallback:`, err);
    }
    return this.fallback.buildImportGraph(generation);
  }

  private buildPythonImportGraph(code: string, generation: Generation): Graph {
    const result = this.toolBridge.executePythonScript('analyze_imports', code) as any;
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const imp of (result.imports || [])) {
      const moduleId = uuidv4();
      nodes.push(new GraphNodeModel(moduleId, imp.module, 'module', {
        importType: imp.type === 'from' ? 'from' : 'direct',
        line: imp.line,
        isRelative: imp.isRelative,
      }));

      for (const name of (imp.names || [])) {
        const importId = uuidv4();
        nodes.push(new GraphNodeModel(importId, name, 'import', { importType: imp.type }));
        edges.push(new GraphEdgeModel(moduleId, importId, 'imports', {}));
      }
    }

    return new GraphModel(uuidv4(), generation.id, 'import', nodes, edges,
      this.makeMetadata('Python', 'ast', nodes.length, edges.length));
  }

  private buildTSImportGraph(code: string, generation: Generation): Graph {
    const result = this.tsAnalyzer.analyzeImports(code);
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const imp of result.imports) {
      const moduleId = uuidv4();
      nodes.push(new GraphNodeModel(moduleId, imp.moduleName, 'module', {
        importType: imp.isTypeOnly ? 'type-only' : 'normal',
        line: imp.line,
        isRelative: imp.isRelative,
      }));

      for (const name of imp.importedNames) {
        const importId = uuidv4();
        nodes.push(new GraphNodeModel(importId, name, 'import', { importType: imp.isTypeOnly ? 'type-only' : 'named' }));
        edges.push(new GraphEdgeModel(moduleId, importId, 'imports', {}));
      }
    }

    return new GraphModel(uuidv4(), generation.id, 'import', nodes, edges,
      this.makeMetadata('TypeScript', 'typescript-compiler-api', nodes.length, edges.length));
  }

  // ─── Call Graph ──────────────────────────────────────────────────

  async buildCallGraph(generation: Generation): Promise<Graph> {
    const code = this.extractCodeFromMarkdown(generation.generatedCode);
    const language = this.detectLanguage(code);

    try {
      if (language === 'Python') {
        return this.buildPythonCallGraph(code, generation);
      } else if (language === 'TypeScript') {
        return this.buildTSCallGraph(code, generation);
      }
    } catch (err) {
      console.warn(`[EnhancedGraphConstructor] Call graph failed, using fallback:`, err);
    }
    return this.fallback.buildCallGraph(generation);
  }

  private buildPythonCallGraph(code: string, generation: Generation): Graph {
    const result = this.toolBridge.executePythonScript('analyze_calls', code) as any;
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const funcMap = new Map<string, string>();
    const toolUsed = result.toolUsed || 'ast';

    // Create function nodes
    for (const func of (result.functions || [])) {
      const funcId = uuidv4();
      funcMap.set(func.name, funcId);
      nodes.push(new GraphNodeModel(funcId, func.name, func.isMethod ? 'method' : 'function', {
        line: func.line,
        parameters: func.parameters,
        isAsync: func.isAsync || false,
        decorators: func.decorators || [],
      }));
    }

    // Create decorator nodes and 'decorates' edges
    for (const func of (result.functions || [])) {
      const decorators = func.decorators || [];
      const funcId = funcMap.get(func.name);
      if (!funcId || decorators.length === 0) continue;

      for (const dec of decorators) {
        const decName = typeof dec === 'string' ? dec : (dec.name || String(dec));
        // Avoid duplicating decorator nodes
        let decId = funcMap.get(`@${decName}`);
        if (!decId) {
          decId = uuidv4();
          funcMap.set(`@${decName}`, decId);
          nodes.push(new GraphNodeModel(decId, decName, 'decorator', {
            isDecorator: true,
          }));
        }
        edges.push(new GraphEdgeModel(decId, funcId, 'decorates', { line: func.line }));
      }
    }

    // Create call edges
    for (const call of (result.calls || [])) {
      let callerId = funcMap.get(call.caller);
      if (!callerId) {
        // Handle module-level calls (caller is "<module>")
        if (call.caller === '<module>') {
          callerId = uuidv4();
          funcMap.set(call.caller, callerId);
          nodes.push(new GraphNodeModel(callerId, '<module>', 'module', { isExternal: false }));
        } else {
          continue;
        }
      }

      for (const callee of (call.callees || [])) {
        let calleeId = funcMap.get(callee);
        if (!calleeId) {
          // External function — create node for it
          calleeId = uuidv4();
          funcMap.set(callee, calleeId);
          nodes.push(new GraphNodeModel(calleeId, callee, 'function', { isExternal: true }));
        }
        edges.push(new GraphEdgeModel(callerId, calleeId, 'calls', { line: call.line }));
      }
    }

    return new GraphModel(uuidv4(), generation.id, 'call', nodes, edges,
      this.makeMetadata('Python', toolUsed, nodes.length, edges.length));
  }

  private buildTSCallGraph(code: string, generation: Generation): Graph {
    const result = this.tsAnalyzer.analyzeCalls(code);
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const funcMap = new Map<string, string>();

    for (const func of result.functions) {
      const funcId = uuidv4();
      funcMap.set(func.name, funcId);
      nodes.push(new GraphNodeModel(funcId, func.name, func.isMethod ? 'method' : 'function', {
        line: func.line,
        parameters: func.parameters,
        isAsync: func.isAsync,
        hasReturnType: func.hasReturnType,
      }));
    }

    for (const call of result.calls) {
      const callerId = funcMap.get(call.caller);
      if (!callerId) continue;

      for (const callee of call.callees) {
        let calleeId = funcMap.get(callee);
        if (!calleeId) {
          calleeId = uuidv4();
          funcMap.set(callee, calleeId);
          nodes.push(new GraphNodeModel(calleeId, callee, 'function', { isExternal: true }));
        }
        edges.push(new GraphEdgeModel(callerId, calleeId, 'calls', { line: call.line }));
      }
    }

    return new GraphModel(uuidv4(), generation.id, 'call', nodes, edges,
      this.makeMetadata('TypeScript', 'typescript-compiler-api', nodes.length, edges.length));
  }

  // ─── Dependency Graph ────────────────────────────────────────────

  async buildDependencyGraph(generation: Generation): Promise<Graph> {
    const code = this.extractCodeFromMarkdown(generation.generatedCode);
    const language = this.detectLanguage(code);
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    try {
      // Extract dependency declarations from code
      if (language === 'Python') {
        // Look for requirements patterns, setup() calls, pyproject sections
        const requireRegex = /(?:install_requires|requirements)\s*=\s*\[([\s\S]*?)\]/g;
        let match;
        while ((match = requireRegex.exec(code)) !== null) {
          const deps = match[1]!.match(/['"]([^'"]+)['"]/g) || [];
          for (const dep of deps) {
            const depName = dep.replace(/['"]/g, '').split(/[>=<!]/)[0]!.trim();
            nodes.push(new GraphNodeModel(uuidv4(), depName, 'dependency', {
              ecosystem: 'pip',
              type: 'dependency',
            }));
          }
        }

        // Also: look for import statements to infer dependencies
        const importResult = this.toolBridge.executePythonScript('analyze_imports', code) as any;
        for (const imp of (importResult.imports || [])) {
          if (!imp.isRelative) {
            const baseMod = imp.module.split('.')[0] || imp.module;
            // Only add if not already present
            if (!nodes.some(n => n.label === baseMod)) {
              nodes.push(new GraphNodeModel(uuidv4(), baseMod, 'dependency', {
                ecosystem: 'pip',
                type: 'inferred',
              }));
            }
          }
        }
      } else if (language === 'TypeScript') {
        // Look for package.json content or require/import
        const pkgJsonMatch = code.match(/"dependencies"\s*:\s*\{([^}]+)\}/);
        if (pkgJsonMatch) {
          const pairs = pkgJsonMatch[1]!.match(/"([^"]+)"\s*:\s*"([^"]+)"/g) || [];
          for (const pair of pairs) {
            const parts = pair.match(/"([^"]+)"\s*:\s*"([^"]+)"/);
            if (parts) {
              nodes.push(new GraphNodeModel(uuidv4(), parts[1]!, 'dependency', {
                version: parts[2],
                ecosystem: 'npm',
                type: 'dependency',
              }));
            }
          }
        }

        // Infer from imports
        const tsResult = this.tsAnalyzer.analyzeImports(code);
        for (const imp of tsResult.imports) {
          if (!imp.isRelative) {
            const baseMod = imp.moduleName.startsWith('@')
              ? imp.moduleName.split('/').slice(0, 2).join('/')
              : imp.moduleName.split('/')[0] || imp.moduleName;
            if (!nodes.some(n => n.label === baseMod)) {
              nodes.push(new GraphNodeModel(uuidv4(), baseMod, 'dependency', {
                ecosystem: 'npm',
                type: 'inferred',
              }));
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[EnhancedGraphConstructor] Dependency graph failed, using fallback:`, err);
      return this.fallback.buildDependencyGraph(generation);
    }

    // Registry validation: check if packages actually exist in their ecosystem registry
    try {
      await this.validateRegistryPackages(nodes, language);
    } catch (err) {
      console.warn(`[EnhancedGraphConstructor] Registry validation failed, skipping:`, err);
    }

    return new GraphModel(uuidv4(), generation.id, 'dependency', nodes, edges,
      this.makeMetadata(language, 'enhanced', nodes.length, edges.length));
  }

  /**
   * Validate dependency nodes against their package registry (PyPI or npm).
   * Marks nodes with `registryExists: false` if the package is not found.
   */
  private async validateRegistryPackages(nodes: GraphNode[], language: string): Promise<void> {
    // Determine ecosystem from language
    const ecosystem = language === 'Python' ? 'pip' : language === 'TypeScript' ? 'npm' : null;
    if (!ecosystem) return;

    // Extract package labels from dependency nodes
    const depNodes = nodes.filter(n => n.type === 'dependency');
    if (depNodes.length === 0) return;

    const packageNames = depNodes.map(n => n.label);
    const input = JSON.stringify({ packages: packageNames, ecosystem });

    let result: any;
    if (ecosystem === 'pip') {
      result = this.toolBridge.executePythonScript('validate_registry', input);
    } else {
      result = this.toolBridge.executeNodeScript('validate_registry', input);
    }

    const results = (result.results || []) as Array<{ package: string; exists: boolean }>;
    const existsMap = new Map<string, boolean>();
    for (const r of results) {
      existsMap.set(r.package, r.exists);
    }

    // Mark nodes with registry existence info
    for (const node of depNodes) {
      const exists = existsMap.get(node.label);
      if (exists !== undefined) {
        node.properties['registryExists'] = exists;
      }
    }
  }

  // ─── Schema Graph ────────────────────────────────────────────────

  async buildSchemaGraph(generation: Generation): Promise<Graph> {
    const code = this.extractCodeFromMarkdown(generation.generatedCode);
    const language = this.detectLanguage(code);

    try {
      if (language === 'Python') {
        return this.buildPythonSchemaGraph(code, generation);
      } else if (language === 'TypeScript') {
        return this.buildTSSchemaGraph(code, generation);
      }
    } catch (err) {
      console.warn(`[EnhancedGraphConstructor] Schema graph failed, using fallback:`, err);
    }
    return this.fallback.buildSchemaGraph(generation);
  }

  private buildTSSchemaGraph(code: string, generation: Generation): Graph {
    const result = this.tsAnalyzer.analyzeSchemas(code);
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const schema of result.schemas) {
      const schemaId = uuidv4();
      nodes.push(new GraphNodeModel(schemaId, schema.name, 'model', {
        framework: schema.type,
        line: schema.line,
      }));

      for (const field of schema.fields) {
        const fieldId = uuidv4();
        nodes.push(new GraphNodeModel(fieldId, field.name, 'field', {
          dataType: field.dataType,
          constraints: [],
          line: field.line,
        }));
        edges.push(new GraphEdgeModel(schemaId, fieldId, 'hasType', {}));
      }

      // Track extends relationships
      for (const base of schema.bases) {
        const baseId = uuidv4();
        nodes.push(new GraphNodeModel(baseId, base, 'model', { isBase: true }));
        edges.push(new GraphEdgeModel(schemaId, baseId, 'extends', {}));
      }
    }

    return new GraphModel(uuidv4(), generation.id, 'schema', nodes, edges,
      this.makeMetadata('TypeScript', 'typescript-compiler-api', nodes.length, edges.length));
  }

  private buildPythonSchemaGraph(code: string, generation: Generation): Graph {
    const result = this.toolBridge.executePythonScript('analyze_structure', code, { analysis: 'schema' }) as any;
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const schema of (result.schemas || [])) {
      const schemaId = uuidv4();
      nodes.push(new GraphNodeModel(schemaId, schema.name, 'model', {
        framework: schema.type,
        line: schema.line,
      }));

      for (const field of (schema.fields || [])) {
        const fieldId = uuidv4();
        nodes.push(new GraphNodeModel(fieldId, field.name, 'field', {
          dataType: field.dataType,
          constraints: field.constraints || [],
          line: field.line,
        }));
        edges.push(new GraphEdgeModel(schemaId, fieldId, 'hasType', {}));
      }

      // Track extends relationships
      for (const base of (schema.bases || [])) {
        const baseId = uuidv4();
        nodes.push(new GraphNodeModel(baseId, base, 'model', { isBase: true }));
        edges.push(new GraphEdgeModel(schemaId, baseId, 'extends', {}));
      }
    }

    return new GraphModel(uuidv4(), generation.id, 'schema', nodes, edges,
      this.makeMetadata('Python', 'ast', nodes.length, edges.length));
  }

  // ─── Config Graph ────────────────────────────────────────────────

  async buildConfigGraph(generation: Generation): Promise<Graph> {
    const code = this.extractCodeFromMarkdown(generation.generatedCode);
    const language = this.detectLanguage(code);

    try {
      if (language === 'Python') {
        return this.buildPythonConfigGraph(code, generation);
      } else if (language === 'TypeScript') {
        return this.buildTSConfigGraph(code, generation);
      }
    } catch (err) {
      console.warn(`[EnhancedGraphConstructor] Config graph failed, using fallback:`, err);
    }
    return this.fallback.buildConfigGraph(generation);
  }

  private buildPythonConfigGraph(code: string, generation: Generation): Graph {
    const result = this.toolBridge.executePythonScript('analyze_structure', code, { analysis: 'config' }) as any;
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Config classes/dicts
    for (const config of (result.configs || [])) {
      for (const field of (config.fields || [])) {
        nodes.push(new GraphNodeModel(uuidv4(), field.name, 'config', {
          value: field.value,
          expectedType: field.expectedType,
          type: 'configuration',
          source: config.name,
          line: field.line,
        }));
      }
    }

    // Environment variables — enriched data includes accessMethod + safetyContext
    const enrichedEnvVars = result.envVarsEnriched || [];
    for (const envInfo of enrichedEnvVars) {
      nodes.push(new GraphNodeModel(uuidv4(), envInfo.name, 'environment', {
        type: 'environment-variable',
        accessMethod: envInfo.accessMethod,
        line: envInfo.line || 1,
        safetyContext: envInfo.safetyContext || null,
      }));
    }

    return new GraphModel(uuidv4(), generation.id, 'config', nodes, edges,
      this.makeMetadata('Python', 'ast', nodes.length, edges.length));
  }

  private buildTSConfigGraph(code: string, generation: Generation): Graph {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    const lines = code.split('\n');

    // Pass 1: Collect all process.env references with access context
    interface EnvRef {
      name: string;
      accessMethod: 'dot_access' | 'dot_access_with_default' | 'non_null_assertion' | 'bracket_access' | 'bracket_access_with_default';
      line: number;
    }

    const envRefs: EnvRef[] = [];

    // Dot access: process.env.VAR_NAME
    const dotPattern = /process\.env\.([A-Z][A-Z0-9_]{2,})/g;
    // Bracket access: process.env['VAR_NAME'] or process.env["VAR_NAME"]
    const bracketPattern = /process\.env\[['"]([A-Z][A-Z0-9_]{2,})['"]\]/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      let match;

      // Check dot access patterns
      dotPattern.lastIndex = 0;
      while ((match = dotPattern.exec(line)) !== null) {
        const varName = match[1]!;
        const afterMatch = line.substring(match.index + match[0].length);

        if (/^\s*!/.test(afterMatch)) {
          // Non-null assertion: process.env.KEY!
          envRefs.push({ name: varName, accessMethod: 'non_null_assertion', line: lineNum });
        } else if (/^\s*(\?\?|\|\||[?]\s)/.test(afterMatch)) {
          // Has fallback: process.env.KEY ?? x, process.env.KEY || x, ternary
          envRefs.push({ name: varName, accessMethod: 'dot_access_with_default', line: lineNum });
        } else {
          envRefs.push({ name: varName, accessMethod: 'dot_access', line: lineNum });
        }
      }

      // Check bracket access patterns
      bracketPattern.lastIndex = 0;
      while ((match = bracketPattern.exec(line)) !== null) {
        const varName = match[1]!;
        const afterMatch = line.substring(match.index + match[0].length);

        if (/^\s*(\?\?|\|\|)/.test(afterMatch)) {
          envRefs.push({ name: varName, accessMethod: 'bracket_access_with_default', line: lineNum });
        } else {
          envRefs.push({ name: varName, accessMethod: 'bracket_access', line: lineNum });
        }
      }
    }

    // Pass 2: Check for scope guards
    const guardedVars = new Set<string>();
    const tryBlockRanges: Array<{ start: number; end: number }> = [];

    // Simple guard detection: if (process.env.X) or if (process.env.X !== undefined)
    const guardPattern = /if\s*\(\s*process\.env\.([A-Z][A-Z0-9_]{2,})\b/g;
    const guardPatternBracket = /if\s*\(\s*process\.env\[['"]([A-Z][A-Z0-9_]{2,})['"]\]/g;
    for (const line of lines) {
      guardPattern.lastIndex = 0;
      let gm;
      while ((gm = guardPattern.exec(line)) !== null) {
        if (gm[1]) guardedVars.add(gm[1]);
      }
      guardPatternBracket.lastIndex = 0;
      while ((gm = guardPatternBracket.exec(line)) !== null) {
        if (gm[1]) guardedVars.add(gm[1]);
      }
    }

    // Simple try block detection
    let tryDepth = 0;
    let tryStart = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (/\btry\s*\{/.test(line)) {
        if (tryDepth === 0) tryStart = i + 1;
        tryDepth++;
      }
      if (line.includes('}') && tryDepth > 0) {
        tryDepth--;
        if (tryDepth === 0 && tryStart >= 0) {
          tryBlockRanges.push({ start: tryStart, end: i + 1 });
          tryStart = -1;
        }
      }
    }

    // Pass 3: Create nodes only for unsafe accesses
    for (const ref of envRefs) {
      // Skip safe patterns with defaults
      if (ref.accessMethod === 'dot_access_with_default' || ref.accessMethod === 'bracket_access_with_default') {
        continue;
      }

      // Determine safety context
      let safetyContext: string | null = null;
      if (guardedVars.has(ref.name)) {
        safetyContext = 'guard_check';
      } else if (tryBlockRanges.some(r => ref.line >= r.start && ref.line <= r.end)) {
        safetyContext = 'try_catch';
      }

      nodes.push(new GraphNodeModel(uuidv4(), ref.name, 'environment', {
        type: 'environment-variable',
        accessMethod: ref.accessMethod,
        line: ref.line,
        safetyContext,
      }));
    }

    return new GraphModel(uuidv4(), generation.id, 'config', nodes, edges,
      this.makeMetadata('TypeScript', 'regex', nodes.length, edges.length));
  }

  // ─── Control Flow Graph ──────────────────────────────────────────

  async buildControlFlowGraph(generation: Generation): Promise<Graph> {
    const code = this.extractCodeFromMarkdown(generation.generatedCode);
    const language = this.detectLanguage(code);

    try {
      if (language === 'Python') {
        return this.buildPythonCFG(code, generation);
      } else if (language === 'TypeScript') {
        return this.buildTSCFG(code, generation);
      }
    } catch (err) {
      console.warn(`[EnhancedGraphConstructor] CFG failed, using fallback:`, err);
    }
    return this.fallback.buildControlFlowGraph(generation);
  }

  private buildPythonCFG(code: string, generation: Generation): Graph {
    const result = this.toolBridge.executePythonScript('analyze_structure', code, { analysis: 'cfg' }) as any;
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const func of (result.functions || [])) {
      const funcId = uuidv4();
      const funcProps: Record<string, unknown> = {
        line: func.line,
        hasReturnType: func.hasReturnType,
        isAsync: func.isAsync,
      };
      nodes.push(new GraphNodeModel(funcId, func.name, 'function', funcProps));

      const cfgNodes = func.cfgNodes || [];
      // Use branching CFG if block metadata is present
      if (cfgNodes.length > 0 && cfgNodes[0].blockId !== undefined) {
        this.buildBranchingCFG(func.name, func.line, funcProps, cfgNodes, funcId, nodes, edges);
      } else {
        // Fallback: linear chaining
        let prevId = funcId;
        for (const cfgNode of cfgNodes) {
          const nodeId = uuidv4();
          const nodeType = cfgNode.type === 'if' ? 'conditional' :
                           cfgNode.type === 'for' || cfgNode.type === 'while' ? 'loop' :
                           cfgNode.type;

          const props: Record<string, unknown> = { line: cfgNode.line };
          props['functionScope'] = funcId;
          if (cfgNode.condition) props['condition'] = cfgNode.condition;
          if (cfgNode.loopType) props['cfgType'] = cfgNode.loopType;

          nodes.push(new GraphNodeModel(nodeId, cfgNode.type, nodeType, props));
          edges.push(new GraphEdgeModel(prevId, nodeId, 'control-flow', {}));
          prevId = nodeId;
        }
      }
    }

    return new GraphModel(uuidv4(), generation.id, 'cfg', nodes, edges,
      this.makeMetadata('Python', 'ast', nodes.length, edges.length));
  }

  private buildTSCFG(code: string, generation: Generation): Graph {
    const result = this.tsAnalyzer.analyzeControlFlow(code);
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    for (const func of result.functions) {
      const funcId = uuidv4();
      const funcProps: Record<string, unknown> = {
        line: func.line,
        hasReturnType: func.hasReturnType,
        isAsync: func.isAsync,
      };
      nodes.push(new GraphNodeModel(funcId, func.name, 'function', funcProps));

      const cfgNodes = func.cfgNodes;
      // Use branching CFG if block metadata is present
      if (cfgNodes.length > 0 && cfgNodes[0]!.blockId !== undefined) {
        this.buildBranchingCFG(func.name, func.line, funcProps, cfgNodes, funcId, nodes, edges);
      } else {
        // Fallback: linear chaining
        let prevId = funcId;
        for (const cfgNode of cfgNodes) {
          const nodeId = uuidv4();
          const props: Record<string, unknown> = { line: cfgNode.line };
          props['functionScope'] = funcId;
          if (cfgNode.condition) props['condition'] = cfgNode.condition;
          if (cfgNode.loopType) props['cfgType'] = cfgNode.loopType;

          nodes.push(new GraphNodeModel(nodeId, cfgNode.type, cfgNode.type, props));
          edges.push(new GraphEdgeModel(prevId, nodeId, 'control-flow', {}));
          prevId = nodeId;
        }
      }
    }

    return new GraphModel(uuidv4(), generation.id, 'cfg', nodes, edges,
      this.makeMetadata('TypeScript', 'typescript-compiler-api', nodes.length, edges.length));
  }

  // ─── Branching CFG Builder ────────────────────────────────────────

  /**
   * Build a branching CFG from cfgNodes that have block metadata.
   * Creates proper branch/join/loop edges instead of linear chaining.
   */
  private buildBranchingCFG(
    funcName: string,
    funcLine: number,
    _funcProps: Record<string, unknown>,
    cfgNodes: any[],
    funcId: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ): void {
    // 1. Create a synthetic function-exit sentinel node
    const exitId = uuidv4();
    nodes.push(new GraphNodeModel(exitId, `${funcName}:exit`, 'function-exit', {
      line: funcLine,
      functionScope: funcId,
      synthetic: true,
    }));

    // 2. Create graph nodes for all cfgNodes, tracking their IDs and block membership
    interface CfgEntry {
      graphNodeId: string;
      cfgNode: any;
      index: number;
    }

    const entries: CfgEntry[] = [];
    const blockEntries = new Map<string, CfgEntry[]>(); // blockId → entries in that block

    for (let i = 0; i < cfgNodes.length; i++) {
      const cfgNode = cfgNodes[i];
      const nodeId = uuidv4();
      const nodeType = cfgNode.type === 'if' ? 'conditional' :
                       cfgNode.type === 'for' || cfgNode.type === 'while' ? 'loop' :
                       cfgNode.type;

      const props: Record<string, unknown> = {
        line: cfgNode.line,
        functionScope: funcId,
        blockId: cfgNode.blockId,
        parentBlockId: cfgNode.parentBlockId,
        blockKind: cfgNode.blockKind,
        isTerminator: cfgNode.isTerminator || false,
      };
      if (cfgNode.condition) props['condition'] = cfgNode.condition;
      if (cfgNode.loopType) props['cfgType'] = cfgNode.loopType;
      if (cfgNode.functionScope) props['originalScope'] = cfgNode.functionScope;

      nodes.push(new GraphNodeModel(nodeId, cfgNode.type, nodeType, props));

      const entry: CfgEntry = { graphNodeId: nodeId, cfgNode, index: i };
      entries.push(entry);

      const blockId = cfgNode.blockId as string;
      if (!blockEntries.has(blockId)) {
        blockEntries.set(blockId, []);
      }
      blockEntries.get(blockId)!.push(entry);
    }

    // 3. Connect function entry to first node in root block (blk_0)
    const rootBlock = this.findFirstNodeInBlock(blockEntries, 'blk_0');
    if (rootBlock) {
      edges.push(new GraphEdgeModel(funcId, rootBlock.graphNodeId, 'control-flow', { branch: 'entry' }));
    }

    // 4. Create edges within blocks and between blocks
    for (const [blockId, blockNodes] of blockEntries) {
      for (let i = 0; i < blockNodes.length; i++) {
        const current = blockNodes[i]!;
        const next = i + 1 < blockNodes.length ? blockNodes[i + 1]! : null;
        const cfgNode = current.cfgNode;
        const isTerminator = cfgNode.isTerminator || false;
        const nodeType = cfgNode.type;

        // Handle return/raise: connect to exit sentinel
        if (nodeType === 'return' || nodeType === 'raise') {
          edges.push(new GraphEdgeModel(current.graphNodeId, exitId, 'control-flow', { branch: nodeType }));
          continue; // No sequential edge after terminator
        }

        // Handle break/continue: terminators that don't get sequential edges
        if (nodeType === 'break' || nodeType === 'continue') {
          // break/continue edges are handled by loop context
          // For now, just connect to the exit as a placeholder — the BFS will
          // properly handle reachability through the join edges
          continue;
        }

        // Handle branching constructs
        if (nodeType === 'conditional' || nodeType === 'if') {
          // Find child blocks for true/false branches
          const trueFirst = this.findFirstNodeInChildBlock(entries, blockId, 'if_true', current.index);
          const falseFirst = this.findFirstNodeInChildBlock(entries, blockId, 'if_false', current.index);
          const caseFirst = this.findFirstNodeInChildBlock(entries, blockId, 'case_body', current.index);

          if (trueFirst) {
            edges.push(new GraphEdgeModel(current.graphNodeId, trueFirst.graphNodeId, 'control-flow', { branch: 'true' }));
          }
          if (falseFirst) {
            edges.push(new GraphEdgeModel(current.graphNodeId, falseFirst.graphNodeId, 'control-flow', { branch: 'false' }));
          }
          if (caseFirst) {
            // For switch: connect to first case body
            edges.push(new GraphEdgeModel(current.graphNodeId, caseFirst.graphNodeId, 'control-flow', { branch: 'true' }));
          }

          // If no else branch, connect directly to next sibling
          if (!falseFirst && !caseFirst && next) {
            edges.push(new GraphEdgeModel(current.graphNodeId, next.graphNodeId, 'control-flow', { branch: 'false' }));
          }

          // Join edges: end of each branch → next sibling in current block
          if (next) {
            const trueLastNonTerm = this.findLastNonTerminatorInChildBlock(entries, blockId, 'if_true', current.index);
            const falseLastNonTerm = this.findLastNonTerminatorInChildBlock(entries, blockId, 'if_false', current.index);
            const caseLastNonTerm = this.findLastNonTerminatorInChildBlock(entries, blockId, 'case_body', current.index);

            if (trueLastNonTerm) {
              edges.push(new GraphEdgeModel(trueLastNonTerm.graphNodeId, next.graphNodeId, 'control-flow', { branch: 'join' }));
            }
            if (falseLastNonTerm) {
              edges.push(new GraphEdgeModel(falseLastNonTerm.graphNodeId, next.graphNodeId, 'control-flow', { branch: 'join' }));
            }
            if (caseLastNonTerm) {
              edges.push(new GraphEdgeModel(caseLastNonTerm.graphNodeId, next.graphNodeId, 'control-flow', { branch: 'join' }));
            }
          }

          continue;
        }

        if (nodeType === 'loop') {
          // Connect loop to body
          const loopKind = cfgNode.loopType === 'for' ? 'for_body' : 'while_body';
          const bodyFirst = this.findFirstNodeInChildBlock(entries, blockId, loopKind, current.index);

          if (bodyFirst) {
            edges.push(new GraphEdgeModel(current.graphNodeId, bodyFirst.graphNodeId, 'control-flow', { branch: 'loop-entry' }));

            // Loop-back: end of body → loop node
            const bodyLastNonTerm = this.findLastNonTerminatorInChildBlock(entries, blockId, loopKind, current.index);
            if (bodyLastNonTerm) {
              edges.push(new GraphEdgeModel(bodyLastNonTerm.graphNodeId, current.graphNodeId, 'control-flow', { branch: 'loop-back' }));
            }
          }

          // Loop-exit: connect to next sibling
          if (next) {
            edges.push(new GraphEdgeModel(current.graphNodeId, next.graphNodeId, 'control-flow', { branch: 'loop-exit' }));
          }

          continue;
        }

        if (nodeType === 'try') {
          // Connect try to body
          const tryBodyFirst = this.findFirstNodeInChildBlock(entries, blockId, 'try_body', current.index);
          const exceptFirst = this.findFirstNodeInChildBlock(entries, blockId, 'except_handler', current.index);
          const finallyFirst = this.findFirstNodeInChildBlock(entries, blockId, 'finally', current.index);
          const tryElseFirst = this.findFirstNodeInChildBlock(entries, blockId, 'try_else', current.index);

          if (tryBodyFirst) {
            edges.push(new GraphEdgeModel(current.graphNodeId, tryBodyFirst.graphNodeId, 'control-flow', { branch: 'try-body' }));
          }
          if (exceptFirst) {
            edges.push(new GraphEdgeModel(current.graphNodeId, exceptFirst.graphNodeId, 'control-flow', { branch: 'except' }));
          }
          if (finallyFirst) {
            edges.push(new GraphEdgeModel(current.graphNodeId, finallyFirst.graphNodeId, 'control-flow', { branch: 'finally' }));
          }
          if (tryElseFirst) {
            // try-else connects from end of try body
            const tryBodyLast = this.findLastNonTerminatorInChildBlock(entries, blockId, 'try_body', current.index);
            if (tryBodyLast) {
              edges.push(new GraphEdgeModel(tryBodyLast.graphNodeId, tryElseFirst.graphNodeId, 'control-flow', { branch: 'sequential' }));
            }
          }

          // Join: ends of try/except/finally → next sibling
          if (next) {
            for (const kind of ['try_body', 'except_handler', 'finally', 'try_else']) {
              const last = this.findLastNonTerminatorInChildBlock(entries, blockId, kind, current.index);
              if (last) {
                edges.push(new GraphEdgeModel(last.graphNodeId, next.graphNodeId, 'control-flow', { branch: 'join' }));
              }
            }
          }

          continue;
        }

        if (nodeType === 'with') {
          const withBodyFirst = this.findFirstNodeInChildBlock(entries, blockId, 'with_body', current.index);
          if (withBodyFirst) {
            edges.push(new GraphEdgeModel(current.graphNodeId, withBodyFirst.graphNodeId, 'control-flow', { branch: 'sequential' }));
          }
          if (next) {
            const withBodyLast = this.findLastNonTerminatorInChildBlock(entries, blockId, 'with_body', current.index);
            if (withBodyLast) {
              edges.push(new GraphEdgeModel(withBodyLast.graphNodeId, next.graphNodeId, 'control-flow', { branch: 'join' }));
            }
          }
          continue;
        }

        // Sequential edge to next node in same block (skip if current is terminator)
        if (!isTerminator && next) {
          edges.push(new GraphEdgeModel(current.graphNodeId, next.graphNodeId, 'control-flow', { branch: 'sequential' }));
        }
      }
    }
  }

  /** Find the first CfgEntry in a child block with the given kind, appearing after `afterIndex` in the entries array. */
  private findFirstNodeInChildBlock(
    entries: Array<{ graphNodeId: string; cfgNode: any; index: number }>,
    parentBlockId: string,
    blockKind: string,
    afterIndex: number,
  ): { graphNodeId: string; cfgNode: any; index: number } | null {
    for (const entry of entries) {
      if (entry.index <= afterIndex) continue;
      if (entry.cfgNode.parentBlockId === parentBlockId && entry.cfgNode.blockKind === blockKind) {
        return entry;
      }
    }
    return null;
  }

  /** Find the last non-terminator CfgEntry in a child block with the given kind, appearing after `afterIndex`. */
  private findLastNonTerminatorInChildBlock(
    entries: Array<{ graphNodeId: string; cfgNode: any; index: number }>,
    parentBlockId: string,
    blockKind: string,
    afterIndex: number,
  ): { graphNodeId: string; cfgNode: any; index: number } | null {
    let last: { graphNodeId: string; cfgNode: any; index: number } | null = null;
    for (const entry of entries) {
      if (entry.index <= afterIndex) continue;
      if (entry.cfgNode.parentBlockId === parentBlockId && entry.cfgNode.blockKind === blockKind) {
        if (!entry.cfgNode.isTerminator) {
          last = entry;
        }
      }
    }
    return last;
  }

  /** Find the first CfgEntry in a specific block by blockId. */
  private findFirstNodeInBlock(
    blockEntries: Map<string, Array<{ graphNodeId: string; cfgNode: any; index: number }>>,
    blockId: string,
  ): { graphNodeId: string; cfgNode: any; index: number } | null {
    const entries = blockEntries.get(blockId);
    if (!entries || entries.length === 0) return null;
    return entries[0]!;
  }

  // ─── Resource Graph ──────────────────────────────────────────────

  async buildResourceGraph(generation: Generation): Promise<Graph> {
    const code = this.extractCodeFromMarkdown(generation.generatedCode);
    const language = this.detectLanguage(code);

    try {
      if (language === 'Python') {
        return this.buildPythonResourceGraph(code, generation);
      } else if (language === 'TypeScript') {
        return this.buildTSResourceGraph(code, generation);
      }
    } catch (err) {
      console.warn(`[EnhancedGraphConstructor] Resource graph failed, using fallback:`, err);
    }
    return this.fallback.buildResourceGraph(generation);
  }

  private buildPythonResourceGraph(code: string, generation: Generation): Graph {
    const result = this.toolBridge.executePythonScript('analyze_resources', code) as any;
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Create a source file node to anchor edges
    const sourceId = uuidv4();
    nodes.push(new GraphNodeModel(sourceId, 'generated_code', 'source_file', {
      language: 'Python',
    }));

    for (const res of (result.resources || [])) {
      const resId = uuidv4();
      nodes.push(new GraphNodeModel(resId, res.referenced_path, 'resource_reference', {
        resourceType: res.type,
        line: res.line,
        sourceFile: res.file,
      }));
      edges.push(new GraphEdgeModel(sourceId, resId, 'references', {
        line: res.line,
        resourceType: res.type,
      }));
    }

    return new GraphModel(uuidv4(), generation.id, 'resource', nodes, edges,
      this.makeMetadata('Python', 'ast', nodes.length, edges.length));
  }

  private buildTSResourceGraph(code: string, generation: Generation): Graph {
    const result = this.tsAnalyzer.analyzeResources(code);
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    const sourceId = uuidv4();
    nodes.push(new GraphNodeModel(sourceId, 'generated_code', 'source_file', {
      language: 'TypeScript',
    }));

    for (const res of result.resources) {
      const resId = uuidv4();
      nodes.push(new GraphNodeModel(resId, res.referencedPath, 'resource_reference', {
        resourceType: res.type,
        line: res.line,
        callExpression: res.callExpression,
      }));
      edges.push(new GraphEdgeModel(sourceId, resId, 'references', {
        line: res.line,
        resourceType: res.type,
      }));
    }

    return new GraphModel(uuidv4(), generation.id, 'resource', nodes, edges,
      this.makeMetadata('TypeScript', 'typescript-compiler-api', nodes.length, edges.length));
  }

  // ─── Routing Graph ─────────────────────────────────────────────

  async buildRoutingGraph(generation: Generation): Promise<Graph> {
    const code = this.extractCodeFromMarkdown(generation.generatedCode);
    const language = this.detectLanguage(code);

    try {
      if (language === 'Python') {
        return this.buildPythonRoutingGraph(code, generation);
      } else if (language === 'TypeScript') {
        return this.buildTSRoutingGraph(code, generation);
      }
    } catch (err) {
      console.warn(`[EnhancedGraphConstructor] Routing graph failed, using fallback:`, err);
    }
    return this.fallback.buildRoutingGraph(generation);
  }

  private buildPythonRoutingGraph(code: string, generation: Generation): Graph {
    const result = this.toolBridge.executePythonScript('analyze_routing', code) as any;
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Create route nodes
    for (const route of (result.routes || [])) {
      const routeId = uuidv4();
      nodes.push(new GraphNodeModel(routeId, route.path, 'route', {
        method: route.method,
        line: route.line,
        file: route.file,
        hasAuth: route.has_auth,
        guards: route.guards || [],
      }));

      // Create guard nodes and edges
      for (const guard of (route.guards || [])) {
        const guardId = uuidv4();
        nodes.push(new GraphNodeModel(guardId, guard, 'guard', {
          line: route.line,
        }));
        edges.push(new GraphEdgeModel(routeId, guardId, 'guarded_by', {}));
      }
    }

    // Create middleware nodes
    for (const mw of (result.middleware || [])) {
      const mwId = uuidv4();
      nodes.push(new GraphNodeModel(mwId, mw.name, 'middleware', {
        line: mw.line,
        middlewareType: mw.type,
      }));

      // Connect middleware to all routes (applies_to)
      for (const node of nodes) {
        if (node.type === 'route') {
          edges.push(new GraphEdgeModel(mwId, node.id, 'applies_to', {}));
        }
      }
    }

    return new GraphModel(uuidv4(), generation.id, 'routing', nodes, edges,
      this.makeMetadata('Python', 'ast', nodes.length, edges.length));
  }

  private buildTSRoutingGraph(code: string, generation: Generation): Graph {
    const result = this.tsAnalyzer.analyzeRouting(code);
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Create route nodes
    for (const route of result.routes) {
      const routeId = uuidv4();
      nodes.push(new GraphNodeModel(routeId, route.path, 'route', {
        method: route.method,
        line: route.line,
        handlerName: route.handlerName,
        hasAuth: route.hasAuth,
        guards: route.guards,
      }));

      // Create guard nodes and edges
      for (const guard of route.guards) {
        const guardId = uuidv4();
        nodes.push(new GraphNodeModel(guardId, guard, 'guard', {
          line: route.line,
        }));
        edges.push(new GraphEdgeModel(routeId, guardId, 'guarded_by', {}));
      }
    }

    // Create middleware nodes
    for (const mw of result.middleware) {
      const mwId = uuidv4();
      nodes.push(new GraphNodeModel(mwId, mw.name, 'middleware', {
        line: mw.line,
        path: mw.path,
        middlewareType: mw.type,
      }));

      // Connect middleware to matching routes
      for (const node of nodes) {
        if (node.type === 'route') {
          // If middleware has a path, only connect to routes that share the prefix
          if (mw.path) {
            const routePath = node.label;
            if (routePath.startsWith(mw.path)) {
              edges.push(new GraphEdgeModel(mwId, node.id, 'applies_to', {}));
            }
          } else {
            edges.push(new GraphEdgeModel(mwId, node.id, 'applies_to', {}));
          }
        }
      }
    }

    return new GraphModel(uuidv4(), generation.id, 'routing', nodes, edges,
      this.makeMetadata('TypeScript', 'typescript-compiler-api', nodes.length, edges.length));
  }

  // ─── Build All ───────────────────────────────────────────────────

  private isEnabled(type: GraphTypeName): boolean {
    return !this.config || this.config.isGraphEnabled(type);
  }

  async buildAllGraphs(generation: Generation): Promise<Graph[]> {
    const graphs: Graph[] = [];

    if (this.isEnabled('import'))     { try { graphs.push(await this.buildImportGraph(generation)); } catch (e) { console.error('Import graph error:', e); } }
    if (this.isEnabled('call'))       { try { graphs.push(await this.buildCallGraph(generation)); } catch (e) { console.error('Call graph error:', e); } }
    if (this.isEnabled('dependency')) { try { graphs.push(await this.buildDependencyGraph(generation)); } catch (e) { console.error('Dependency graph error:', e); } }
    if (this.isEnabled('schema'))     { try { graphs.push(await this.buildSchemaGraph(generation)); } catch (e) { console.error('Schema graph error:', e); } }
    if (this.isEnabled('config'))     { try { graphs.push(await this.buildConfigGraph(generation)); } catch (e) { console.error('Config graph error:', e); } }
    if (this.isEnabled('cfg'))        { try { graphs.push(await this.buildControlFlowGraph(generation)); } catch (e) { console.error('CFG error:', e); } }
    if (this.isEnabled('resource'))   { try { graphs.push(await this.buildResourceGraph(generation)); } catch (e) { console.error('Resource graph error:', e); } }
    if (this.isEnabled('routing'))    { try { graphs.push(await this.buildRoutingGraph(generation)); } catch (e) { console.error('Routing graph error:', e); } }

    return graphs;
  }
}
