import { Graph, Generation } from '../types';

export interface IGraphConstructor {
  /**
   * Build import graph using AST analysis for Python or TypeScript compiler API
   */
  buildImportGraph(generation: Generation): Promise<Graph>;

  /**
   * Build call graph using AST analysis for Python or TypeScript compiler API
   */
  buildCallGraph(generation: Generation): Promise<Graph>;

  /**
   * Build dependency graph from manifest and lockfile parsing
   */
  buildDependencyGraph(generation: Generation): Promise<Graph>;

  /**
   * Build schema graph from framework-specific schema extraction
   */
  buildSchemaGraph(generation: Generation): Promise<Graph>;

  /**
   * Build configuration graph using framework-specific parsers
   */
  buildConfigGraph(generation: Generation): Promise<Graph>;

  /**
   * Build control flow graph using Python ast module or TypeScript compiler API
   */
  buildControlFlowGraph(generation: Generation): Promise<Graph>;

  /**
   * Build resource graph detecting file/template path references
   */
  buildResourceGraph(generation: Generation): Promise<Graph>;

  /**
   * Build routing/middleware graph for SSR detection (auth guards, route patterns)
   */
  buildRoutingGraph(generation: Generation): Promise<Graph>;

  /**
   * Build all graph types for a generation
   */
  buildAllGraphs(generation: Generation): Promise<Graph[]>;
}