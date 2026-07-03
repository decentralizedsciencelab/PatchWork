import {
  RepositoryModel,
  TaskModel,
  GenerationModel,
  DetectionMetricsModel,
  SerializationUtils
} from '../models';

describe('Data Models', () => {
  describe('RepositoryModel', () => {
    it('should validate and serialize/deserialize correctly', () => {
      const repo = new RepositoryModel(
        'repo-1',
        'test-repo',
        'FastAPI',
        'Python',
        100,
        15000,
        75,
        80,
        'Curated'
      );

      const json = repo.toJSON();
      const deserialized = RepositoryModel.fromJSON(json);

      expect(deserialized.id).toBe(repo.id);
      expect(deserialized.name).toBe(repo.name);
      expect(deserialized.framework).toBe(repo.framework);
      expect(deserialized.language).toBe(repo.language);
      expect(deserialized.fileCount).toBe(repo.fileCount);
      expect(deserialized.linesOfCode).toBe(repo.linesOfCode);
      expect(deserialized.typeAnnotationCoverage).toBe(repo.typeAnnotationCoverage);
      expect(deserialized.testCoverage).toBe(repo.testCoverage);
      expect(deserialized.source).toBe(repo.source);
    });

    it('should validate curated repository requirements', () => {
      const invalidRepo = {
        id: 'repo-1',
        name: 'test-repo',
        framework: 'FastAPI',
        language: 'Python',
        fileCount: 30, // Too few files
        linesOfCode: 5000, // Too few lines
        typeAnnotationCoverage: 40, // Too low coverage
        testCoverage: 50, // Too low coverage
        source: 'Curated'
      };

      const errors = RepositoryModel.validate(invalidRepo);
      expect(errors).toContain('Curated repository must have minimum 50 files');
      expect(errors).toContain('Curated repository must have minimum 10K lines of code');
      expect(errors).toContain('Curated repository must have type annotation coverage > 50%');
      expect(errors).toContain('Curated repository must have test coverage > 60%');
    });
  });

  describe('TaskModel', () => {
    it('should validate and serialize/deserialize correctly', () => {
      const task = new TaskModel(
        'task-1',
        'repo-1',
        'L2',
        'Implement user authentication',
        ['auth.py', 'models.py'],
        ['database.py'],
        'issue'
      );

      const json = task.toJSON();
      const deserialized = TaskModel.fromJSON(json);

      expect(deserialized.id).toBe(task.id);
      expect(deserialized.repositoryId).toBe(task.repositoryId);
      expect(deserialized.complexity).toBe(task.complexity);
      expect(deserialized.specification).toBe(task.specification);
      expect(deserialized.targetFiles).toEqual(task.targetFiles);
      expect(deserialized.dependencies).toEqual(task.dependencies);
      expect(deserialized.derivedFrom).toBe(task.derivedFrom);
    });

    it('should validate L1 task constraints', () => {
      const invalidL1Task = {
        id: 'task-1',
        repositoryId: 'repo-1',
        complexity: 'L1',
        specification: 'Test spec',
        targetFiles: ['file1.py', 'file2.py'], // L1 should have only 1 file
        dependencies: [],
        derivedFrom: 'issue'
      };

      const errors = TaskModel.validate(invalidL1Task);
      expect(errors).toContain('L1 tasks must target exactly 1 file');
    });
  });

  describe('GenerationModel', () => {
    it('should validate and serialize/deserialize correctly', () => {
      const generation = new GenerationModel(
        'gen-1',
        'task-1',
        'GPT-4o',
        'P2',
        ['file1.py', 'file2.py'],
        'def hello(): pass',
        new Date('2024-01-01T00:00:00Z')
      );

      const json = generation.toJSON();
      const deserialized = GenerationModel.fromJSON(json);

      expect(deserialized.id).toBe(generation.id);
      expect(deserialized.taskId).toBe(generation.taskId);
      expect(deserialized.model).toBe(generation.model);
      expect(deserialized.promptStrategy).toBe(generation.promptStrategy);
      expect(deserialized.contextFiles).toEqual(generation.contextFiles);
      expect(deserialized.generatedCode).toBe(generation.generatedCode);
      expect(deserialized.timestamp.toISOString()).toBe(generation.timestamp.toISOString());
    });

    it('should validate prompt strategy constraints', () => {
      const invalidP1Generation = {
        id: 'gen-1',
        taskId: 'task-1',
        model: 'GPT-4o',
        promptStrategy: 'P1',
        contextFiles: ['file1.py'], // P1 should have no context files
        generatedCode: 'code',
        timestamp: new Date()
      };

      const errors = GenerationModel.validate(invalidP1Generation);
      expect(errors).toContain('P1 prompting should provide only task description and target path (no context files)');
    });
  });

  describe('DetectionMetricsModel', () => {
    it('should validate metric calculations', () => {
      // TP=4, FP=1, FN=2
      // Precision = TP/(TP+FP) = 4/(4+1) = 0.8
      // Recall = TP/(TP+FN) = 4/(4+2) = 0.6666666666666666
      // F1 = 2*(P*R)/(P+R) = 2*(0.8*0.6666666666666666)/(0.8+0.6666666666666666) = 0.7272727272727273
      const metrics = new DetectionMetricsModel(
        'import',
        0.8,  // precision
        0.6666666666666666,  // recall
        0.7272727272727273, // f1Score (calculated)
        4,    // truePositives
        1,    // falsePositives
        2     // falseNegatives
      );

      const json = metrics.toJSON();
      const deserialized = DetectionMetricsModel.fromJSON(json);

      expect(deserialized.category).toBe(metrics.category);
      expect(deserialized.precision).toBeCloseTo(metrics.precision);
      expect(deserialized.recall).toBeCloseTo(metrics.recall);
      expect(deserialized.f1Score).toBeCloseTo(metrics.f1Score);
    });

    it('should reject invalid metric calculations', () => {
      const invalidMetrics = {
        category: 'import',
        precision: 0.9, // Incorrect calculation
        recall: 0.6,
        f1Score: 0.72,
        truePositives: 4,
        falsePositives: 1,
        falseNegatives: 2
      };

      const errors = DetectionMetricsModel.validate(invalidMetrics);
      expect(errors.some(error => error.includes('precision does not match calculated value'))).toBe(true);
    });
  });

  describe('SerializationUtils', () => {
    it('should handle safe JSON parsing', () => {
      const validData = { id: 'test', name: 'Test Repository' };
      const json = JSON.stringify(validData);
      
      const result = SerializationUtils.safeParseJSON(json, () => []);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(validData);
      }
    });

    it('should handle invalid JSON', () => {
      const invalidJson = '{ invalid json }';
      
      const result = SerializationUtils.safeParseJSON(invalidJson, () => []);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors[0]).toContain('JSON parsing failed');
      }
    });

    it('should validate round-trip serialization', () => {
      const repo = new RepositoryModel(
        'repo-1',
        'test-repo',
        'FastAPI',
        'Python',
        100,
        15000,
        75,
        80,
        'Curated'
      );

      const result = SerializationUtils.validateRoundTrip(
        repo,
        (r) => r.toJSON(),
        (json) => RepositoryModel.fromJSON(json)
      );

      expect(result.success).toBe(true);
    });
  });
});