/**
 * HuggingFace Inference API evaluator for open-source models.
 *
 * Uses the OpenAI-compatible endpoint at https://router.huggingface.co/v1
 * to call Qwen2.5-Coder-32B-Instruct for external validation (Track A).
 */

import { Generation, Task } from '../types';
import axios from 'axios';
import { ModelEvaluator } from './ModelEvaluator';

export class HuggingFaceEvaluator extends ModelEvaluator {
  private readonly hfToken: string;
  private readonly hfBaseUrl: string;
  private readonly hfModel: string;

  constructor(
    hfToken?: string,
    openaiApiKey?: string,
    anthropicApiKey?: string,
  ) {
    super(openaiApiKey, anthropicApiKey);
    this.hfToken = hfToken || process.env['HUGGING_FACE_HUB_TOKEN'] || '';
    this.hfBaseUrl = 'https://router.huggingface.co/v1';
    this.hfModel = 'Qwen/Qwen2.5-Coder-32B-Instruct';
  }

  /**
   * Generate code using HF-hosted Qwen2.5-Coder-32B-Instruct.
   * Only supports P1 strategy (zero context) for external validation.
   */
  async generateWithHF(
    task: Task,
    promptStrategy: 'P1' | 'P2' | 'P3' | 'P4' = 'P1',
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

    const prompt = this.buildPrompt(task, contextFiles);
    const generatedCode = await this.callHuggingFace(prompt);

    const generation: Generation = {
      id: this.generateId(),
      taskId: task.id,
      model: 'Qwen2.5-Coder-32B',
      promptStrategy,
      contextFiles,
      generatedCode,
      timestamp: new Date(),
    };

    return generation;
  }

  private async callHuggingFace(prompt: string): Promise<string> {
    if (!this.hfToken) {
      throw new Error(
        'HUGGING_FACE_HUB_TOKEN is not set. Add it to .env or export it.',
      );
    }

    try {
      const response = await axios.post(
        `${this.hfBaseUrl}/chat/completions`,
        {
          model: this.hfModel,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0,
          max_tokens: 4000,
        },
        {
          headers: {
            Authorization: `Bearer ${this.hfToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 120000, // 2 min timeout for inference API
        },
      );

      return response.data.choices[0].message.content;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const body = error.response?.data;
        throw new Error(
          `HuggingFace API call failed (${status}): ${JSON.stringify(body)}`,
        );
      }
      throw new Error(`HuggingFace API call failed: ${error}`);
    }
  }

  /**
   * Smoke-test connectivity to the HF Inference API.
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.hfBaseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.hfToken}`,
        },
        timeout: 10000,
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }
}
