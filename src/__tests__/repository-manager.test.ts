import { RepositoryManager } from '../services/RepositoryManager';
import { Repository } from '../types';
import * as fs from 'fs/promises';

// Mock fs module for testing
jest.mock('fs/promises');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('RepositoryManager', () => {
  let repositoryManager: RepositoryManager;

  beforeEach(() => {
    repositoryManager = new RepositoryManager();
    jest.clearAllMocks();
  });

  describe('loadBenchmarkRepos', () => {
    it('should load 50 SWE-bench and 30 EvoCodeBench repositories', async () => {
      const repos = await repositoryManager.loadBenchmarkRepos();
      
      // Should return 80 total repositories (50 SWE-bench + 30 EvoCodeBench)
      expect(repos).toHaveLength(80);
      
      // Check SWE-bench repositories
      const sweBenchRepos = repos.filter(repo => repo.source === 'SWE-bench');
      expect(sweBenchRepos).toHaveLength(50);
      
      // Check EvoCodeBench repositories
      const evoCodeBenchRepos = repos.filter(repo => repo.source === 'EvoCodeBench');
      expect(evoCodeBenchRepos).toHaveLength(30);
      
      // Verify all repositories are valid
      repos.forEach(repo => {
        expect(repositoryManager.validateRepository(repo)).toBe(true);
      });
    });

    it('should add repositories to internal list', async () => {
      await repositoryManager.loadBenchmarkRepos();
      const allRepos = repositoryManager.getAllRepositories();
      
      expect(allRepos).toHaveLength(80);
    });
  });

  describe('loadCuratedRepos', () => {
    it('should load 40 curated repositories (10 Python, 10 TS backend, 20 frontend)', async () => {
      const repos = await repositoryManager.loadCuratedRepos();

      // Should return 40 total repositories (10 Python + 10 TypeScript backend + 20 frontend)
      expect(repos).toHaveLength(40);
      
      // Check Python repositories (10 backend)
      const pythonRepos = repos.filter(repo => repo.language === 'Python');
      expect(pythonRepos).toHaveLength(10);

      // Check TypeScript repositories (10 backend + frontend TS repos)
      const typeScriptRepos = repos.filter(repo => repo.language === 'TypeScript');
      expect(typeScriptRepos.length).toBeGreaterThanOrEqual(10); // At least 10 backend TS repos

      // Check JavaScript repositories (frontend JS repos)
      const javaScriptRepos = repos.filter(repo => repo.language === 'JavaScript');
      expect(javaScriptRepos.length).toBeGreaterThanOrEqual(0);
      
      // All should be curated source
      repos.forEach(repo => {
        expect(repo.source).toBe('Curated');
      });
    });

    it('should validate all curated repositories meet requirements', async () => {
      const repos = await repositoryManager.loadCuratedRepos();
      
      repos.forEach(repo => {
        // Requirements 2.3, 2.4: Curated repository validation
        expect(repo.fileCount).toBeGreaterThanOrEqual(50);
        expect(repo.linesOfCode).toBeGreaterThanOrEqual(10000);
        // Type annotation coverage only required for TypeScript and Python
        if (repo.language !== 'JavaScript') {
          expect(repo.typeAnnotationCoverage).toBeGreaterThan(50);
        }
        expect(repo.testCoverage).toBeGreaterThan(60);
        expect(repositoryManager.validateRepository(repo)).toBe(true);
      });
    });
  });

  describe('getRepositoryMetadata', () => {
    beforeEach(() => {
      // Mock fs.stat to return directory stats
      mockFs.stat.mockResolvedValue({
        isDirectory: () => true,
        isFile: () => false
      } as any);

      // Mock fs.readdir to return sample files (avoid infinite recursion)
      mockFs.readdir.mockResolvedValue([
        { name: 'main.py', isDirectory: () => false, isFile: () => true },
        { name: 'test_main.py', isDirectory: () => false, isFile: () => true },
        { name: 'requirements.txt', isDirectory: () => false, isFile: () => true }
      ] as any);

      // Mock fs.readFile for different file types
      mockFs.readFile.mockImplementation((filePath: any) => {
        const pathStr = filePath.toString();
        if (pathStr.endsWith('requirements.txt')) {
          return Promise.resolve('fastapi==0.68.0\npydantic==1.8.2');
        } else if (pathStr.endsWith('main.py')) {
          return Promise.resolve('def hello() -> str:\n    return "world"\n\nclass User:\n    pass');
        } else if (pathStr.endsWith('test_main.py')) {
          return Promise.resolve('def test_hello():\n    assert hello() == "world"');
        }
        return Promise.resolve('');
      });
    });

    it('should extract repository metadata correctly', async () => {
      const metadata = await repositoryManager.getRepositoryMetadata('/fake/repo/path');
      
      expect(metadata.fileCount).toBeGreaterThan(0);
      expect(metadata.linesOfCode).toBeGreaterThan(0);
      expect(metadata.language).toBe('Python');
      expect(metadata.framework).toBe('FastAPI');
      expect(typeof metadata.typeAnnotationCoverage).toBe('number');
      expect(typeof metadata.testCoverage).toBe('number');
    });

    it('should handle non-directory paths', async () => {
      mockFs.stat.mockResolvedValue({
        isDirectory: () => false,
        isFile: () => true
      } as any);

      await expect(repositoryManager.getRepositoryMetadata('/fake/file/path'))
        .rejects.toThrow('Path /fake/file/path is not a directory');
    });

    it('should handle file system errors gracefully', async () => {
      mockFs.stat.mockRejectedValue(new Error('File not found'));

      await expect(repositoryManager.getRepositoryMetadata('/nonexistent/path'))
        .rejects.toThrow('Failed to extract repository metadata');
    });
  });

  describe('validateRepository', () => {
    it('should validate correct repository', () => {
      const validRepo: Repository = {
        id: 'repo-1',
        name: 'test-repo',
        framework: 'FastAPI',
        language: 'Python',
        fileCount: 100,
        linesOfCode: 15000,
        typeAnnotationCoverage: 75,
        testCoverage: 80,
        source: 'Curated'
      };

      expect(repositoryManager.validateRepository(validRepo)).toBe(true);
    });

    it('should reject invalid curated repository', () => {
      const invalidRepo: Repository = {
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

      expect(repositoryManager.validateRepository(invalidRepo)).toBe(false);
    });
  });

  describe('getAllRepositories', () => {
    it('should return empty array initially', () => {
      const repos = repositoryManager.getAllRepositories();
      expect(repos).toHaveLength(0);
    });

    it('should return all loaded repositories', async () => {
      await repositoryManager.loadBenchmarkRepos();
      await repositoryManager.loadCuratedRepos();

      const allRepos = repositoryManager.getAllRepositories();
      expect(allRepos).toHaveLength(120); // 80 benchmark + 40 curated (10 Python + 10 TS backend + 20 frontend)
    });

    it('should return a copy of the internal array', async () => {
      await repositoryManager.loadBenchmarkRepos();
      
      const repos1 = repositoryManager.getAllRepositories();
      const repos2 = repositoryManager.getAllRepositories();
      
      expect(repos1).not.toBe(repos2); // Different array instances
      expect(repos1).toEqual(repos2); // Same content
    });
  });

  describe('integration with requirements', () => {
    it('should meet requirement 2.1 - benchmark repository counts', async () => {
      const repos = await repositoryManager.loadBenchmarkRepos();
      
      const sweBenchCount = repos.filter(r => r.source === 'SWE-bench').length;
      const evoCodeBenchCount = repos.filter(r => r.source === 'EvoCodeBench').length;
      
      // Requirement 2.1: 50 SWE-bench Verified and 30 EvoCodeBench repositories
      expect(sweBenchCount).toBe(50);
      expect(evoCodeBenchCount).toBe(30);
    });

    it('should meet requirement 2.2 - curated repository counts', async () => {
      const repos = await repositoryManager.loadCuratedRepos();

      const pythonCount = repos.filter(r => r.language === 'Python').length;
      const typeScriptCount = repos.filter(r => r.language === 'TypeScript').length;
      const javaScriptCount = repos.filter(r => r.language === 'JavaScript').length;

      // Requirement 2.2: 10 Python and 10 TypeScript production repositories (backend)
      // Extended: 20 frontend repositories (React, Vue, Angular) with mixed TS/JS
      expect(pythonCount).toBe(10);
      expect(typeScriptCount).toBeGreaterThanOrEqual(10); // At least 10 backend TS repos
      expect(javaScriptCount).toBeGreaterThanOrEqual(0); // Frontend JS repos
      expect(repos.length).toBe(40); // Total: 10 Python + 10 TS backend + 20 frontend
    });

    it('should meet requirement 2.5 - metadata recording', async () => {
      const repos = await repositoryManager.loadCuratedRepos();
      
      repos.forEach(repo => {
        // Requirement 2.5: Record framework type, file count, and lines of code
        expect(repo.framework).toBeDefined();
        expect(['FastAPI', 'Django', 'Express', 'Next.js', 'React', 'Vue', 'Angular']).toContain(repo.framework);
        expect(typeof repo.fileCount).toBe('number');
        expect(repo.fileCount).toBeGreaterThan(0);
        expect(typeof repo.linesOfCode).toBe('number');
        expect(repo.linesOfCode).toBeGreaterThan(0);
      });
    });
  });
});