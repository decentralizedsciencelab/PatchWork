import { Generation } from '../types';

export class GenerationModel implements Generation {
  constructor(
    public id: string,
    public taskId: string,
    public model: 'GPT-4o' | 'Claude-3.5-Sonnet' | 'Qwen-7B' | 'Qwen2.5-Coder-32B' | 'CodeLlama-34B' | 'StarCoder2-15B' | 'StarCoder2-3B',
    public promptStrategy: 'P1' | 'P2' | 'P3' | 'P4',
    public contextFiles: string[],
    public generatedCode: string,
    public timestamp: Date
  ) {}

  static validate(data: any): string[] {
    const errors: string[] = [];

    if (!data.id || typeof data.id !== 'string') {
      errors.push('Generation id must be a non-empty string');
    }

    if (!data.taskId || typeof data.taskId !== 'string') {
      errors.push('Generation taskId must be a non-empty string');
    }

    const validModels = ['GPT-4o', 'Claude-3.5-Sonnet', 'Qwen-7B', 'Qwen2.5-Coder-32B', 'CodeLlama-34B', 'StarCoder2-15B', 'StarCoder2-3B'];
    if (!validModels.includes(data.model)) {
      errors.push(`Generation model must be one of: ${validModels.join(', ')}`);
    }

    const validPromptStrategies = ['P1', 'P2', 'P3', 'P4'];
    if (!validPromptStrategies.includes(data.promptStrategy)) {
      errors.push(`Generation promptStrategy must be one of: ${validPromptStrategies.join(', ')}`);
    }

    if (!Array.isArray(data.contextFiles)) {
      errors.push('Generation contextFiles must be an array');
    } else if (data.contextFiles.some((file: any) => typeof file !== 'string')) {
      errors.push('All contextFiles must be strings');
    }

    if (typeof data.generatedCode !== 'string') {
      errors.push('Generation generatedCode must be a string');
    }

    if (!(data.timestamp instanceof Date) && typeof data.timestamp !== 'string') {
      errors.push('Generation timestamp must be a Date or ISO string');
    }

    // Prompt strategy validation based on requirements 1.2, 1.3, 1.4, 1.5
    if (data.promptStrategy === 'P1' && data.contextFiles.length > 0) {
      errors.push('P1 prompting should provide only task description and target path (no context files)');
    }

    if (data.promptStrategy === 'P2' && (data.contextFiles.length < 2 || data.contextFiles.length > 5)) {
      errors.push('P2 prompting should include 2-5 context files');
    }

    if (data.promptStrategy === 'P3' && data.contextFiles.length !== 10) {
      errors.push('P3 prompting should include exactly 10 context files');
    }

    if (data.promptStrategy === 'P4' && (data.contextFiles.length < 5 || data.contextFiles.length > 15)) {
      errors.push('P4 prompting should include 5-15 context files');
    }

    return errors;
  }

  static fromJSON(json: string): GenerationModel {
    const data = JSON.parse(json);
    
    // Convert timestamp string to Date if needed
    if (typeof data.timestamp === 'string') {
      data.timestamp = new Date(data.timestamp);
    }
    
    const errors = GenerationModel.validate(data);
    
    if (errors.length > 0) {
      throw new Error(`Generation validation failed: ${errors.join(', ')}`);
    }

    return new GenerationModel(
      data.id,
      data.taskId,
      data.model,
      data.promptStrategy,
      data.contextFiles,
      data.generatedCode,
      data.timestamp
    );
  }

  toJSON(): string {
    return JSON.stringify({
      id: this.id,
      taskId: this.taskId,
      model: this.model,
      promptStrategy: this.promptStrategy,
      contextFiles: this.contextFiles,
      generatedCode: this.generatedCode,
      timestamp: this.timestamp.toISOString()
    });
  }
}