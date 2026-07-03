import { TaskGenerator } from '../services/TaskGenerator';
import { Repository } from '../types';

describe('TaskGenerator', () => {
  let taskGenerator: TaskGenerator;
  let mockRepository: Repository;

  beforeEach(() => {
    taskGenerator = new TaskGenerator();
    mockRepository = {
      id: 'test-repo-1',
      name: 'test-repository',
      framework: 'FastAPI',
      language: 'Python',
      fileCount: 100,
      linesOfCode: 15000,
      typeAnnotationCoverage: 75,
      testCoverage: 80,
      source: 'SWE-bench'
    };
  });

  describe('generateL1Tasks', () => {
    it('should generate exactly 3 L1 tasks per repository', async () => {
      const tasks = await taskGenerator.generateL1Tasks(mockRepository);
      
      expect(tasks).toHaveLength(3);
      tasks.forEach(task => {
        expect(task.complexity).toBe('L1');
        expect(task.repositoryId).toBe(mockRepository.id);
        expect(task.targetFiles).toHaveLength(1);
        expect(task.dependencies).toHaveLength(0);
        expect(task.derivedFrom).toBe('issue'); // SWE-bench source
      });
    });
  });

  describe('generateL2Tasks', () => {
    it('should generate exactly 2 L2 tasks per repository', async () => {
      const tasks = await taskGenerator.generateL2Tasks(mockRepository);
      
      expect(tasks).toHaveLength(2);
      tasks.forEach(task => {
        expect(task.complexity).toBe('L2');
        expect(task.repositoryId).toBe(mockRepository.id);
        expect(task.targetFiles.length).toBeGreaterThan(1);
        expect(task.dependencies.length).toBeGreaterThan(0);
        expect(task.derivedFrom).toBe('issue');
      });
    });
  });

  describe('generateL3Tasks', () => {
    it('should generate exactly 1 L3 task per repository', async () => {
      const tasks = await taskGenerator.generateL3Tasks(mockRepository);
      
      expect(tasks).toHaveLength(1);
      const task = tasks[0]!;
      expect(task.complexity).toBe('L3');
      expect(task.repositoryId).toBe(mockRepository.id);
      expect(task.targetFiles.length).toBeGreaterThan(1);
      expect(task.dependencies.length).toBeGreaterThan(0);
      expect(task.derivedFrom).toBe('issue');
    });
  });

  describe('extractFromGitHistory', () => {
    it('should extract tasks from curated repositories', async () => {
      const curatedRepo: Repository = {
        ...mockRepository,
        source: 'Curated'
      };
      
      const tasks = await taskGenerator.extractFromGitHistory(curatedRepo);
      
      expect(tasks.length).toBeGreaterThan(0);
      tasks.forEach(task => {
        expect(task.repositoryId).toBe(curatedRepo.id);
        expect(task.derivedFrom).toBe('commit');
      });
    });

    it('should return empty array for non-curated repositories', async () => {
      const tasks = await taskGenerator.extractFromGitHistory(mockRepository);
      expect(tasks).toHaveLength(0);
    });
  });

  describe('deriveFromIssues', () => {
    it('should derive tasks from benchmark repositories', async () => {
      const tasks = await taskGenerator.deriveFromIssues(mockRepository);
      
      expect(tasks.length).toBeGreaterThan(0);
      tasks.forEach(task => {
        expect(task.repositoryId).toBe(mockRepository.id);
        expect(task.derivedFrom).toBe('issue');
      });
    });

    it('should return empty array for curated repositories', async () => {
      const curatedRepo: Repository = {
        ...mockRepository,
        source: 'Curated'
      };
      
      const tasks = await taskGenerator.deriveFromIssues(curatedRepo);
      expect(tasks).toHaveLength(0);
    });
  });

  describe('generateAllTasks', () => {
    it('should generate all task types for a repository', async () => {
      const tasks = await taskGenerator.generateAllTasks(mockRepository);
      
      // Should have 3 L1 + 2 L2 + 1 L3 + derived tasks
      expect(tasks.length).toBeGreaterThanOrEqual(6);
      
      const l1Tasks = tasks.filter(t => t.complexity === 'L1');
      const l2Tasks = tasks.filter(t => t.complexity === 'L2');
      const l3Tasks = tasks.filter(t => t.complexity === 'L3');
      
      // At least 3 L1 tasks (3 generated + potentially more from issues)
      expect(l1Tasks.length).toBeGreaterThanOrEqual(3);
      // At least 2 L2 tasks (2 generated + potentially more from issues)
      expect(l2Tasks.length).toBeGreaterThanOrEqual(2);
      // At least 1 L3 task (1 generated + potentially more from issues)
      expect(l3Tasks.length).toBeGreaterThanOrEqual(1);
    });
  });
});