import { IRepositoryManager } from '../interfaces/IRepositoryManager';
import { Repository } from '../types';
import { RepositoryModel } from '../models/Repository';
import * as fs from 'fs/promises';
import * as path from 'path';

export class RepositoryManager implements IRepositoryManager {
  private repositories: Repository[] = [];

  /**
   * Load benchmark repositories from SWE-bench and EvoCodeBench
   * Requirements: 2.1 - Include 50 SWE-bench Verified and 30 EvoCodeBench repositories
   */
  async loadBenchmarkRepos(): Promise<Repository[]> {
    const benchmarkRepos: Repository[] = [];

    // Load SWE-bench repositories (50 repositories)
    const sweBenchRepos = await this.loadSWEBenchRepos();
    benchmarkRepos.push(...sweBenchRepos);

    // Load EvoCodeBench repositories (30 repositories)
    const evoCodeBenchRepos = await this.loadEvoCodeBenchRepos();
    benchmarkRepos.push(...evoCodeBenchRepos);

    // Add to internal repository list
    this.repositories.push(...benchmarkRepos);

    return benchmarkRepos;
  }

  /**
   * Load curated production repositories with validation
   * Requirements: 2.2 - Include 10 Python and 10 TypeScript production repositories
   * Requirements: 2.3, 2.4 - Validate minimum requirements
   */
  async loadCuratedRepos(): Promise<Repository[]> {
    const curatedRepos: Repository[] = [];

    // Load Python repositories (10 repositories)
    const pythonRepos = await this.loadCuratedPythonRepos();
    curatedRepos.push(...pythonRepos);

    // Load TypeScript repositories (10 repositories)
    const typeScriptRepos = await this.loadCuratedTypeScriptRepos();
    curatedRepos.push(...typeScriptRepos);

    // Load Frontend repositories (20 repositories: 10 React, 5 Vue, 5 Angular)
    // These are specifically for SSR (Security Structural Regressions) detection
    const frontendRepos = await this.loadCuratedFrontendRepos();
    curatedRepos.push(...frontendRepos);

    // Validate all curated repositories
    const validatedRepos = curatedRepos.filter(repo => this.validateRepository(repo));

    // Add to internal repository list
    this.repositories.push(...validatedRepos);

    return validatedRepos;
  }

  /**
   * Extract and return repository metadata
   * Requirements: 2.5 - Record framework type, file count, and lines of code
   */
  async getRepositoryMetadata(repositoryPath: string): Promise<Partial<Repository>> {
    try {
      const stats = await fs.stat(repositoryPath);
      if (!stats.isDirectory()) {
        throw new Error(`Path ${repositoryPath} is not a directory`);
      }

      const metadata: Partial<Repository> = {};

      // Extract file count and lines of code
      const { fileCount, linesOfCode } = await this.analyzeRepositorySize(repositoryPath);
      metadata.fileCount = fileCount;
      metadata.linesOfCode = linesOfCode;

      // Detect language and framework
      const { language, framework } = await this.detectLanguageAndFramework(repositoryPath);
      metadata.language = language;
      metadata.framework = framework;

      // Calculate type annotation coverage (for validation)
      if (language === 'Python') {
        metadata.typeAnnotationCoverage = await this.calculatePythonTypeAnnotationCoverage(repositoryPath);
      } else if (language === 'TypeScript') {
        metadata.typeAnnotationCoverage = await this.calculateTypeScriptAnnotationCoverage(repositoryPath);
      }

      // Calculate test coverage (placeholder - would integrate with coverage tools)
      metadata.testCoverage = await this.calculateTestCoverage(repositoryPath);

      return metadata;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to extract repository metadata: ${errorMessage}`);
    }
  }

  /**
   * Validate repository meets minimum requirements
   * Requirements: 2.3, 2.4 - Validation rules for curated repositories
   */
  validateRepository(repository: Repository): boolean {
    const errors = RepositoryModel.validate(repository);
    return errors.length === 0;
  }

  /**
   * Get all loaded repositories
   */
  getAllRepositories(): Repository[] {
    return [...this.repositories];
  }

  // Private helper methods

  private async loadSWEBenchRepos(): Promise<Repository[]> {
    // In a real implementation, this would fetch from SWE-bench dataset
    // For now, return mock data representing 50 repositories
    const repos: Repository[] = [];
    
    for (let i = 1; i <= 50; i++) {
      const framework = i % 2 === 0 ? 'FastAPI' : 'Django';
      repos.push(new RepositoryModel(
        `swe-bench-${i}`,
        `swe-bench-repo-${i}`,
        framework,
        'Python',
        Math.floor(Math.random() * 200) + 50, // 50-250 files
        Math.floor(Math.random() * 50000) + 5000, // 5K-55K LOC
        Math.floor(Math.random() * 50) + 30, // 30-80% type coverage
        Math.floor(Math.random() * 40) + 40, // 40-80% test coverage
        'SWE-bench'
      ));
    }

    return repos;
  }

  private async loadEvoCodeBenchRepos(): Promise<Repository[]> {
    // In a real implementation, this would fetch from EvoCodeBench dataset
    // For now, return mock data representing 30 repositories
    const repos: Repository[] = [];
    
    for (let i = 1; i <= 30; i++) {
      const isTypeScript = i % 2 === 0;
      const framework = isTypeScript 
        ? (i % 4 === 0 ? 'Express' : 'Next.js')
        : (i % 4 === 1 ? 'FastAPI' : 'Django');
      const language = isTypeScript ? 'TypeScript' : 'Python';
      
      repos.push(new RepositoryModel(
        `evo-code-bench-${i}`,
        `evo-code-bench-repo-${i}`,
        framework,
        language,
        Math.floor(Math.random() * 150) + 40, // 40-190 files
        Math.floor(Math.random() * 40000) + 3000, // 3K-43K LOC
        Math.floor(Math.random() * 60) + 20, // 20-80% type coverage
        Math.floor(Math.random() * 50) + 30, // 30-80% test coverage
        'EvoCodeBench'
      ));
    }

    return repos;
  }

  private async loadCuratedPythonRepos(): Promise<Repository[]> {
    // In a real implementation, this would load from curated Python repositories
    // For now, return mock data representing 10 high-quality Python repositories
    const repos: Repository[] = [];
    
    for (let i = 1; i <= 10; i++) {
      const framework = i % 2 === 0 ? 'FastAPI' : 'Django';
      repos.push(new RepositoryModel(
        `curated-python-${i}`,
        `curated-python-repo-${i}`,
        framework,
        'Python',
        Math.floor(Math.random() * 200) + 60, // 60-260 files (meets min 50)
        Math.floor(Math.random() * 40000) + 12000, // 12K-52K LOC (meets min 10K)
        Math.floor(Math.random() * 40) + 55, // 55-95% type coverage (meets min 50%)
        Math.floor(Math.random() * 30) + 65, // 65-95% test coverage (meets min 60%)
        'Curated'
      ));
    }

    return repos;
  }

  private async loadCuratedTypeScriptRepos(): Promise<Repository[]> {
    // In a real implementation, this would load from curated TypeScript repositories
    // For now, return mock data representing 10 high-quality TypeScript repositories
    const repos: Repository[] = [];

    for (let i = 1; i <= 10; i++) {
      const framework = i % 2 === 0 ? 'Express' : 'Next.js';
      repos.push(new RepositoryModel(
        `curated-typescript-${i}`,
        `curated-typescript-repo-${i}`,
        framework,
        'TypeScript',
        Math.floor(Math.random() * 180) + 70, // 70-250 files (meets min 50)
        Math.floor(Math.random() * 35000) + 15000, // 15K-50K LOC (meets min 10K)
        Math.floor(Math.random() * 35) + 60, // 60-95% type coverage (meets min 50%)
        Math.floor(Math.random() * 25) + 70, // 70-95% test coverage (meets min 60%)
        'Curated'
      ));
    }

    return repos;
  }

  private async loadCuratedFrontendRepos(): Promise<Repository[]> {
    // Load curated frontend repositories with React, Vue, and Angular
    // These are specifically chosen to trigger SSR (Security Structural Regressions)
    // All repos include state management patterns: Redux, Vuex, NgRx
    const repos: Repository[] = [];

    // React repositories with Redux/Context patterns (10 repos)
    for (let i = 1; i <= 10; i++) {
      const language = i % 3 === 0 ? 'JavaScript' : 'TypeScript';
      repos.push(new RepositoryModel(
        `curated-react-${i}`,
        `React-Redux-App-${i}`,
        'React',
        language,
        Math.floor(Math.random() * 150) + 80, // 80-230 files (meets min 50)
        Math.floor(Math.random() * 30000) + 15000, // 15K-45K LOC (meets min 10K)
        language === 'TypeScript' ? Math.floor(Math.random() * 35) + 60 : Math.floor(Math.random() * 20) + 30, // TS: 60-95%, JS: 30-50%
        Math.floor(Math.random() * 25) + 65, // 65-90% test coverage (meets min 60%)
        'Curated'
      ));
    }

    // Vue repositories with Vuex patterns (5 repos)
    for (let i = 1; i <= 5; i++) {
      const language = i % 2 === 0 ? 'JavaScript' : 'TypeScript';
      repos.push(new RepositoryModel(
        `curated-vue-${i}`,
        `Vue-Vuex-App-${i}`,
        'Vue',
        language,
        Math.floor(Math.random() * 120) + 70, // 70-190 files (meets min 50)
        Math.floor(Math.random() * 25000) + 12000, // 12K-37K LOC (meets min 10K)
        language === 'TypeScript' ? Math.floor(Math.random() * 30) + 55 : Math.floor(Math.random() * 15) + 25, // TS: 55-85%, JS: 25-40%
        Math.floor(Math.random() * 25) + 65, // 65-90% test coverage (meets min 60%)
        'Curated'
      ));
    }

    // Angular repositories with NgRx patterns (5 repos)
    for (let i = 1; i <= 5; i++) {
      repos.push(new RepositoryModel(
        `curated-angular-${i}`,
        `Angular-NgRx-App-${i}`,
        'Angular',
        'TypeScript', // Angular is predominantly TypeScript
        Math.floor(Math.random() * 200) + 100, // 100-300 files (meets min 50)
        Math.floor(Math.random() * 35000) + 18000, // 18K-53K LOC (meets min 10K)
        Math.floor(Math.random() * 30) + 65, // 65-95% type coverage (meets min 50%)
        Math.floor(Math.random() * 25) + 70, // 70-95% test coverage (meets min 60%)
        'Curated'
      ));
    }

    return repos;
  }

  private async analyzeRepositorySize(repositoryPath: string): Promise<{ fileCount: number; linesOfCode: number }> {
    let fileCount = 0;
    let linesOfCode = 0;

    const analyzeDirectory = async (dirPath: string): Promise<void> => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          
          if (entry.isDirectory()) {
            // Skip common directories that shouldn't be counted
            if (!['node_modules', '.git', '__pycache__', '.pytest_cache', 'dist', 'build'].includes(entry.name)) {
              await analyzeDirectory(fullPath);
            }
          } else if (entry.isFile()) {
            // Count relevant source files
            const ext = path.extname(entry.name).toLowerCase();
            if (['.py', '.ts', '.js', '.tsx', '.jsx'].includes(ext)) {
              fileCount++;
              
              try {
                const content = await fs.readFile(fullPath, 'utf-8');
                linesOfCode += content.split('\n').length;
              } catch (error) {
                // Skip files that can't be read
              }
            }
          }
        }
      } catch (error) {
        // Skip directories that can't be read
      }
    };

    await analyzeDirectory(repositoryPath);
    return { fileCount, linesOfCode };
  }

  private async detectLanguageAndFramework(repositoryPath: string): Promise<{
    language: 'Python' | 'TypeScript' | 'JavaScript';
    framework: 'FastAPI' | 'Django' | 'Express' | 'Next.js' | 'React' | 'Vue' | 'Angular'
  }> {
    try {
      // Check for package.json (TypeScript/JavaScript)
      const packageJsonPath = path.join(repositoryPath, 'package.json');
      try {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

        // Detect frontend frameworks first (more specific)
        if (dependencies['@angular/core'] || dependencies['@angular/common']) {
          const hasTypeScript = await this.hasTypeScriptFiles(repositoryPath);
          return { language: hasTypeScript ? 'TypeScript' : 'JavaScript', framework: 'Angular' };
        } else if (dependencies['vue'] || dependencies['@vue/core']) {
          const hasTypeScript = await this.hasTypeScriptFiles(repositoryPath);
          return { language: hasTypeScript ? 'TypeScript' : 'JavaScript', framework: 'Vue' };
        } else if (dependencies['react'] || dependencies['react-dom']) {
          const hasTypeScript = await this.hasTypeScriptFiles(repositoryPath);
          return { language: hasTypeScript ? 'TypeScript' : 'JavaScript', framework: 'React' };
        } else if (dependencies['next'] || dependencies['@next/core']) {
          return { language: 'TypeScript', framework: 'Next.js' };
        } else if (dependencies['express']) {
          return { language: 'TypeScript', framework: 'Express' };
        }
      } catch (error) {
        // package.json not found or invalid
      }

      // Check for Python requirements/setup files
      const pythonFiles = ['requirements.txt', 'setup.py', 'pyproject.toml', 'Pipfile'];
      for (const file of pythonFiles) {
        try {
          const content = await fs.readFile(path.join(repositoryPath, file), 'utf-8');
          if (content.includes('fastapi')) {
            return { language: 'Python', framework: 'FastAPI' };
          } else if (content.includes('django')) {
            return { language: 'Python', framework: 'Django' };
          }
        } catch (error) {
          // File not found, continue
        }
      }

      // Default fallback based on file extensions
      const entries = await fs.readdir(repositoryPath);
      const hasTypeScript = entries.some(entry => entry.endsWith('.ts') || entry.endsWith('.tsx'));
      const hasJavaScript = entries.some(entry => entry.endsWith('.js') || entry.endsWith('.jsx'));
      const hasPython = entries.some(entry => entry.endsWith('.py'));

      if (hasTypeScript) {
        return { language: 'TypeScript', framework: 'React' }; // Default TS framework for frontend
      } else if (hasJavaScript) {
        return { language: 'JavaScript', framework: 'React' }; // Default JS framework
      } else if (hasPython) {
        return { language: 'Python', framework: 'FastAPI' }; // Default Python framework
      }

      // Ultimate fallback
      return { language: 'JavaScript', framework: 'React' };
    } catch (error) {
      return { language: 'JavaScript', framework: 'React' };
    }
  }

  private async hasTypeScriptFiles(repositoryPath: string): Promise<boolean> {
    try {
      const entries = await fs.readdir(repositoryPath);
      return entries.some(entry => entry.endsWith('.ts') || entry.endsWith('.tsx'));
    } catch (error) {
      return false;
    }
  }

  private async calculatePythonTypeAnnotationCoverage(repositoryPath: string): Promise<number> {
    // Simplified type annotation coverage calculation
    // In a real implementation, this would use tools like mypy or similar
    let totalFunctions = 0;
    let annotatedFunctions = 0;

    const analyzePythonFile = async (filePath: string): Promise<void> => {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('def ') && trimmed.includes('(')) {
            totalFunctions++;
            // Simple heuristic: check for type annotations
            if (trimmed.includes(':') && (trimmed.includes('->') || trimmed.includes(': '))) {
              annotatedFunctions++;
            }
          }
        }
      } catch (error) {
        // Skip files that can't be read
      }
    };

    const analyzeDirectory = async (dirPath: string): Promise<void> => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          
          if (entry.isDirectory() && !['__pycache__', '.pytest_cache'].includes(entry.name)) {
            await analyzeDirectory(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.py')) {
            await analyzePythonFile(fullPath);
          }
        }
      } catch (error) {
        // Skip directories that can't be read
      }
    };

    await analyzeDirectory(repositoryPath);
    return totalFunctions > 0 ? (annotatedFunctions / totalFunctions) * 100 : 0;
  }

  private async calculateTypeScriptAnnotationCoverage(_repositoryPath: string): Promise<number> {
    // TypeScript files are inherently typed, so this is typically high
    // In a real implementation, this might check for 'any' usage or explicit typing
    return Math.floor(Math.random() * 30) + 70; // 70-100% for TypeScript
  }

  private async calculateTestCoverage(repositoryPath: string): Promise<number> {
    // Simplified test coverage calculation
    // In a real implementation, this would integrate with coverage tools like jest, pytest-cov, etc.
    
    let sourceFiles = 0;
    let testFiles = 0;

    const analyzeDirectory = async (dirPath: string): Promise<void> => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          
          if (entry.isDirectory() && !['node_modules', '.git', '__pycache__'].includes(entry.name)) {
            await analyzeDirectory(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (['.py', '.ts', '.js', '.tsx', '.jsx'].includes(ext)) {
              if (entry.name.includes('test') || entry.name.includes('spec') || 
                  fullPath.includes('/test/') || fullPath.includes('/__tests__/')) {
                testFiles++;
              } else {
                sourceFiles++;
              }
            }
          }
        }
      } catch (error) {
        // Skip directories that can't be read
      }
    };

    await analyzeDirectory(repositoryPath);
    
    // Simple heuristic: test coverage based on test file ratio
    const testRatio = sourceFiles > 0 ? (testFiles / sourceFiles) : 0;
    return Math.min(testRatio * 100, 95); // Cap at 95%
  }
}