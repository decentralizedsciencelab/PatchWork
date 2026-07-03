import { Generation, Task } from '../types';
import axios from 'axios';
import { ModelEvaluator } from './ModelEvaluator';

type SupportedModel = 'GPT-4o' | 'Claude-3.5-Sonnet' | 'Qwen-7B' | 'Qwen2.5-Coder-32B' | 'CodeLlama-34B' | 'StarCoder2-15B' | 'StarCoder2-3B';

/**
 * Extended Model Evaluator with support for local GPU models
 * Calls local model server running on GPU machine
 */
export class LocalModelEvaluator extends ModelEvaluator {
  private readonly localModelServerUrl: string;

  constructor(
    localModelServerUrl: string = 'http://10.96.50.180:8000',
    openaiApiKey?: string,
    anthropicApiKey?: string
  ) {
    super(openaiApiKey, anthropicApiKey);
    this.localModelServerUrl = localModelServerUrl;
  }

  override async generateWithPrompt(
    task: Task,
    model: SupportedModel,
    promptStrategy: 'P1' | 'P2' | 'P3' | 'P4'
  ): Promise<Generation> {
    // If it's a local model, use our local model server
    if (['Qwen-7B', 'CodeLlama-34B', 'StarCoder2-15B', 'StarCoder2-3B'].includes(model)) {
      return this.generateWithLocalModel(task, model as any, promptStrategy);
    }

    // Otherwise use parent implementation for GPT-4o/Claude
    return super.generateWithPrompt(task, model as any, promptStrategy);
  }

  private async generateWithLocalModel(
    task: Task,
    model: 'Qwen-7B' | 'CodeLlama-34B' | 'StarCoder2-15B' | 'StarCoder2-3B',
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

    // Build prompt
    const prompt = this.buildPrompt(task, contextFiles);

    // Call local model server
    const generatedCode = await this.callLocalModel(prompt, model);

    // Create generation record
    const generation: Generation = {
      id: this.generateId(),
      taskId: task.id,
      model: model as Generation['model'],
      promptStrategy,
      contextFiles,
      generatedCode,
      timestamp: new Date()
    };

    return generation;
  }

  private async callLocalModel(
    prompt: string,
    model: 'Qwen-7B' | 'CodeLlama-34B' | 'StarCoder2-15B' | 'StarCoder2-3B'
  ): Promise<string> {
    // Map model names to server model IDs
    const modelMap: Record<string, string> = {
      'Qwen-7B': 'qwen-7b',
      'CodeLlama-34B': 'codellama-34b',
      'StarCoder2-15B': 'starcoder2-15b',
      'StarCoder2-3B': 'starcoder2-3b'
    };

    const modelId = modelMap[model];

    try {
      console.log(`Calling local model: ${model} (${modelId})...`);

      const response = await axios.post(
        `${this.localModelServerUrl}/v1/chat/completions`,
        {
          model: modelId,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.01, // Near-deterministic (avoid 0 for local models)
          max_tokens: 4000
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 300000 // 5 minute timeout for large models
        }
      );

      console.log(`✓ ${model} generation complete`);
      return response.data.choices[0].message.content;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Local model API call failed: ${error.message}`);
      }
      throw new Error(`Local model API call failed: ${error}`);
    }
  }

  /**
   * Test local model server connectivity
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.localModelServerUrl}/health`);
      console.log('Local model server status:', response.data);
      return response.data.status === 'ok';
    } catch (error) {
      console.error('Failed to connect to local model server:', error);
      return false;
    }
  }

  /**
   * List available local models
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await axios.get(`${this.localModelServerUrl}/v1/models`);
      return response.data.data.map((m: any) => m.id);
    } catch (error) {
      console.error('Failed to list models:', error);
      return [];
    }
  }
}
