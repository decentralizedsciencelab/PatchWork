import { ITaskGenerator } from '../interfaces/ITaskGenerator';
import { Task, Repository } from '../types';
import * as crypto from 'crypto';

export class TaskGenerator implements ITaskGenerator {
  /**
   * Generate L1 tasks (single-file) for a repository
   * Requirements: 3.1 - Generate 3 single-file tasks per repository
   */
  async generateL1Tasks(repository: Repository): Promise<Task[]> {
    const tasks: Task[] = [];
    
    // Generate 3 L1 tasks as per requirement 3.1
    for (let i = 1; i <= 3; i++) {
      const task: Task = {
        id: crypto.randomUUID(),
        repositoryId: repository.id,
        complexity: 'L1',
        specification: this.generateL1Specification(repository, i),
        targetFiles: [this.generateTargetFile(repository, 'L1', i)],
        dependencies: [], // L1 tasks have no dependencies
        derivedFrom: repository.source === 'Curated' ? 'commit' : 'issue'
      };
      tasks.push(task);
    }
    
    return tasks;
  }

  /**
   * Generate L2 tasks (multi-file with dependencies) for a repository
   * Requirements: 3.2 - Generate 2 multiple-file tasks with cross dependencies per repository
   */
  async generateL2Tasks(repository: Repository): Promise<Task[]> {
    const tasks: Task[] = [];
    
    // Generate 2 L2 tasks as per requirement 3.2
    for (let i = 1; i <= 2; i++) {
      const targetFiles = this.generateMultipleTargetFiles(repository, 'L2', i);
      const task: Task = {
        id: crypto.randomUUID(),
        repositoryId: repository.id,
        complexity: 'L2',
        specification: this.generateL2Specification(repository, i),
        targetFiles,
        dependencies: this.generateDependencies(repository, targetFiles),
        derivedFrom: repository.source === 'Curated' ? 'commit' : 'issue'
      };
      tasks.push(task);
    }
    
    return tasks;
  }

  /**
   * Generate L3 tasks (cross-cutting layers) for a repository
   * Requirements: 3.3 - Generate 1 cross-cutting task across layers per repository
   */
  async generateL3Tasks(repository: Repository): Promise<Task[]> {
    const tasks: Task[] = [];
    
    // Generate 1 L3 task as per requirement 3.3
    const targetFiles = this.generateCrossCuttingTargetFiles(repository);
    const task: Task = {
      id: crypto.randomUUID(),
      repositoryId: repository.id,
      complexity: 'L3',
      specification: this.generateL3Specification(repository),
      targetFiles,
      dependencies: this.generateCrossCuttingDependencies(repository, targetFiles),
      derivedFrom: repository.source === 'Curated' ? 'commit' : 'issue'
    };
    tasks.push(task);
    
    return tasks;
  }

  /**
   * Extract tasks from git history and commit messages
   * Requirements: 3.5 - Create curated tasks from git history and commit messages
   */
  async extractFromGitHistory(repository: Repository): Promise<Task[]> {
    // This method would typically interface with git APIs or local git repositories
    // For now, we'll simulate the extraction based on repository characteristics
    
    if (repository.source !== 'Curated') {
      return [];
    }

    const tasks: Task[] = [];
    
    // Simulate extracting recent features from git history
    const recentCommits = this.simulateRecentCommits(repository);
    
    for (const commit of recentCommits) {
      const complexity = this.determineComplexityFromCommit(commit);
      const task: Task = {
        id: crypto.randomUUID(),
        repositoryId: repository.id,
        complexity,
        specification: commit.message,
        targetFiles: commit.affectedFiles,
        dependencies: this.inferDependenciesFromFiles(commit.affectedFiles),
        derivedFrom: 'commit'
      };
      tasks.push(task);
    }
    
    return tasks;
  }

  /**
   * Derive tasks from existing repository issues
   * Requirements: 3.4 - Derive benchmark tasks from repository issues
   */
  async deriveFromIssues(repository: Repository): Promise<Task[]> {
    // This method would typically interface with GitHub/GitLab APIs
    // For now, we'll simulate the derivation based on repository characteristics
    
    if (repository.source === 'Curated') {
      return [];
    }

    const tasks: Task[] = [];
    
    // Simulate extracting issues from SWE-bench or EvoCodeBench
    const issues = this.simulateRepositoryIssues(repository);
    
    for (const issue of issues) {
      const complexity = this.determineComplexityFromIssue(issue);
      const task: Task = {
        id: crypto.randomUUID(),
        repositoryId: repository.id,
        complexity,
        specification: issue.description,
        targetFiles: issue.affectedFiles,
        dependencies: this.inferDependenciesFromFiles(issue.affectedFiles),
        derivedFrom: 'issue'
      };
      tasks.push(task);
    }
    
    return tasks;
  }

  /**
   * Generate all tasks for a repository
   */
  async generateAllTasks(repository: Repository): Promise<Task[]> {
    const allTasks: Task[] = [];
    
    // Generate standard L1, L2, L3 tasks
    const l1Tasks = await this.generateL1Tasks(repository);
    const l2Tasks = await this.generateL2Tasks(repository);
    const l3Tasks = await this.generateL3Tasks(repository);
    
    allTasks.push(...l1Tasks, ...l2Tasks, ...l3Tasks);
    
    // Add tasks derived from git history or issues based on source
    if (repository.source === 'Curated') {
      const gitTasks = await this.extractFromGitHistory(repository);
      allTasks.push(...gitTasks);
    } else {
      const issueTasks = await this.deriveFromIssues(repository);
      allTasks.push(...issueTasks);
    }
    
    return allTasks;
  }

  // Private helper methods

  private generateL1Specification(repository: Repository, taskNumber: number): string {
    const frameworkSpecific = this.getFrameworkSpecificTask(repository.framework, 'L1', taskNumber);
    return `L1 Task ${taskNumber}: ${frameworkSpecific}`;
  }

  private generateL2Specification(repository: Repository, taskNumber: number): string {
    const frameworkSpecific = this.getFrameworkSpecificTask(repository.framework, 'L2', taskNumber);
    return `L2 Task ${taskNumber}: ${frameworkSpecific}`;
  }

  private generateL3Specification(repository: Repository): string {
    const frameworkSpecific = this.getFrameworkSpecificTask(repository.framework, 'L3', 1);
    return `L3 Task: ${frameworkSpecific}`;
  }

  private getFrameworkSpecificTask(framework: Repository['framework'], complexity: string, taskNumber: number): string {
    const taskTemplates: Record<Repository['framework'], Record<string, string[]>> = {
      'FastAPI': {
        'L1': [
          'Create a new API endpoint for user authentication',
          'Implement data validation for user input',
          'Add error handling for database operations'
        ],
        'L2': [
          'Implement user registration with email verification',
          'Create middleware for request logging and authentication'
        ],
        'L3': ['Implement comprehensive user management system with role-based access control']
      },
      'Django': {
        'L1': [
          'Create a new model for blog posts',
          'Implement custom user authentication',
          'Add form validation for user input'
        ],
        'L2': [
          'Implement user profile management with image upload',
          'Create admin interface for content management'
        ],
        'L3': ['Implement multi-tenant blog system with custom domains']
      },
      'Express': {
        'L1': [
          'Create REST API endpoint for product catalog',
          'Implement JWT token validation middleware',
          'Add input sanitization for user data'
        ],
        'L2': [
          'Implement shopping cart functionality with session management',
          'Create user authentication system with password reset'
        ],
        'L3': ['Implement complete e-commerce platform with payment integration']
      },
      'Next.js': {
        'L1': [
          'Create dynamic page component for product details',
          'Implement client-side form validation',
          'Add responsive navigation component'
        ],
        'L2': [
          'Implement server-side rendering for blog posts',
          'Create user dashboard with data fetching'
        ],
        'L3': ['Implement full-stack application with authentication and data management']
      },
      'React': {
        'L1': [
          'Add async data fetching in useEffect with state updates',
          'Implement counter component with direct state mutation',
          'Create form component with controlled inputs and validation'
        ],
        'L2': [
          'Implement Redux store with async thunks for user data',
          'Create custom hook with stale closure accessing props',
          'Build shopping cart with Context API and async updates'
        ],
        'L3': [
          'Implement real-time collaborative editor with Redux and WebSocket state sync',
          'Build dashboard with multiple async data sources and state coordination'
        ]
      },
      'Vue': {
        'L1': [
          'Create component with async data fetching in mounted hook',
          'Implement reactive form with direct state mutation',
          'Add computed property with side effects on store state'
        ],
        'L2': [
          'Implement Vuex store with async actions for API calls',
          'Create mixin with stale closure capturing reactive data',
          'Build notification system with direct state mutations in watchers'
        ],
        'L3': [
          'Implement real-time chat application with Vuex state synchronization',
          'Build admin dashboard with complex async state management'
        ]
      },
      'Angular': {
        'L1': [
          'Create service with async HTTP calls updating component state',
          'Implement form component with direct property mutation',
          'Add change detection with async state updates in lifecycle hooks'
        ],
        'L2': [
          'Implement NgRx store with effects for async data fetching',
          'Create shared service with stale closure in subscription callbacks',
          'Build data grid with direct state mutation in event handlers'
        ],
        'L3': [
          'Implement real-time trading dashboard with NgRx state management',
          'Build multi-user collaboration tool with RxJS state synchronization'
        ]
      }
    };

    const templates = taskTemplates[framework][complexity];
    if (!templates) {
      throw new Error(`No templates found for framework ${framework} and complexity ${complexity}`);
    }
    const template = templates[(taskNumber - 1) % templates.length];
    if (!template) {
      throw new Error(`No template found at index ${(taskNumber - 1) % templates.length}`);
    }
    return template;
  }

  private generateTargetFile(repository: Repository, complexity: string, taskNumber: number): string {
    let extension: string;
    if (repository.language === 'Python') {
      extension = '.py';
    } else if (repository.language === 'TypeScript') {
      extension = repository.framework === 'React' || repository.framework === 'Vue' ? '.tsx' : '.ts';
    } else {
      // JavaScript
      extension = repository.framework === 'React' || repository.framework === 'Vue' ? '.jsx' : '.js';
    }
    return `src/${complexity.toLowerCase()}_task_${taskNumber}${extension}`;
  }

  private generateMultipleTargetFiles(repository: Repository, complexity: string, taskNumber: number): string[] {
    let extension: string;
    if (repository.language === 'Python') {
      extension = '.py';
    } else if (repository.language === 'TypeScript') {
      extension = repository.framework === 'React' || repository.framework === 'Vue' ? '.tsx' : '.ts';
    } else {
      // JavaScript
      extension = repository.framework === 'React' || repository.framework === 'Vue' ? '.jsx' : '.js';
    }

    const baseFiles = [
      `src/${complexity.toLowerCase()}_task_${taskNumber}_main${extension}`,
      `src/${complexity.toLowerCase()}_task_${taskNumber}_utils${extension}`
    ];

    // Add framework-specific files
    if (repository.framework === 'FastAPI' || repository.framework === 'Django') {
      baseFiles.push(`src/${complexity.toLowerCase()}_task_${taskNumber}_models${extension}`);
    } else if (repository.framework === 'Express' || repository.framework === 'Next.js') {
      baseFiles.push(`src/${complexity.toLowerCase()}_task_${taskNumber}_types${extension}`);
    } else if (repository.framework === 'React' || repository.framework === 'Vue') {
      baseFiles.push(`src/${complexity.toLowerCase()}_task_${taskNumber}_hooks${extension}`);
      baseFiles.push(`src/${complexity.toLowerCase()}_task_${taskNumber}_store${extension}`);
    } else if (repository.framework === 'Angular') {
      baseFiles.push(`src/${complexity.toLowerCase()}_task_${taskNumber}_service.ts`);
      baseFiles.push(`src/${complexity.toLowerCase()}_task_${taskNumber}_store.ts`);
    }

    return baseFiles;
  }

  private generateCrossCuttingTargetFiles(repository: Repository): string[] {
    let extension: string;
    if (repository.language === 'Python') {
      extension = '.py';
    } else if (repository.language === 'TypeScript') {
      extension = repository.framework === 'React' || repository.framework === 'Vue' ? '.tsx' : '.ts';
    } else {
      // JavaScript
      extension = repository.framework === 'React' || repository.framework === 'Vue' ? '.jsx' : '.js';
    }
    return [
      `src/models/user${extension}`,
      `src/services/auth${extension}`,
      `src/controllers/user_controller${extension}`,
      `src/middleware/auth_middleware${extension}`
    ];
  }

  private generateDependencies(repository: Repository, _targetFiles: string[]): string[] {
    // Generate realistic dependencies based on target files
    const dependencies: string[] = [];
    
    if (repository.language === 'Python') {
      dependencies.push('typing', 'pydantic');
      if (repository.framework === 'FastAPI') {
        dependencies.push('fastapi', 'sqlalchemy');
      } else if (repository.framework === 'Django') {
        dependencies.push('django', 'django.contrib.auth');
      }
    } else {
      dependencies.push('@types/node');
      if (repository.framework === 'Express') {
        dependencies.push('express', '@types/express');
      } else if (repository.framework === 'Next.js') {
        dependencies.push('next', 'react', '@types/react');
      }
    }
    
    return dependencies;
  }

  private generateCrossCuttingDependencies(repository: Repository, targetFiles: string[]): string[] {
    const dependencies = this.generateDependencies(repository, targetFiles);
    
    // Add cross-cutting dependencies
    if (repository.language === 'Python') {
      dependencies.push('bcrypt', 'jwt');
    } else {
      dependencies.push('bcryptjs', 'jsonwebtoken');
    }
    
    return dependencies;
  }

  private simulateRecentCommits(repository: Repository): Array<{message: string, affectedFiles: string[]}> {
    // Simulate recent commits for curated repositories
    const extension = repository.language === 'Python' ? '.py' : '.ts';
    
    return [
      {
        message: 'Add user authentication system',
        affectedFiles: [`src/auth${extension}`, `src/models/user${extension}`]
      },
      {
        message: 'Implement data validation layer',
        affectedFiles: [`src/validation${extension}`, `src/schemas${extension}`]
      },
      {
        message: 'Add comprehensive error handling',
        affectedFiles: [`src/errors${extension}`, `src/middleware/error_handler${extension}`]
      }
    ];
  }

  private simulateRepositoryIssues(repository: Repository): Array<{description: string, affectedFiles: string[]}> {
    // Simulate issues from SWE-bench or EvoCodeBench
    const extension = repository.language === 'Python' ? '.py' : '.ts';
    
    return [
      {
        description: 'Fix authentication bug in user login',
        affectedFiles: [`src/auth${extension}`]
      },
      {
        description: 'Implement missing validation for user input',
        affectedFiles: [`src/validation${extension}`, `src/forms${extension}`]
      },
      {
        description: 'Add support for file upload functionality',
        affectedFiles: [`src/upload${extension}`, `src/storage${extension}`, `src/middleware/upload${extension}`]
      }
    ];
  }

  private determineComplexityFromCommit(commit: {message: string, affectedFiles: string[]}): Task['complexity'] {
    if (commit.affectedFiles.length === 1) return 'L1';
    if (commit.affectedFiles.length <= 3) return 'L2';
    return 'L3';
  }

  private determineComplexityFromIssue(issue: {description: string, affectedFiles: string[]}): Task['complexity'] {
    if (issue.affectedFiles.length === 1) return 'L1';
    if (issue.affectedFiles.length <= 3) return 'L2';
    return 'L3';
  }

  private inferDependenciesFromFiles(files: string[]): string[] {
    // Infer dependencies based on file patterns
    const dependencies: string[] = [];
    
    const hasModels = files.some(f => f.includes('model'));
    const hasAuth = files.some(f => f.includes('auth'));
    const hasValidation = files.some(f => f.includes('validation') || f.includes('schema'));
    
    if (hasModels) dependencies.push('database', 'orm');
    if (hasAuth) dependencies.push('authentication', 'security');
    if (hasValidation) dependencies.push('validation', 'schemas');
    
    return dependencies;
  }
}