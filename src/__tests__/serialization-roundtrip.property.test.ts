/**
 * Property-based tests for Serialization Round-trip Integrity
 * Feature: code-generation-evaluation, Property 15: Serialization round-trip integrity
 */

import * as fc from 'fast-check';
import { 
  Repository, 
  Task, 
  Generation, 
  Graph, 
  FailureDetection, 
  DetectionMetrics, 
  FingerprintingMetrics 
} from '../types';
import { 
  RepositoryModel, 
  TaskModel, 
  GenerationModel, 
  GraphModel, 
  FailureDetectionModel, 
  DetectionMetricsModel, 
  FingerprintingMetricsModel,
  SerializationUtils 
} from '../models';

describe('Serialization Round-trip Property Tests', () => {
  
  // Generators for creating valid test data
  const repositoryGenerator = fc.oneof(
    // Non-curated repositories (no special validation requirements)
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      name: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
      framework: fc.constantFrom('FastAPI' as const, 'Django' as const, 'Express' as const, 'Next.js' as const),
      language: fc.constantFrom('Python' as const, 'TypeScript' as const),
      fileCount: fc.integer({ min: 0, max: 1000 }),
      linesOfCode: fc.integer({ min: 0, max: 100000 }),
      typeAnnotationCoverage: fc.integer({ min: 0, max: 100 }),
      testCoverage: fc.integer({ min: 0, max: 100 }),
      source: fc.constantFrom('SWE-bench' as const, 'EvoCodeBench' as const)
    }),
    // Curated repositories (must meet validation requirements)
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      name: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
      framework: fc.constantFrom('FastAPI' as const, 'Django' as const, 'Express' as const, 'Next.js' as const),
      language: fc.constantFrom('Python' as const, 'TypeScript' as const),
      fileCount: fc.integer({ min: 50, max: 1000 }), // >= 50 files
      linesOfCode: fc.integer({ min: 10000, max: 100000 }), // >= 10K LOC
      typeAnnotationCoverage: fc.integer({ min: 51, max: 100 }), // > 50%
      testCoverage: fc.integer({ min: 61, max: 100 }), // > 60%
      source: fc.constant('Curated' as const)
    })
  );

  const taskGenerator = fc.oneof(
    // L1 tasks (single file)
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      repositoryId: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      complexity: fc.constant('L1' as const),
      specification: fc.string({ minLength: 1, maxLength: 500 }).filter(s => s.trim().length > 0),
      targetFiles: fc.array(fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0), { minLength: 1, maxLength: 1 }), // Exactly 1 file for L1
      dependencies: fc.array(fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0), { maxLength: 20 }),
      derivedFrom: fc.constantFrom('issue' as const, 'commit' as const)
    }),
    // L2 tasks (multiple files with dependencies)
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      repositoryId: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      complexity: fc.constant('L2' as const),
      specification: fc.string({ minLength: 1, maxLength: 500 }).filter(s => s.trim().length > 0),
      targetFiles: fc.array(fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0), { minLength: 1, maxLength: 10 }),
      dependencies: fc.array(fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0), { minLength: 1, maxLength: 20 }), // At least 1 dependency for L2
      derivedFrom: fc.constantFrom('issue' as const, 'commit' as const)
    }),
    // L3 tasks (cross-cutting)
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      repositoryId: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      complexity: fc.constant('L3' as const),
      specification: fc.string({ minLength: 1, maxLength: 500 }).filter(s => s.trim().length > 0),
      targetFiles: fc.array(fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0), { minLength: 1, maxLength: 10 }),
      dependencies: fc.array(fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0), { maxLength: 20 }),
      derivedFrom: fc.constantFrom('issue' as const, 'commit' as const)
    })
  );

  const generationGenerator = fc.oneof(
    // P1 prompting (no context files)
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      taskId: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      model: fc.constantFrom('GPT-4o' as const, 'Claude-3.5-Sonnet' as const, 'Qwen2.5-Coder-32B' as const),
      promptStrategy: fc.constant('P1' as const),
      contextFiles: fc.constant([]), // P1 has no context files
      generatedCode: fc.string({ minLength: 0, maxLength: 5000 }),
      timestamp: fc.date()
    }),
    // P2 prompting (2-5 context files)
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      taskId: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      model: fc.constantFrom('GPT-4o' as const, 'Claude-3.5-Sonnet' as const, 'Qwen2.5-Coder-32B' as const),
      promptStrategy: fc.constant('P2' as const),
      contextFiles: fc.array(fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0), { minLength: 2, maxLength: 5 }),
      generatedCode: fc.string({ minLength: 0, maxLength: 5000 }),
      timestamp: fc.date()
    }),
    // P3 prompting (exactly 10 context files)
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      taskId: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      model: fc.constantFrom('GPT-4o' as const, 'Claude-3.5-Sonnet' as const, 'Qwen2.5-Coder-32B' as const),
      promptStrategy: fc.constant('P3' as const),
      contextFiles: fc.array(fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0), { minLength: 10, maxLength: 10 }),
      generatedCode: fc.string({ minLength: 0, maxLength: 5000 }),
      timestamp: fc.date()
    }),
    // P4 prompting (5-15 context files)
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      taskId: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      model: fc.constantFrom('GPT-4o' as const, 'Claude-3.5-Sonnet' as const, 'Qwen2.5-Coder-32B' as const),
      promptStrategy: fc.constant('P4' as const),
      contextFiles: fc.array(fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0), { minLength: 5, maxLength: 15 }),
      generatedCode: fc.string({ minLength: 0, maxLength: 5000 }),
      timestamp: fc.date()
    })
  );

  const graphNodeGenerator = fc.record({
    id: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    label: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
    type: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    properties: fc.dictionary(fc.string().filter(s => s.length > 0), fc.oneof(fc.string(), fc.integer(), fc.boolean()))
  });

  const graphEdgeGenerator = fc.record({
    source: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    target: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    type: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    properties: fc.dictionary(fc.string().filter(s => s.length > 0), fc.oneof(fc.string(), fc.integer(), fc.boolean()))
  });

  const graphGenerator = fc.record({
    id: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    generationId: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    type: fc.constantFrom('import' as const, 'call' as const, 'dependency' as const, 'schema' as const, 'config' as const, 'cfg' as const),
    nodes: fc.array(graphNodeGenerator, { maxLength: 20 }),
    edges: fc.array(graphEdgeGenerator, { maxLength: 50 }),
    metadata: fc.dictionary(fc.string().filter(s => s.length > 0), fc.oneof(fc.string(), fc.integer(), fc.boolean()))
  });

  const codeLocationGenerator = fc.record({
    file: fc.string({ minLength: 1, maxLength: 200 }).filter(s => s.trim().length > 0),
    line: fc.integer({ min: 1, max: 10000 }),
    column: fc.integer({ min: 0, max: 200 })
  });

  const failureDetectionGenerator = fc.record({
    id: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    generationId: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    category: fc.constantFrom('import' as const, 'call' as const, 'schema' as const, 'config' as const, 'type' as const, 'dependency' as const),
    severity: fc.constantFrom('error' as const, 'warning' as const),
    description: fc.string({ minLength: 1, maxLength: 500 }).filter(s => s.trim().length > 0),
    location: codeLocationGenerator,
    detectedBy: fc.constantFrom('graph-analysis' as const, 'compile' as const, 'test' as const, 'sast' as const, 'regex' as const)
  });

  const detectionMetricsGenerator = fc.record({
    category: fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
    truePositives: fc.integer({ min: 0, max: 1000 }),
    falsePositives: fc.integer({ min: 0, max: 1000 }),
    falseNegatives: fc.integer({ min: 0, max: 1000 })
  }).map(data => {
    // Calculate derived metrics to ensure consistency
    const precision = data.truePositives + data.falsePositives > 0 
      ? data.truePositives / (data.truePositives + data.falsePositives) 
      : 0;
    const recall = data.truePositives + data.falseNegatives > 0 
      ? data.truePositives / (data.truePositives + data.falseNegatives) 
      : 0;
    const f1Score = precision + recall > 0 
      ? 2 * (precision * recall) / (precision + recall) 
      : 0;
    
    return {
      ...data,
      precision,
      recall,
      f1Score
    };
  });

  const fingerprintingMetricsGenerator = fc.record({
    modelPair: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
    jensenShannonDivergence: fc.float({ min: 0, max: 1, noNaN: true }),
    rateRatios: fc.dictionary(fc.string().filter(s => s.length > 0), fc.float({ min: 0, max: 10, noNaN: true })),
    promptSensitivityVariance: fc.float({ min: 0, max: 100, noNaN: true })
  });

  /**
   * Feature: code-generation-evaluation, Property 15: Serialization round-trip integrity
   * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
   */
  test('Property 15: Repository serialization round-trip preserves data integrity', async () => {
    await fc.assert(
      fc.property(
        repositoryGenerator,
        (repositoryData: Repository) => {
          // Create repository model
          const repository = new RepositoryModel(
            repositoryData.id,
            repositoryData.name,
            repositoryData.framework,
            repositoryData.language,
            repositoryData.fileCount,
            repositoryData.linesOfCode,
            repositoryData.typeAnnotationCoverage,
            repositoryData.testCoverage,
            repositoryData.source
          );

          // Serialize to JSON
          const serialized = repository.toJSON();
          expect(typeof serialized).toBe('string');

          // Deserialize back to object
          const deserialized = RepositoryModel.fromJSON(serialized);

          // Verify round-trip integrity
          expect(deserialized.id).toBe(repository.id);
          expect(deserialized.name).toBe(repository.name);
          expect(deserialized.framework).toBe(repository.framework);
          expect(deserialized.language).toBe(repository.language);
          expect(deserialized.fileCount).toBe(repository.fileCount);
          expect(deserialized.linesOfCode).toBe(repository.linesOfCode);
          expect(deserialized.typeAnnotationCoverage).toBe(repository.typeAnnotationCoverage);
          expect(deserialized.testCoverage).toBe(repository.testCoverage);
          expect(deserialized.source).toBe(repository.source);

          // Verify type safety - deserialized object should be instance of RepositoryModel
          expect(deserialized).toBeInstanceOf(RepositoryModel);
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: code-generation-evaluation, Property 15: Serialization round-trip integrity
   * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
   */
  test('Property 15: Task serialization round-trip preserves data integrity', async () => {
    await fc.assert(
      fc.property(
        taskGenerator,
        (taskData: Task) => {
          const task = new TaskModel(
            taskData.id,
            taskData.repositoryId,
            taskData.complexity,
            taskData.specification,
            taskData.targetFiles,
            taskData.dependencies,
            taskData.derivedFrom
          );

          const serialized = task.toJSON();
          const deserialized = TaskModel.fromJSON(serialized);

          expect(deserialized.id).toBe(task.id);
          expect(deserialized.repositoryId).toBe(task.repositoryId);
          expect(deserialized.complexity).toBe(task.complexity);
          expect(deserialized.specification).toBe(task.specification);
          expect(deserialized.targetFiles).toEqual(task.targetFiles);
          expect(deserialized.dependencies).toEqual(task.dependencies);
          expect(deserialized.derivedFrom).toBe(task.derivedFrom);
          expect(deserialized).toBeInstanceOf(TaskModel);
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: code-generation-evaluation, Property 15: Serialization round-trip integrity
   * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
   */
  test('Property 15: Generation serialization round-trip preserves data integrity including Date objects', async () => {
    await fc.assert(
      fc.property(
        generationGenerator,
        (generationData: Generation) => {
          const generation = new GenerationModel(
            generationData.id,
            generationData.taskId,
            generationData.model,
            generationData.promptStrategy,
            generationData.contextFiles,
            generationData.generatedCode,
            generationData.timestamp
          );

          const serialized = generation.toJSON();
          const deserialized = GenerationModel.fromJSON(serialized);

          expect(deserialized.id).toBe(generation.id);
          expect(deserialized.taskId).toBe(generation.taskId);
          expect(deserialized.model).toBe(generation.model);
          expect(deserialized.promptStrategy).toBe(generation.promptStrategy);
          expect(deserialized.contextFiles).toEqual(generation.contextFiles);
          expect(deserialized.generatedCode).toBe(generation.generatedCode);
          
          // Date objects should be preserved (converted to/from ISO string)
          expect(deserialized.timestamp).toBeInstanceOf(Date);
          expect(deserialized.timestamp.getTime()).toBe(generation.timestamp.getTime());
          expect(deserialized).toBeInstanceOf(GenerationModel);
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: code-generation-evaluation, Property 15: Serialization round-trip integrity
   * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
   */
  test('Property 15: Graph serialization round-trip preserves complex nested structures', async () => {
    await fc.assert(
      fc.property(
        graphGenerator,
        (graphData: Graph) => {
          // Ensure edge references are valid (edges must reference existing nodes)
          const nodeIds = graphData.nodes.map(node => node.id);
          const validEdges = graphData.edges.filter(edge => 
            nodeIds.includes(edge.source) && nodeIds.includes(edge.target)
          );
          
          const validGraphData = { ...graphData, edges: validEdges };
          
          const graph = new GraphModel(
            validGraphData.id,
            validGraphData.generationId,
            validGraphData.type,
            validGraphData.nodes,
            validGraphData.edges,
            validGraphData.metadata
          );

          const serialized = graph.toJSON();
          const deserialized = GraphModel.fromJSON(serialized);

          expect(deserialized.id).toBe(graph.id);
          expect(deserialized.generationId).toBe(graph.generationId);
          expect(deserialized.type).toBe(graph.type);
          expect(deserialized.nodes).toEqual(graph.nodes);
          expect(deserialized.edges).toEqual(graph.edges);
          expect(deserialized.metadata).toEqual(graph.metadata);
          expect(deserialized).toBeInstanceOf(GraphModel);
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: code-generation-evaluation, Property 15: Serialization round-trip integrity
   * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
   */
  test('Property 15: FailureDetection serialization round-trip preserves nested objects', async () => {
    await fc.assert(
      fc.property(
        failureDetectionGenerator,
        (failureData: FailureDetection) => {
          const failure = new FailureDetectionModel(
            failureData.id,
            failureData.generationId,
            failureData.category,
            failureData.severity,
            failureData.description,
            failureData.location,
            failureData.detectedBy
          );

          const serialized = failure.toJSON();
          const deserialized = FailureDetectionModel.fromJSON(serialized);

          expect(deserialized.id).toBe(failure.id);
          expect(deserialized.generationId).toBe(failure.generationId);
          expect(deserialized.category).toBe(failure.category);
          expect(deserialized.severity).toBe(failure.severity);
          expect(deserialized.description).toBe(failure.description);
          expect(deserialized.location).toEqual(failure.location);
          expect(deserialized.detectedBy).toBe(failure.detectedBy);
          expect(deserialized).toBeInstanceOf(FailureDetectionModel);
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: code-generation-evaluation, Property 15: Serialization round-trip integrity
   * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
   */
  test('Property 15: DetectionMetrics serialization round-trip preserves calculated values', async () => {
    await fc.assert(
      fc.property(
        detectionMetricsGenerator,
        (metricsData: DetectionMetrics) => {
          const metrics = new DetectionMetricsModel(
            metricsData.category,
            metricsData.precision,
            metricsData.recall,
            metricsData.f1Score,
            metricsData.truePositives,
            metricsData.falsePositives,
            metricsData.falseNegatives
          );

          const serialized = metrics.toJSON();
          const deserialized = DetectionMetricsModel.fromJSON(serialized);

          expect(deserialized.category).toBe(metrics.category);
          expect(deserialized.precision).toBeCloseTo(metrics.precision, 10);
          expect(deserialized.recall).toBeCloseTo(metrics.recall, 10);
          expect(deserialized.f1Score).toBeCloseTo(metrics.f1Score, 10);
          expect(deserialized.truePositives).toBe(metrics.truePositives);
          expect(deserialized.falsePositives).toBe(metrics.falsePositives);
          expect(deserialized.falseNegatives).toBe(metrics.falseNegatives);
          expect(deserialized).toBeInstanceOf(DetectionMetricsModel);
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: code-generation-evaluation, Property 15: Serialization round-trip integrity
   * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
   */
  test('Property 15: FingerprintingMetrics serialization round-trip preserves Record types', async () => {
    await fc.assert(
      fc.property(
        fingerprintingMetricsGenerator,
        (metricsData: FingerprintingMetrics) => {
          const metrics = new FingerprintingMetricsModel(
            metricsData.modelPair,
            metricsData.jensenShannonDivergence,
            metricsData.rateRatios,
            metricsData.promptSensitivityVariance
          );

          const serialized = metrics.toJSON();
          const deserialized = FingerprintingMetricsModel.fromJSON(serialized);

          expect(deserialized.modelPair).toBe(metrics.modelPair);
          expect(deserialized.jensenShannonDivergence).toBeCloseTo(metrics.jensenShannonDivergence, 10);
          expect(deserialized.rateRatios).toEqual(metrics.rateRatios);
          expect(deserialized.promptSensitivityVariance).toBeCloseTo(metrics.promptSensitivityVariance, 10);
          expect(deserialized).toBeInstanceOf(FingerprintingMetricsModel);
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: code-generation-evaluation, Property 15: Serialization round-trip integrity
   * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
   */
  test('Property 15: SerializationUtils validateRoundTrip works for all model types', async () => {
    await fc.assert(
      fc.property(
        fc.oneof(
          repositoryGenerator,
          taskGenerator,
          generationGenerator,
          failureDetectionGenerator,
          detectionMetricsGenerator,
          fingerprintingMetricsGenerator
        ),
        (data: any) => {
          let model: any;
          let ModelClass: any;

          // Determine model type and create appropriate instance
          if ('framework' in data && 'language' in data) {
            ModelClass = RepositoryModel;
            model = new RepositoryModel(data.id, data.name, data.framework, data.language, 
              data.fileCount, data.linesOfCode, data.typeAnnotationCoverage, data.testCoverage, data.source);
          } else if ('complexity' in data && 'specification' in data) {
            ModelClass = TaskModel;
            model = new TaskModel(data.id, data.repositoryId, data.complexity, data.specification, 
              data.targetFiles, data.dependencies, data.derivedFrom);
          } else if ('model' in data && 'promptStrategy' in data) {
            ModelClass = GenerationModel;
            model = new GenerationModel(data.id, data.taskId, data.model, data.promptStrategy, 
              data.contextFiles, data.generatedCode, data.timestamp);
          } else if ('category' in data && 'severity' in data) {
            ModelClass = FailureDetectionModel;
            model = new FailureDetectionModel(data.id, data.generationId, data.category, data.severity, 
              data.description, data.location, data.detectedBy);
          } else if ('precision' in data && 'recall' in data) {
            ModelClass = DetectionMetricsModel;
            model = new DetectionMetricsModel(data.category, data.precision, data.recall, data.f1Score, 
              data.truePositives, data.falsePositives, data.falseNegatives);
          } else if ('jensenShannonDivergence' in data) {
            ModelClass = FingerprintingMetricsModel;
            model = new FingerprintingMetricsModel(data.modelPair, data.jensenShannonDivergence, 
              data.rateRatios, data.promptSensitivityVariance);
          } else {
            return; // Skip unknown data types
          }

          // Test round-trip using SerializationUtils
          const result = SerializationUtils.validateRoundTrip(
            model,
            (obj) => obj.toJSON(),
            (json) => ModelClass.fromJSON(json)
          );

          expect(result.success).toBe(true);
          if (!result.success) {
            throw new Error(`Round-trip validation failed: ${result.error}`);
          }
        }
      ),
      { numRuns: 10 }
    );
  });
});