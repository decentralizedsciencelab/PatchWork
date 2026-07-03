import { Task, Repository } from '../types';

export interface ITaskGenerator {
  /**
   * Generate L1 tasks (single-file) for a repository
   */
  generateL1Tasks(repository: Repository): Promise<Task[]>;

  /**
   * Generate L2 tasks (multi-file with dependencies) for a repository
   */
  generateL2Tasks(repository: Repository): Promise<Task[]>;

  /**
   * Generate L3 tasks (cross-cutting layers) for a repository
   */
  generateL3Tasks(repository: Repository): Promise<Task[]>;

  /**
   * Extract tasks from git history and commit messages
   */
  extractFromGitHistory(repository: Repository): Promise<Task[]>;

  /**
   * Derive tasks from existing repository issues
   */
  deriveFromIssues(repository: Repository): Promise<Task[]>;

  /**
   * Generate all tasks for a repository
   */
  generateAllTasks(repository: Repository): Promise<Task[]>;
}