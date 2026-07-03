import { Generation, Task } from '../types';

export interface IModelEvaluator {
  /**
   * Generate code using specified model and prompting strategy
   */
  generateWithPrompt(
    task: Task,
    model: 'GPT-4o' | 'Claude-3.5-Sonnet',
    promptStrategy: 'P1' | 'P2' | 'P3' | 'P4'
  ): Promise<Generation>;

  /**
   * Apply P1 prompting (minimal context: task + path only)
   */
  applyP1Prompting(task: Task): Promise<string[]>;

  /**
   * Apply P2 prompting (local context: depth-1 imports, 2-5 files)
   */
  applyP2Prompting(task: Task): Promise<string[]>;

  /**
   * Apply P3 prompting (retrieved context: top-10 similarity files)
   */
  applyP3Prompting(task: Task): Promise<string[]>;

  /**
   * Apply P4 prompting (oracle context: human-annotated, 5-15 files)
   */
  applyP4Prompting(task: Task): Promise<string[]>;

  /**
   * Get all generations for a task
   */
  getGenerationsForTask(taskId: string): Generation[];
}