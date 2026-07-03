import { Repository } from '../types';

export class RepositoryModel implements Repository {
  constructor(
    public id: string,
    public name: string,
    public framework: 'FastAPI' | 'Django' | 'Express' | 'Next.js' | 'React' | 'Vue' | 'Angular',
    public language: 'Python' | 'TypeScript' | 'JavaScript',
    public fileCount: number,
    public linesOfCode: number,
    public typeAnnotationCoverage: number,
    public testCoverage: number,
    public source: 'SWE-bench' | 'EvoCodeBench' | 'Curated'
  ) {}

  static validate(data: any): string[] {
    const errors: string[] = [];

    if (!data.id || typeof data.id !== 'string') {
      errors.push('Repository id must be a non-empty string');
    }

    if (!data.name || typeof data.name !== 'string') {
      errors.push('Repository name must be a non-empty string');
    }

    const validFrameworks = ['FastAPI', 'Django', 'Express', 'Next.js', 'React', 'Vue', 'Angular'];
    if (!validFrameworks.includes(data.framework)) {
      errors.push(`Repository framework must be one of: ${validFrameworks.join(', ')}`);
    }

    const validLanguages = ['Python', 'TypeScript', 'JavaScript'];
    if (!validLanguages.includes(data.language)) {
      errors.push(`Repository language must be one of: ${validLanguages.join(', ')}`);
    }

    if (typeof data.fileCount !== 'number' || data.fileCount < 0) {
      errors.push('Repository fileCount must be a non-negative number');
    }

    if (typeof data.linesOfCode !== 'number' || data.linesOfCode < 0) {
      errors.push('Repository linesOfCode must be a non-negative number');
    }

    if (typeof data.typeAnnotationCoverage !== 'number' || 
        data.typeAnnotationCoverage < 0 || data.typeAnnotationCoverage > 100) {
      errors.push('Repository typeAnnotationCoverage must be a number between 0 and 100');
    }

    if (typeof data.testCoverage !== 'number' || 
        data.testCoverage < 0 || data.testCoverage > 100) {
      errors.push('Repository testCoverage must be a number between 0 and 100');
    }

    const validSources = ['SWE-bench', 'EvoCodeBench', 'Curated'];
    if (!validSources.includes(data.source)) {
      errors.push(`Repository source must be one of: ${validSources.join(', ')}`);
    }

    // Requirement 2.3, 2.4: Curated repository validation
    if (data.source === 'Curated') {
      if (data.fileCount < 50) {
        errors.push('Curated repository must have minimum 50 files');
      }
      if (data.linesOfCode < 10000) {
        errors.push('Curated repository must have minimum 10K lines of code');
      }
      // Type annotation coverage requirement only applies to TypeScript and Python
      // JavaScript uses JSDoc which is less common, so we relax the requirement
      if (data.language !== 'JavaScript' && data.typeAnnotationCoverage <= 50) {
        errors.push('Curated repository must have type annotation coverage > 50%');
      }
      if (data.testCoverage <= 60) {
        errors.push('Curated repository must have test coverage > 60%');
      }
    }

    return errors;
  }

  static fromJSON(json: string): RepositoryModel {
    const data = JSON.parse(json);
    const errors = RepositoryModel.validate(data);
    
    if (errors.length > 0) {
      throw new Error(`Repository validation failed: ${errors.join(', ')}`);
    }

    return new RepositoryModel(
      data.id,
      data.name,
      data.framework,
      data.language,
      data.fileCount,
      data.linesOfCode,
      data.typeAnnotationCoverage,
      data.testCoverage,
      data.source
    );
  }

  toJSON(): string {
    return JSON.stringify({
      id: this.id,
      name: this.name,
      framework: this.framework,
      language: this.language,
      fileCount: this.fileCount,
      linesOfCode: this.linesOfCode,
      typeAnnotationCoverage: this.typeAnnotationCoverage,
      testCoverage: this.testCoverage,
      source: this.source
    });
  }
}