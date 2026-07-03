import { Task } from '../types';

export class TaskModel implements Task {
  constructor(
    public id: string,
    public repositoryId: string,
    public complexity: 'L1' | 'L2' | 'L3',
    public specification: string,
    public targetFiles: string[],
    public dependencies: string[],
    public derivedFrom: 'issue' | 'commit'
  ) {}

  static validate(data: any): string[] {
    const errors: string[] = [];

    if (!data.id || typeof data.id !== 'string') {
      errors.push('Task id must be a non-empty string');
    }

    if (!data.repositoryId || typeof data.repositoryId !== 'string') {
      errors.push('Task repositoryId must be a non-empty string');
    }

    const validComplexities = ['L1', 'L2', 'L3'];
    if (!validComplexities.includes(data.complexity)) {
      errors.push(`Task complexity must be one of: ${validComplexities.join(', ')}`);
    }

    if (!data.specification || typeof data.specification !== 'string') {
      errors.push('Task specification must be a non-empty string');
    }

    if (!Array.isArray(data.targetFiles)) {
      errors.push('Task targetFiles must be an array');
    } else if (data.targetFiles.some((file: any) => typeof file !== 'string')) {
      errors.push('All targetFiles must be strings');
    }

    if (!Array.isArray(data.dependencies)) {
      errors.push('Task dependencies must be an array');
    } else if (data.dependencies.some((dep: any) => typeof dep !== 'string')) {
      errors.push('All dependencies must be strings');
    }

    const validDerivedFrom = ['issue', 'commit'];
    if (!validDerivedFrom.includes(data.derivedFrom)) {
      errors.push(`Task derivedFrom must be one of: ${validDerivedFrom.join(', ')}`);
    }

    // Task complexity validation based on requirements 3.1, 3.2, 3.3
    if (data.complexity === 'L1' && data.targetFiles.length !== 1) {
      errors.push('L1 tasks must target exactly 1 file');
    }

    if (data.complexity === 'L2' && data.dependencies.length === 0) {
      errors.push('L2 tasks must have cross-file dependencies');
    }

    return errors;
  }

  static fromJSON(json: string): TaskModel {
    const data = JSON.parse(json);
    const errors = TaskModel.validate(data);
    
    if (errors.length > 0) {
      throw new Error(`Task validation failed: ${errors.join(', ')}`);
    }

    return new TaskModel(
      data.id,
      data.repositoryId,
      data.complexity,
      data.specification,
      data.targetFiles,
      data.dependencies,
      data.derivedFrom
    );
  }

  toJSON(): string {
    return JSON.stringify({
      id: this.id,
      repositoryId: this.repositoryId,
      complexity: this.complexity,
      specification: this.specification,
      targetFiles: this.targetFiles,
      dependencies: this.dependencies,
      derivedFrom: this.derivedFrom
    });
  }
}