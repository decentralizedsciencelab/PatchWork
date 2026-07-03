import { FailureDetection, CodeLocation, FailureCategory, LegacyCategory } from '../types';

export class CodeLocationModel implements CodeLocation {
  constructor(
    public file: string,
    public line: number,
    public column: number
  ) {}

  static validate(data: any): string[] {
    const errors: string[] = [];

    if (!data.file || typeof data.file !== 'string') {
      errors.push('CodeLocation file must be a non-empty string');
    }

    if (typeof data.line !== 'number' || data.line < 1) {
      errors.push('CodeLocation line must be a positive number');
    }

    if (typeof data.column !== 'number' || data.column < 0) {
      errors.push('CodeLocation column must be a non-negative number');
    }

    return errors;
  }
}

export class FailureDetectionModel implements FailureDetection {
  constructor(
    public id: string,
    public generationId: string,
    public category: FailureCategory | LegacyCategory,
    public severity: 'error' | 'warning',
    public description: string,
    public location: CodeLocation,
    public detectedBy: 'graph-analysis' | 'compile' | 'test' | 'sast' | 'regex'
  ) {}

  static validate(data: any): string[] {
    const errors: string[] = [];

    if (!data.id || typeof data.id !== 'string') {
      errors.push('FailureDetection id must be a non-empty string');
    }

    if (!data.generationId || typeof data.generationId !== 'string') {
      errors.push('FailureDetection generationId must be a non-empty string');
    }

    // Support both paper categories and legacy categories
    const validCategories = [
      // Paper categories
      'SRF', 'PIA', 'DHI', 'BCI', 'RCF', 'CFC', 'CCV', 'SSR',
      // Legacy categories
      'import', 'call', 'schema', 'config', 'type', 'dependency'
    ];
    if (!validCategories.includes(data.category)) {
      errors.push(`FailureDetection category must be one of: ${validCategories.join(', ')}`);
    }

    const validSeverities = ['error', 'warning'];
    if (!validSeverities.includes(data.severity)) {
      errors.push(`FailureDetection severity must be one of: ${validSeverities.join(', ')}`);
    }

    if (!data.description || typeof data.description !== 'string') {
      errors.push('FailureDetection description must be a non-empty string');
    }

    if (!data.location) {
      errors.push('FailureDetection location is required');
    } else {
      const locationErrors = CodeLocationModel.validate(data.location);
      locationErrors.forEach(error => errors.push(`Location: ${error}`));
    }

    const validDetectedBy = ['graph-analysis', 'compile', 'test', 'sast', 'regex'];
    if (!validDetectedBy.includes(data.detectedBy)) {
      errors.push(`FailureDetection detectedBy must be one of: ${validDetectedBy.join(', ')}`);
    }

    return errors;
  }

  static fromJSON(json: string): FailureDetectionModel {
    const data = JSON.parse(json);
    const errors = FailureDetectionModel.validate(data);
    
    if (errors.length > 0) {
      throw new Error(`FailureDetection validation failed: ${errors.join(', ')}`);
    }

    return new FailureDetectionModel(
      data.id,
      data.generationId,
      data.category,
      data.severity,
      data.description,
      data.location,
      data.detectedBy
    );
  }

  toJSON(): string {
    return JSON.stringify({
      id: this.id,
      generationId: this.generationId,
      category: this.category,
      severity: this.severity,
      description: this.description,
      location: this.location,
      detectedBy: this.detectedBy
    });
  }
}