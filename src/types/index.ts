// Core data model interfaces

export interface Repository {
  id: string;
  name: string;
  framework: 'FastAPI' | 'Django' | 'Express' | 'Next.js' | 'React' | 'Vue' | 'Angular';
  language: 'Python' | 'TypeScript' | 'JavaScript';
  fileCount: number;
  linesOfCode: number;
  typeAnnotationCoverage: number;
  testCoverage: number;
  source: 'SWE-bench' | 'EvoCodeBench' | 'Curated';
}

export interface Task {
  id: string;
  repositoryId: string;
  complexity: 'L1' | 'L2' | 'L3';
  specification: string;
  targetFiles: string[];
  dependencies: string[];
  derivedFrom: 'issue' | 'commit';
}

export interface Generation {
  id: string;
  taskId: string;
  model: 'GPT-4o' | 'Claude-3.5-Sonnet' | 'Qwen-7B' | 'Qwen2.5-Coder-32B' | 'CodeLlama-34B' | 'StarCoder2-15B' | 'StarCoder2-3B';
  promptStrategy: 'P1' | 'P2' | 'P3' | 'P4';
  contextFiles: string[];
  generatedCode: string;
  timestamp: Date;
}

export interface GraphNode {
  id: string;
  label: string;
  type: string;
  properties: Record<string, any>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  properties: Record<string, any>;
}

export interface Graph {
  id: string;
  generationId: string;
  type: 'import' | 'call' | 'dependency' | 'schema' | 'config' | 'cfg' | 'resource' | 'routing';
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: Record<string, any>;
}

export interface CodeLocation {
  file: string;
  line: number;
  column: number;
}

// Paper category mapping:
// BCI = Build/Configuration Incoherence (build & config problems)
// DHI = Dependency Hallucination (hallucinated or missing deps)
// PIA = Phantom Import/API (imports/APIs that don't exist)
// SRF = Schema/Resource/Return Failures (resource coherence failures)
// CFC = Control Flow Coherence (unreachable code, infinite loops)
// CCV = Cross-file Contract Violations (middleware, decorator, cross-file issues)
// SSR = Security Structural Regressions (auth & security structure issues)
// RCF = Resource Coherence Failures (filesystem resource failures, return contract violations, schema completeness)
export type FailureCategory = 'SRF' | 'PIA' | 'DHI' | 'BCI' | 'RCF' | 'CFC' | 'CCV' | 'SSR';

// Legacy category mapping for backwards compatibility
export type LegacyCategory = 'import' | 'call' | 'schema' | 'config' | 'type' | 'dependency';

export interface FailureDetection {
  id: string;
  generationId: string;
  category: FailureCategory | LegacyCategory;
  severity: 'error' | 'warning';
  description: string;
  location: CodeLocation;
  detectedBy: 'graph-analysis' | 'compile' | 'test' | 'sast' | 'regex';
}

export interface DetectionMetrics {
  category: string;
  precision: number;
  recall: number;
  f1Score: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
}

export interface FingerprintingMetrics {
  modelPair: string;
  jensenShannonDivergence: number;
  rateRatios: Record<string, number>;
  promptSensitivityVariance: number;
}