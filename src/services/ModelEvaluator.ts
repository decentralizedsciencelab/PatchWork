import { IModelEvaluator } from '../interfaces/IModelEvaluator';
import { Generation, Task } from '../types';
import axios from 'axios';

export class ModelEvaluator implements IModelEvaluator {
  private generations: Generation[] = [];
  private readonly openaiApiKey: string;
  private readonly anthropicApiKey: string;

  constructor(openaiApiKey?: string, anthropicApiKey?: string) {
    this.openaiApiKey = openaiApiKey || process.env['OPENAI_API_KEY'] || '';
    this.anthropicApiKey = anthropicApiKey || process.env['ANTHROPIC_API_KEY'] || '';
  }

  async generateWithPrompt(
    task: Task,
    model: 'GPT-4o' | 'Claude-3.5-Sonnet',
    promptStrategy: 'P1' | 'P2' | 'P3' | 'P4'
  ): Promise<Generation> {
    // Get context files based on prompting strategy
    let contextFiles: string[];
    switch (promptStrategy) {
      case 'P1':
        contextFiles = await this.applyP1Prompting(task);
        break;
      case 'P2':
        contextFiles = await this.applyP2Prompting(task);
        break;
      case 'P3':
        contextFiles = await this.applyP3Prompting(task);
        break;
      case 'P4':
        contextFiles = await this.applyP4Prompting(task);
        break;
      default:
        throw new Error(`Unknown prompting strategy: ${promptStrategy}`);
    }

    // Generate code using the specified model
    const generatedCode = await this.callModelAPI(task, contextFiles, model);

    // Create generation record
    const generation: Generation = {
      id: this.generateId(),
      taskId: task.id,
      model,
      promptStrategy,
      contextFiles,
      generatedCode,
      timestamp: new Date()
    };

    this.generations.push(generation);
    return generation;
  }

  async applyP1Prompting(_task: Task): Promise<string[]> {
    // P1: Minimal context - only task description and target path
    // Return empty array as P1 provides no additional context files
    return [];
  }

  async applyP2Prompting(task: Task): Promise<string[]> {
    // P2: Local context - depth-1 imports (2-5 files)
    const contextFiles: string[] = [];
    
    // For each target file, find its direct imports
    for (const targetFile of task.targetFiles) {
      const imports = await this.findDirectImports(targetFile);
      contextFiles.push(...imports);
    }

    // Ensure we have 2-5 files as per requirement
    const uniqueFiles = [...new Set(contextFiles)];
    if (uniqueFiles.length < 2) {
      // If we have fewer than 2 files, add dependencies
      const additionalFiles = task.dependencies.slice(0, 2 - uniqueFiles.length);
      uniqueFiles.push(...additionalFiles);
    }
    
    // Limit to maximum 5 files
    return uniqueFiles.slice(0, 5);
  }

  async applyP3Prompting(task: Task): Promise<string[]> {
    // P3: Retrieved context - top-10 similarity files
    const similarityFiles = await this.findSimilarityFiles(task);
    
    // Return exactly 10 files as per requirement
    return similarityFiles.slice(0, 10);
  }

  async applyP4Prompting(task: Task): Promise<string[]> {
    // P4: Oracle context - human-annotated context (5-15 files)
    const annotatedFiles = await this.getHumanAnnotatedFiles(task);
    
    // Ensure we have 5-15 files as per requirement
    if (annotatedFiles.length < 5) {
      throw new Error(`P4 prompting requires at least 5 annotated files, got ${annotatedFiles.length}`);
    }
    
    // Limit to maximum 15 files
    return annotatedFiles.slice(0, 15);
  }

  getGenerationsForTask(taskId: string): Generation[] {
    return this.generations.filter(gen => gen.taskId === taskId);
  }

  protected generateId(): string {
    return `gen_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async callModelAPI(task: Task, contextFiles: string[], model: 'GPT-4o' | 'Claude-3.5-Sonnet'): Promise<string> {
    const prompt = this.buildPrompt(task, contextFiles);
    
    if (model === 'GPT-4o') {
      return await this.callOpenAI(prompt);
    } else if (model === 'Claude-3.5-Sonnet') {
      return await this.callAnthropic(prompt);
    } else {
      throw new Error(`Unsupported model: ${model}`);
    }
  }

  protected buildPrompt(task: Task, contextFiles: string[]): string {
    let prompt = `Task: ${task.specification}\n\n`;
    prompt += `Target files: ${task.targetFiles.join(', ')}\n\n`;
    
    if (contextFiles.length > 0) {
      prompt += `Context files:\n${contextFiles.join('\n')}\n\n`;
    }
    
    prompt += `Please generate the code for the specified task. Focus on structural correctness and proper integration with existing code.`;
    
    return prompt;
  }

  private async callOpenAI(prompt: string): Promise<string> {
    if (!this.openaiApiKey) {
      throw new Error('OpenAI API key not provided');
    }

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0, // Deterministic generation as per requirement 1.1
          max_tokens: 4000
        },
        {
          headers: {
            'Authorization': `Bearer ${this.openaiApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data.choices[0].message.content;
    } catch (error) {
      throw new Error(`OpenAI API call failed: ${error}`);
    }
  }

  private async callAnthropic(prompt: string): Promise<string> {
    if (!this.anthropicApiKey) {
      throw new Error('Anthropic API key not provided');
    }

    try {
      const response = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          temperature: 0, // Deterministic generation as per requirement 1.1
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        },
        {
          headers: {
            'x-api-key': this.anthropicApiKey,
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01'
          }
        }
      );

      return response.data.content[0].text;
    } catch (error) {
      throw new Error(`Anthropic API call failed: ${error}`);
    }
  }

  protected async findDirectImports(filePath: string): Promise<string[]> {
    // Mock implementation - in real system would parse AST to find imports
    // For now, return some mock imports based on file dependencies
    const mockImports = [
      `${filePath.replace('.ts', '')}.types.ts`,
      `${filePath.replace('.ts', '')}.utils.ts`
    ];
    return mockImports.filter(file => file !== filePath);
  }

  protected async findSimilarityFiles(_task: Task): Promise<string[]> {
    // Mock implementation - in real system would use embedding similarity
    // Generate 10 mock similar files based on task specification
    const mockSimilarFiles: string[] = [];
    for (let i = 1; i <= 10; i++) {
      mockSimilarFiles.push(`similar_file_${i}.ts`);
    }
    return mockSimilarFiles;
  }

  protected async getHumanAnnotatedFiles(_task: Task): Promise<string[]> {
    // Mock implementation - in real system would load from annotation database
    // Generate 5-15 mock annotated files
    const fileCount = Math.floor(Math.random() * 11) + 5; // 5-15 files
    const mockAnnotatedFiles: string[] = [];
    for (let i = 1; i <= fileCount; i++) {
      mockAnnotatedFiles.push(`annotated_file_${i}.ts`);
    }
    return mockAnnotatedFiles;
  }
}