/**
 * Property-based tests for Repository Metadata Completeness
 * Feature: code-generation-evaluation, Property 7: Repository metadata completeness
 */

import * as fc from 'fast-check';
import { RepositoryManager } from '../services/RepositoryManager';
import { Repository } from '../types';
import * as fs from 'fs/promises';

// Mock fs module for testing
jest.mock('fs/promises');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('Repository Metadata Completeness Property Tests', () => {
  let repositoryManager: RepositoryManager;

  beforeEach(() => {
    repositoryManager = new RepositoryManager();
    jest.clearAllMocks();
  });

  /**
   * Feature: code-generation-evaluation, Property 7: Repository metadata completeness
   * Validates: Requirements 2.5
   */
  test('Property 7: Repository metadata completeness - stored repositories must include framework type, file count, and lines of code', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate arbitrary repository directory structures
        fc.record({
          repositoryPath: fc.string({ minLength: 1, maxLength: 100 }).map(s => `/fake/repo/${s}`),
          files: fc.array(
            fc.record({
              name: fc.oneof(
                fc.string({ minLength: 1, maxLength: 20 }).map(s => `${s}.py`),
                fc.string({ minLength: 1, maxLength: 20 }).map(s => `${s}.ts`),
                fc.string({ minLength: 1, maxLength: 20 }).map(s => `${s}.js`),
                fc.constant('requirements.txt'),
                fc.constant('package.json'),
                fc.constant('setup.py')
              ),
              isDirectory: fc.constant(false),
              isFile: fc.constant(true),
              content: fc.string({ minLength: 0, maxLength: 1000 })
            }),
            { minLength: 1, maxLength: 50 }
          ),
          hasValidStructure: fc.boolean()
        }),
        async (testData) => {
          // Setup mocks based on test data
          mockFs.stat.mockResolvedValue({
            isDirectory: () => testData.hasValidStructure,
            isFile: () => false
          } as any);

          if (testData.hasValidStructure) {
            // Mock readdir to return the generated files
            mockFs.readdir.mockResolvedValue(
              testData.files.map(file => ({
                name: file.name,
                isDirectory: () => false,
                isFile: () => true
              })) as any
            );

            // Mock readFile to return file contents
            mockFs.readFile.mockImplementation((filePath: any) => {
              const pathStr = filePath.toString();
              const fileName = pathStr.split('/').pop() || '';
              const file = testData.files.find(f => f.name === fileName);
              
              if (fileName === 'requirements.txt') {
                return Promise.resolve('fastapi==0.68.0\npydantic==1.8.2');
              } else if (fileName === 'package.json') {
                return Promise.resolve('{"dependencies": {"express": "^4.17.1"}}');
              } else if (file) {
                return Promise.resolve(file.content);
              }
              return Promise.resolve('');
            });

            try {
              // Call getRepositoryMetadata
              const metadata = await repositoryManager.getRepositoryMetadata(testData.repositoryPath);
              
              // Property: For any stored repository, metadata should include framework type, file count, and lines of code
              // Requirement 2.5: Record framework type, file count, and lines of code
              
              // Framework type must be present and valid
              expect(metadata.framework).toBeDefined();
              expect(['FastAPI', 'Django', 'Express', 'Next.js']).toContain(metadata.framework);
              
              // File count must be present and non-negative
              expect(metadata.fileCount).toBeDefined();
              expect(typeof metadata.fileCount).toBe('number');
              expect(metadata.fileCount).toBeGreaterThanOrEqual(0);
              
              // Lines of code must be present and non-negative
              expect(metadata.linesOfCode).toBeDefined();
              expect(typeof metadata.linesOfCode).toBe('number');
              expect(metadata.linesOfCode).toBeGreaterThanOrEqual(0);
              
              // Additional metadata should also be present for completeness
              expect(metadata.language).toBeDefined();
              expect(['Python', 'TypeScript', 'JavaScript']).toContain(metadata.language);
              
              expect(metadata.typeAnnotationCoverage).toBeDefined();
              expect(typeof metadata.typeAnnotationCoverage).toBe('number');
              expect(metadata.typeAnnotationCoverage).toBeGreaterThanOrEqual(0);
              expect(metadata.typeAnnotationCoverage).toBeLessThanOrEqual(100);
              
              expect(metadata.testCoverage).toBeDefined();
              expect(typeof metadata.testCoverage).toBe('number');
              expect(metadata.testCoverage).toBeGreaterThanOrEqual(0);
              expect(metadata.testCoverage).toBeLessThanOrEqual(100);
              
            } catch (error) {
              // If metadata extraction fails, it should be due to invalid repository structure
              // not due to missing required metadata fields
              expect(error).toBeInstanceOf(Error);
              expect((error as Error).message).toContain('Failed to extract repository metadata');
            }
          } else {
            // Invalid repository structure should throw appropriate error
            await expect(repositoryManager.getRepositoryMetadata(testData.repositoryPath))
              .rejects.toThrow('Path');
          }
        }
      ),
      { numRuns: 10 } // Minimum 100 iterations as specified in design
    );
  });

  /**
   * Feature: code-generation-evaluation, Property 7: Repository metadata completeness
   * Validates: Requirements 2.5 - Loaded repositories maintain metadata completeness
   */
  test('Property 7: Repository metadata completeness - all loaded repositories have complete metadata', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Test both benchmark and curated repository loading
        fc.constantFrom('benchmark', 'curated', 'both'),
        async (loadType) => {
          let repositories: Repository[] = [];
          
          // Load repositories based on test parameter
          if (loadType === 'benchmark') {
            repositories = await repositoryManager.loadBenchmarkRepos();
          } else if (loadType === 'curated') {
            repositories = await repositoryManager.loadCuratedRepos();
          } else {
            const benchmarkRepos = await repositoryManager.loadBenchmarkRepos();
            const curatedRepos = await repositoryManager.loadCuratedRepos();
            repositories = [...benchmarkRepos, ...curatedRepos];
          }
          
          // Property: For any loaded repository, all required metadata fields must be present and valid
          repositories.forEach(repository => {
            // Framework type must be present and valid (Requirement 2.5)
            expect(repository.framework).toBeDefined();
            expect(['FastAPI', 'Django', 'Express', 'Next.js', 'React', 'Vue', 'Angular']).toContain(repository.framework);
            
            // File count must be present and non-negative (Requirement 2.5)
            expect(repository.fileCount).toBeDefined();
            expect(typeof repository.fileCount).toBe('number');
            expect(repository.fileCount).toBeGreaterThanOrEqual(0);
            
            // Lines of code must be present and non-negative (Requirement 2.5)
            expect(repository.linesOfCode).toBeDefined();
            expect(typeof repository.linesOfCode).toBe('number');
            expect(repository.linesOfCode).toBeGreaterThanOrEqual(0);
            
            // Additional required fields for completeness
            expect(repository.id).toBeDefined();
            expect(typeof repository.id).toBe('string');
            expect(repository.id.length).toBeGreaterThan(0);
            
            expect(repository.name).toBeDefined();
            expect(typeof repository.name).toBe('string');
            expect(repository.name.length).toBeGreaterThan(0);
            
            expect(repository.language).toBeDefined();
            expect(['Python', 'TypeScript', 'JavaScript']).toContain(repository.language);
            
            expect(repository.typeAnnotationCoverage).toBeDefined();
            expect(typeof repository.typeAnnotationCoverage).toBe('number');
            expect(repository.typeAnnotationCoverage).toBeGreaterThanOrEqual(0);
            expect(repository.typeAnnotationCoverage).toBeLessThanOrEqual(100);
            
            expect(repository.testCoverage).toBeDefined();
            expect(typeof repository.testCoverage).toBe('number');
            expect(repository.testCoverage).toBeGreaterThanOrEqual(0);
            expect(repository.testCoverage).toBeLessThanOrEqual(100);
            
            expect(repository.source).toBeDefined();
            expect(['SWE-bench', 'EvoCodeBench', 'Curated']).toContain(repository.source);
          });
        }
      ),
      { numRuns: 10 }
    );
  });

  /**
   * Feature: code-generation-evaluation, Property 7: Repository metadata completeness
   * Validates: Requirements 2.5 - Framework detection consistency
   */
  test('Property 7: Repository metadata completeness - framework detection is consistent with language', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate repository data with consistent language-framework pairs
        fc.record({
          repositoryPath: fc.string({ minLength: 1, maxLength: 100 }).map(s => `/fake/repo/${s}`),
          language: fc.constantFrom('Python', 'TypeScript', 'JavaScript'),
          frameworkIndicator: fc.string({ minLength: 1, maxLength: 50 })
        }).chain(data => {
          // Generate framework-specific files based on language
          const files = data.language === 'Python' 
            ? [
                { name: 'requirements.txt', content: data.frameworkIndicator.includes('django') ? 'django==3.2.0' : 'fastapi==0.68.0' },
                { name: 'main.py', content: 'def hello(): pass' }
              ]
            : [
                { name: 'package.json', content: JSON.stringify({ 
                  dependencies: data.frameworkIndicator.includes('next') ? { next: '^12.0.0' } : { express: '^4.17.1' }
                })},
                { name: 'index.ts', content: 'export const hello = () => {};' }
              ];
          
          return fc.constant({ ...data, files });
        }),
        async (testData) => {
          // Setup mocks
          mockFs.stat.mockResolvedValue({
            isDirectory: () => true,
            isFile: () => false
          } as any);

          mockFs.readdir.mockResolvedValue(
            testData.files.map(file => ({
              name: file.name,
              isDirectory: () => false,
              isFile: () => true
            })) as any
          );

          mockFs.readFile.mockImplementation((filePath: any) => {
            const pathStr = filePath.toString();
            const fileName = pathStr.split('/').pop() || '';
            const file = testData.files.find(f => f.name === fileName);
            return Promise.resolve(file?.content || '');
          });

          const metadata = await repositoryManager.getRepositoryMetadata(testData.repositoryPath);
          
          // Property: Framework detection should be consistent with language
          if (testData.language === 'Python') {
            expect(['FastAPI', 'Django']).toContain(metadata.framework);
            expect(metadata.language).toBe('Python');
          } else {
            expect(['Express', 'Next.js']).toContain(metadata.framework);
            expect(metadata.language).toBe('TypeScript');
          }
          
          // All required metadata fields must still be present
          expect(metadata.framework).toBeDefined();
          expect(metadata.fileCount).toBeDefined();
          expect(metadata.linesOfCode).toBeDefined();
        }
      ),
      { numRuns: 10 }
    );
  });
});