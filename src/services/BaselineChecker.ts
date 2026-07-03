import { IBaselineChecker } from '../interfaces/IBaselineChecker';
import { FailureDetection, Generation } from '../types';
import { FailureDetectionModel, CodeLocationModel } from '../models/FailureDetection';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export class BaselineChecker implements IBaselineChecker {

  /**
   * Extract actual code from markdown-formatted LLM output
   * Handles code blocks like ```python ... ``` or ```typescript ... ```
   */
  private extractCodeFromMarkdown(content: string): string {
    // Check if content contains markdown code blocks
    const codeBlockRegex = /```(?:python|typescript|ts|py|javascript|js|bash|shell)?\s*\n([\s\S]*?)```/g;
    const matches: string[] = [];
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match[1]) {
        matches.push(match[1].trim());
      }
    }

    // If we found code blocks, join them
    if (matches.length > 0) {
      return matches.join('\n\n');
    }

    // If no code blocks found, check if it looks like code (not prose)
    const lines = content.split('\n');
    const codeLines = lines.filter(line => {
      const trimmed = line.trim();
      // Skip empty lines
      if (!trimmed) return true;
      // Skip lines that look like prose (start with capital, end with period, no code-like chars)
      if (/^[A-Z].*[.!?]$/.test(trimmed) && !trimmed.includes('{') && !trimmed.includes('(')) {
        return false;
      }
      return true;
    });

    // If most lines look like prose, return empty
    const proseRatio = (lines.length - codeLines.length) / lines.length;
    if (proseRatio > 0.5) {
      // Try to find any code-like content
      const codeStart = content.indexOf('def ') !== -1 ? content.indexOf('def ') :
                        content.indexOf('function ') !== -1 ? content.indexOf('function ') :
                        content.indexOf('class ') !== -1 ? content.indexOf('class ') :
                        content.indexOf('import ') !== -1 ? content.indexOf('import ') : -1;
      if (codeStart !== -1) {
        return content.substring(codeStart);
      }
      return '';
    }

    return content;
  }

  /**
   * Detect language from code content
   */
  private detectLanguage(code: string): 'python' | 'typescript' {
    const pythonIndicators = [
      /^def\s+\w+\s*\(/m,
      /^class\s+\w+.*:/m,
      /^import\s+\w+$/m,
      /^from\s+\w+\s+import/m,
      /:\s*$/m,
      /@\w+\s*$/m  // decorators
    ];

    const tsIndicators = [
      /^interface\s+\w+/m,
      /^type\s+\w+\s*=/m,
      /:\s*(string|number|boolean|any)\b/m,
      /^import\s+.*\s+from\s+['"]/m,
      /^export\s+(default\s+)?(function|class|const|interface)/m,
      /\bconst\s+\w+\s*:\s*\w+/m
    ];

    let pythonScore = 0;
    let tsScore = 0;

    for (const pattern of pythonIndicators) {
      if (pattern.test(code)) pythonScore++;
    }

    for (const pattern of tsIndicators) {
      if (pattern.test(code)) tsScore++;
    }

    return pythonScore > tsScore ? 'python' : 'typescript';
  }

  /**
   * Run compile checks using mypy --strict for Python or tsc --strict for TypeScript
   */
  async runCompileCheck(generation: Generation): Promise<FailureDetection[]> {
    const failures: FailureDetection[] = [];

    try {
      // Extract actual code from markdown-formatted LLM output
      const code = this.extractCodeFromMarkdown(generation.generatedCode);

      if (!code || code.trim().length < 10) {
        // No valid code found
        failures.push(new FailureDetectionModel(
          uuidv4(),
          generation.id,
          'type',
          'error',
          'No valid code could be extracted from generation',
          new CodeLocationModel('generated_code', 1, 0),
          'compile'
        ));
        return failures;
      }

      // Create temporary file with extracted code
      const tempDir = path.join(process.cwd(), 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Detect language from extracted code
      const language = this.detectLanguage(code);
      const fileExtension = language === 'typescript' ? '.ts' : '.py';
      const tempFile = path.join(tempDir, `temp_${generation.id}${fileExtension}`);

      fs.writeFileSync(tempFile, code);
      
      try {
        if (language === 'typescript') {
          // Run TypeScript compiler with strict mode
          execSync(`npx tsc --strict --noEmit ${tempFile}`, {
            stdio: 'pipe',
            timeout: 30000
          });
        } else {
          // Run mypy with strict mode for Python
          execSync(`python -m mypy --strict ${tempFile}`, {
            stdio: 'pipe',
            timeout: 30000
          });
        }
      } catch (error: any) {
        // Parse compiler output for errors
        const output = error.stdout?.toString() || error.stderr?.toString() || '';
        const lines = output.split('\n').filter((line: string) => line.trim());
        
        for (const line of lines) {
          if (line.includes('error:') || line.includes('Error:')) {
            const failure = this.parseCompilerError(line, generation.id, tempFile);
            if (failure) {
              failures.push(failure);
            }
          }
        }
      }
      
      // Clean up temporary file
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      
    } catch (error) {
      // If we can't run the compiler, create a generic failure
      failures.push(new FailureDetectionModel(
        uuidv4(),
        generation.id,
        'type',
        'error',
        `Compile check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        new CodeLocationModel('generated_code', 1, 0),
        'compile'
      ));
    }
    
    return failures;
  }

  /**
   * Execute repository test suites and capture results
   */
  async runTestExecution(generation: Generation): Promise<FailureDetection[]> {
    const failures: FailureDetection[] = [];
    
    try {
      // Create temporary test environment
      const tempDir = path.join(process.cwd(), 'temp', `test_${generation.id}`);
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      // Write generated code to temporary directory
      const isTypeScript = generation.generatedCode.includes('interface ') || 
                          generation.generatedCode.includes('type ');
      const fileExtension = isTypeScript ? '.ts' : '.py';
      const codeFile = path.join(tempDir, `code${fileExtension}`);
      
      fs.writeFileSync(codeFile, generation.generatedCode);
      
      try {
        if (isTypeScript) {
          // Try to run Jest tests
          execSync(`cd ${tempDir} && npm test`, { 
            stdio: 'pipe',
            timeout: 60000 
          });
        } else {
          // Try to run pytest
          execSync(`cd ${tempDir} && python -m pytest -v`, { 
            stdio: 'pipe',
            timeout: 60000 
          });
        }
      } catch (error: any) {
        // Parse test output for failures
        const output = error.stdout?.toString() || error.stderr?.toString() || '';
        const testFailures = this.parseTestFailures(output, generation.id);
        failures.push(...testFailures);
      }
      
      // Clean up temporary directory
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      
    } catch (error) {
      failures.push(new FailureDetectionModel(
        uuidv4(),
        generation.id,
        'dependency',
        'error',
        `Test execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        new CodeLocationModel('generated_code', 1, 0),
        'test'
      ));
    }
    
    return failures;
  }

  /**
   * Run SAST analysis using bandit and semgrep tools
   */
  async runSASTAnalysis(generation: Generation): Promise<FailureDetection[]> {
    const failures: FailureDetection[] = [];

    try {
      // Extract actual code from markdown-formatted LLM output
      const code = this.extractCodeFromMarkdown(generation.generatedCode);

      if (!code || code.trim().length < 10) {
        return failures; // No code to analyze
      }

      const tempDir = path.join(process.cwd(), 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const language = this.detectLanguage(code);
      const fileExtension = language === 'typescript' ? '.ts' : '.py';
      const tempFile = path.join(tempDir, `sast_${generation.id}${fileExtension}`);

      fs.writeFileSync(tempFile, code);

      if (language === 'python') {
        // Run bandit for Python
        try {
          execSync(`python -m bandit -f json ${tempFile}`, { 
            stdio: 'pipe',
            timeout: 30000 
          });
        } catch (error: any) {
          const output = error.stdout?.toString() || '';
          if (output) {
            try {
              const banditResults = JSON.parse(output);
              if (banditResults.results) {
                for (const result of banditResults.results) {
                  failures.push(new FailureDetectionModel(
                    uuidv4(),
                    generation.id,
                    'dependency',
                    result.issue_severity === 'HIGH' ? 'error' : 'warning',
                    `Security issue: ${result.issue_text}`,
                    new CodeLocationModel(
                      'generated_code',
                      result.line_number || 1,
                      result.col_offset || 0
                    ),
                    'sast'
                  ));
                }
              }
            } catch (parseError) {
              // If JSON parsing fails, create generic failure
              failures.push(new FailureDetectionModel(
                uuidv4(),
                generation.id,
                'dependency',
                'warning',
                'SAST analysis detected potential security issues',
                new CodeLocationModel('generated_code', 1, 0),
                'sast'
              ));
            }
          }
        }
      }
      
      // Run semgrep for both Python and TypeScript
      try {
        execSync(`semgrep --config=auto --json ${tempFile}`, { 
          stdio: 'pipe',
          timeout: 30000 
        });
      } catch (error: any) {
        const output = error.stdout?.toString() || '';
        if (output) {
          try {
            const semgrepResults = JSON.parse(output);
            if (semgrepResults.results) {
              for (const result of semgrepResults.results) {
                failures.push(new FailureDetectionModel(
                  uuidv4(),
                  generation.id,
                  'dependency',
                  result.extra.severity === 'ERROR' ? 'error' : 'warning',
                  `Code quality issue: ${result.extra.message}`,
                  new CodeLocationModel(
                    'generated_code',
                    result.start.line || 1,
                    result.start.col || 0
                  ),
                  'sast'
                ));
              }
            }
          } catch (parseError) {
            // If JSON parsing fails, create generic failure
            failures.push(new FailureDetectionModel(
              uuidv4(),
              generation.id,
              'dependency',
              'warning',
              'SAST analysis detected potential code quality issues',
              new CodeLocationModel('generated_code', 1, 0),
              'sast'
            ));
          }
        }
      }
      
      // Clean up temporary file
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      
    } catch (error) {
      failures.push(new FailureDetectionModel(
        uuidv4(),
        generation.id,
        'dependency',
        'error',
        `SAST analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        new CodeLocationModel('generated_code', 1, 0),
        'sast'
      ));
    }
    
    return failures;
  }

  /**
   * Apply regex heuristics with naive pattern matching
   */
  async runRegexHeuristics(generation: Generation): Promise<FailureDetection[]> {
    const failures: FailureDetection[] = [];

    // Extract actual code from markdown-formatted LLM output
    const code = this.extractCodeFromMarkdown(generation.generatedCode);
    if (!code || code.trim().length < 10) {
      return failures;
    }

    const lines = code.split('\n');
    
    // Common problematic patterns
    const patterns = [
      {
        regex: /undefined|null\.|\.\s*undefined/g,
        category: 'type' as const,
        severity: 'error' as const,
        description: 'Potential null/undefined reference'
      },
      {
        regex: /import\s+.*\s+from\s+['""][^'"]*['""];?\s*$/gm,
        category: 'import' as const,
        severity: 'warning' as const,
        description: 'Import statement may have issues',
        validate: (match: string) => {
          // Check for common import issues
          return match.includes('undefined') || match.includes('null') || 
                 match.match(/from\s+['""]['""]/) !== null;
        }
      },
      {
        regex: /function\s+\w+\s*\([^)]*\)\s*\{[^}]*\}/g,
        category: 'call' as const,
        severity: 'warning' as const,
        description: 'Function may have implementation issues',
        validate: (match: string) => {
          // Check for empty functions or functions that only throw
          return match.includes('throw new Error') && match.split('\n').length <= 3;
        }
      },
      {
        regex: /class\s+\w+.*\{[^}]*\}/g,
        category: 'schema' as const,
        severity: 'warning' as const,
        description: 'Class definition may be incomplete',
        validate: (match: string) => {
          // Check for empty classes
          const body = match.substring(match.indexOf('{') + 1, match.lastIndexOf('}'));
          return body.trim().length === 0;
        }
      },
      {
        regex: /TODO|FIXME|XXX|HACK/gi,
        category: 'dependency' as const,
        severity: 'warning' as const,
        description: 'Code contains TODO/FIXME comments indicating incomplete implementation'
      },
      {
        regex: /console\.log|print\s*\(/g,
        category: 'dependency' as const,
        severity: 'warning' as const,
        description: 'Debug statements left in code'
      }
    ];
    
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      if (!line) continue;
      
      for (const pattern of patterns) {
        const matches = line.matchAll(pattern.regex);
        
        for (const match of matches) {
          // Apply validation if provided
          if (pattern.validate && !pattern.validate(match[0])) {
            continue;
          }
          
          failures.push(new FailureDetectionModel(
            uuidv4(),
            generation.id,
            pattern.category,
            pattern.severity,
            pattern.description,
            new CodeLocationModel(
              'generated_code',
              lineIndex + 1,
              match.index || 0
            ),
            'regex'
          ));
        }
      }
    }
    
    return failures;
  }

  /**
   * Run all baseline checks for a generation
   */
  async runAllChecks(generation: Generation): Promise<FailureDetection[]> {
    const allFailures: FailureDetection[] = [];
    
    try {
      // Run all checks in parallel for efficiency
      const [compileFailures, testFailures, sastFailures, regexFailures] = await Promise.all([
        this.runCompileCheck(generation),
        this.runTestExecution(generation),
        this.runSASTAnalysis(generation),
        this.runRegexHeuristics(generation)
      ]);
      
      allFailures.push(...compileFailures);
      allFailures.push(...testFailures);
      allFailures.push(...sastFailures);
      allFailures.push(...regexFailures);
      
    } catch (error) {
      // If parallel execution fails, try sequential execution
      try {
        allFailures.push(...await this.runCompileCheck(generation));
        allFailures.push(...await this.runTestExecution(generation));
        allFailures.push(...await this.runSASTAnalysis(generation));
        allFailures.push(...await this.runRegexHeuristics(generation));
      } catch (sequentialError) {
        allFailures.push(new FailureDetectionModel(
          uuidv4(),
          generation.id,
          'dependency',
          'error',
          `Baseline checks failed: ${sequentialError instanceof Error ? sequentialError.message : 'Unknown error'}`,
          new CodeLocationModel('generated_code', 1, 0),
          'compile'
        ));
      }
    }
    
    return allFailures;
  }

  /**
   * Parse compiler error output to create FailureDetection objects
   */
  private parseCompilerError(errorLine: string, generationId: string, _filePath: string): FailureDetection | null {
    try {
      // Common compiler error patterns
      const patterns = [
        // TypeScript: file.ts(line,col): error TS#### message
        /^(.+)\((\d+),(\d+)\):\s*error\s+TS\d+:\s*(.+)$/,
        // Python mypy: file.py:line: error: message
        /^(.+):(\d+):\s*error:\s*(.+)$/,
        // Generic: file:line:col: error: message
        /^(.+):(\d+):(\d+):\s*error:\s*(.+)$/
      ];
      
      for (const pattern of patterns) {
        const match = errorLine.match(pattern);
        if (match && match[2]) {
          const line = parseInt(match[2]) || 1;
          const col = match[3] ? parseInt(match[3]) : 0;
          const message = match[4] || match[3] || 'Compilation error';
          
          return new FailureDetectionModel(
            uuidv4(),
            generationId,
            'type',
            'error',
            message.trim(),
            new CodeLocationModel('generated_code', line, col),
            'compile'
          );
        }
      }
      
      // Fallback for unmatched error formats
      if (errorLine.includes('error')) {
        return new FailureDetectionModel(
          uuidv4(),
          generationId,
          'type',
          'error',
          errorLine.trim(),
          new CodeLocationModel('generated_code', 1, 0),
          'compile'
        );
      }
      
    } catch (error) {
      // Return null if parsing fails
    }
    
    return null;
  }

  /**
   * Parse test failure output to create FailureDetection objects
   */
  private parseTestFailures(output: string, generationId: string): FailureDetection[] {
    const failures: FailureDetection[] = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      if (line.includes('FAILED') || line.includes('FAIL') || line.includes('AssertionError')) {
        failures.push(new FailureDetectionModel(
          uuidv4(),
          generationId,
          'dependency',
          'error',
          `Test failure: ${line.trim()}`,
          new CodeLocationModel('generated_code', 1, 0),
          'test'
        ));
      }
    }
    
    // If no specific failures found but there was an error, create generic failure
    if (failures.length === 0 && output.includes('error')) {
      failures.push(new FailureDetectionModel(
        uuidv4(),
        generationId,
        'dependency',
        'error',
        'Test execution failed',
        new CodeLocationModel('generated_code', 1, 0),
        'test'
      ));
    }
    
    return failures;
  }
}