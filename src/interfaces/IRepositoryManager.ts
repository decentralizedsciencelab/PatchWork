import { Repository } from '../types';

export interface IRepositoryManager {
  /**
   * Load benchmark repositories from SWE-bench and EvoCodeBench
   */
  loadBenchmarkRepos(): Promise<Repository[]>;

  /**
   * Load curated production repositories with validation
   */
  loadCuratedRepos(): Promise<Repository[]>;

  /**
   * Extract and return repository metadata
   */
  getRepositoryMetadata(repositoryPath: string): Promise<Partial<Repository>>;

  /**
   * Validate repository meets minimum requirements
   */
  validateRepository(repository: Repository): boolean;

  /**
   * Get all loaded repositories
   */
  getAllRepositories(): Repository[];
}