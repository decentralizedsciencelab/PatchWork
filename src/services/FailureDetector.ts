import { IFailureDetector } from '../interfaces/IFailureDetector';
import { FailureDetection, Graph, Generation, GraphNode, FailureCategory } from '../types';
import { FailureDetectionModel, CodeLocationModel } from '../models/FailureDetection';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Category to detection method mapping for precise tracking
export interface CategoryDetectionStats {
  category: FailureCategory;
  count: number;
  detectedBy: 'graph-analysis' | 'compile' | 'test' | 'sast' | 'regex';
  graphTypes: string[];  // Which graph types were used for detection
}

export class FailureDetector implements IFailureDetector {

  private _standardLibs: Set<string> | null = null;

  private loadStandardLibs(): Set<string> {
    if (this._standardLibs) return this._standardLibs;

    const fsModule = require('fs');
    const pathModule = require('path');
    const libs = new Set<string>();

    // Helper: add modules from a list, including base module names
    const addPythonModules = (modules: string[]) => {
      for (const mod of modules) {
        libs.add(mod);
        // Also add base module (e.g., 'collections' from 'collections.abc')
        const base = mod.split('.')[0];
        if (base) libs.add(base);
      }
    };

    const addNodeModules = (modules: string[]) => {
      for (const mod of modules) {
        libs.add(mod);
        // Also add base module without node: prefix and sub-path
        const base = mod.replace('node:', '').split('/')[0];
        if (base) libs.add(base);
      }
    };

    let loaded = false;

    // Strategy 1: Load from new tools/data/ JSON files (preferred)
    try {
      const dataDir = pathModule.join(__dirname, '..', '..', 'tools', 'data');

      const pythonPath = pathModule.join(dataDir, 'python_stdlib.json');
      if (fsModule.existsSync(pythonPath)) {
        const pythonData = JSON.parse(fsModule.readFileSync(pythonPath, 'utf-8'));
        addPythonModules(pythonData.modules || []);
        loaded = true;
      }

      const nodePath = pathModule.join(dataDir, 'node_stdlib.json');
      if (fsModule.existsSync(nodePath)) {
        const nodeData = JSON.parse(fsModule.readFileSync(nodePath, 'utf-8'));
        addNodeModules(nodeData.modules || []);
        loaded = true;
      }
    } catch {
      // Fall through to legacy path
    }

    // Strategy 2: Fall back to legacy tools/python/stdlib_modules.json
    if (!loaded) {
      try {
        const legacyPath = pathModule.join(__dirname, '..', '..', 'tools', 'python', 'stdlib_modules.json');
        const data = JSON.parse(fsModule.readFileSync(legacyPath, 'utf-8'));
        addPythonModules(data.python || []);
        addNodeModules(data.nodejs || []);
        loaded = true;
      } catch {
        // Fall through to inline fallback
      }
    }

    // Strategy 3: Inline fallback if no files are available
    if (!loaded) {
      const fallback = new Set([
        'os', 'sys', 'json', 'typing', 'datetime', 'collections', 're', 'math',
        'functools', 'itertools', 'pathlib', 'subprocess', 'asyncio', 'logging',
        'io', 'http', 'urllib', 'email', 'html', 'xml', 'sqlite3', 'hashlib',
        'socket', 'ssl', 'threading', 'multiprocessing', 'abc', 'contextlib',
        'dataclasses', 'enum', 'copy', 'pprint', 'textwrap', 'struct', 'codecs',
        'csv', 'configparser', 'argparse', 'getopt', 'shutil', 'tempfile', 'glob',
        'fnmatch', 'stat', 'filecmp', 'pickle', 'shelve', 'dbm', 'gzip', 'bz2',
        'zipfile', 'tarfile', 'zlib', 'lzma', 'base64', 'binascii', 'platform',
        'time', 'calendar', 'locale', 'gettext', 'unicodedata', 'string',
        'difflib', 'operator', 'numbers', 'decimal', 'fractions', 'random',
        'statistics', 'bisect', 'heapq', 'array', 'weakref', 'types', 'inspect',
        'dis', 'gc', 'traceback', 'warnings', 'importlib', 'pkgutil',
        'unittest', 'doctest', 'pdb', 'profile', 'cProfile', 'timeit',
        'token', 'tokenize', 'ast', 'compileall', 'site',
        'fs', 'path', 'http', 'https', 'url', 'crypto', 'util', 'events', 'stream',
        'child_process', 'cluster', 'net', 'os', 'readline', 'tls', 'dns',
        'assert', 'buffer', 'console', 'process', 'querystring', 'zlib',
      ]);
      this._standardLibs = fallback;
      return fallback;
    }

    this._standardLibs = libs;
    return libs;
  }

  // ─── CFC Tool-Based Detection ─────────────────────────────────────────────

  // pylint rules that map to CFC (primary = high confidence)
  private static readonly CFC_PYLINT_RULES = new Set([
    'W0101',  // unreachable
    'W0705',  // duplicate-except (dead handler)
    'W1116',  // unreachable-except (if available)
  ]);

  // ESLint rules that map to CFC
  private static readonly CFC_ESLINT_RULES = new Set([
    'no-unreachable',
    'no-duplicate-case',
  ]);

  private extractCodeFromMarkdown(content: string): string {
    const codeBlockRegex = /```(?:python|typescript|ts|py|javascript|js)?\s*\n([\s\S]*?)```/g;
    const matches: string[] = [];
    let match;
    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match[1]) matches.push(match[1].trim());
    }
    if (matches.length > 0) return matches.join('\n\n');
    return content;
  }

  private detectLanguage(code: string): 'python' | 'typescript' {
    let pyScore = 0;
    let tsScore = 0;

    if (code.includes('def ')) pyScore += 3;
    if (code.includes('if __name__')) pyScore += 3;
    if (/^\s*class\s+\w+.*:/m.test(code)) pyScore += 2;
    if (code.includes('self.')) pyScore += 2;
    if (/^\s*from\s+\S+\s+import\s/m.test(code)) pyScore += 2;
    if (code.includes('elif ')) pyScore += 2;
    if (code.includes('except ') || code.includes('except:')) pyScore += 2;

    if (code.includes('interface ')) tsScore += 3;
    if (code.includes('export ')) tsScore += 2;
    if (code.includes('import type')) tsScore += 3;
    if (code.includes(': string') || code.includes(': number')) tsScore += 2;
    if (code.includes('const ') || code.includes('let ')) tsScore += 1;

    return pyScore >= tsScore ? 'python' : 'typescript';
  }

  /**
   * Hybrid CFC detection: combines (1) graph-based reachability analysis on the
   * CFG, (2) pattern-based dead-code / tautology scanning, and (3) pylint/ESLint
   * SAST as a supplementary layer.  Results from all three are merged and deduped
   * by line number to avoid double-counting.
   */
  async detectCFCFailures(
    generation: Generation,
    graphs?: Graph[],
  ): Promise<FailureDetection[]> {
    const code = this.extractCodeFromMarkdown(generation.generatedCode);
    if (!code.trim()) return [];

    const language = this.detectLanguage(code);

    // Layer 1: Graph-based reachability (uses the pre-built CFG)
    const graphFindings = graphs
      ? this.detectCFCFromGraph(generation.id, graphs)
      : [];

    // Layer 2: Pattern-based detection (no external tools)
    const patternFindings = this.detectCFCPatterns(code, generation.id, language);

    // Layer 3: SAST tool (pylint / ESLint)
    const sastFindings = language === 'python'
      ? this.detectCFCPython(code, generation.id)
      : this.detectCFCTypeScript(code, generation.id);

    // Deduplicate by line number (keep the highest-confidence source)
    const seenLines = new Set<number>();
    const merged: FailureDetection[] = [];

    // Priority: graph > pattern > SAST
    for (const f of [...graphFindings, ...patternFindings, ...sastFindings]) {
      const line = f.location.line;
      if (!seenLines.has(line)) {
        seenLines.add(line);
        merged.push(f);
      }
    }

    return merged;
  }

  // ─── CFC Layer 1: Graph-based reachability ────────────────────────────────

  /**
   * Walk the CFG for each function.  Flag functions where ALL body nodes
   * are unreachable from the entry — this indicates the function is entirely
   * dead (e.g., defined after an unconditional return at module level).
   *
   * We do NOT flag individual unreachable nodes because our CFG doesn't
   * model implicit exception edges, optional branches, or all fallthrough
   * paths, which causes excessive false positives.
   */
  private detectCFCFromGraph(generationId: string, graphs: Graph[]): FailureDetection[] {
    const cfgGraph = graphs.find(g => g.type === 'cfg');
    if (!cfgGraph || cfgGraph.nodes.length === 0) return [];

    const findings: FailureDetection[] = [];

    // Build adjacency list
    const adj = new Map<string, string[]>();
    for (const edge of cfgGraph.edges) {
      if (!adj.has(edge.source)) adj.set(edge.source, []);
      adj.get(edge.source)!.push(edge.target);
    }

    const functionNodes = cfgGraph.nodes.filter(n => n.type === 'function');

    for (const func of functionNodes) {
      // BFS from function entry
      const reachable = new Set<string>();
      const queue = [func.id];
      while (queue.length > 0) {
        const nid = queue.shift()!;
        if (reachable.has(nid)) continue;
        reachable.add(nid);
        for (const target of adj.get(nid) ?? []) {
          queue.push(target);
        }
      }

      // Count scoped nodes (excluding synthetic exit sentinels)
      const scopedNodes = cfgGraph.nodes.filter(n =>
        n.properties['functionScope'] === func.id &&
        !n.properties['synthetic'] &&
        n.id !== func.id
      );

      if (scopedNodes.length === 0) continue;

      const unreachableCount = scopedNodes.filter(n => !reachable.has(n.id)).length;

      // Only flag if EVERY body node is unreachable (entirely dead function body)
      if (unreachableCount === scopedNodes.length) {
        const line = (func.properties['line'] as number) || 1;
        findings.push(new FailureDetectionModel(
          uuidv4(),
          generationId,
          'CFC',
          'error',
          `Entirely dead function '${func.label}' at line ${line}: no code in function body is reachable from entry [source=cfg-reachability]`,
          new CodeLocationModel('generated_code', line, 0),
          'graph-analysis',
        ));
      }
    }

    return findings;
  }

  // ─── CFC Layer 2: Pattern-based detection ─────────────────────────────────

  /**
   * Scan source text for common CFC patterns that don't require a full CFG:
   *  - Dead code after unconditional return / raise / sys.exit / process.exit
   *  - Tautological conditions (if True / if False / if 1 == 1)
   *  - Duplicate except handlers
   *  - Infinite loops without break/return (while True with no exit)
   */
  private detectCFCPatterns(
    code: string,
    generationId: string,
    language: 'python' | 'typescript',
  ): FailureDetection[] {
    const lines = code.split('\n');
    const findings: FailureDetection[] = [];

    if (language === 'python') {
      this.detectPythonCFCPatterns(lines, generationId, findings);
    } else {
      this.detectTypeScriptCFCPatterns(lines, generationId, findings);
    }

    return findings;
  }

  private detectPythonCFCPatterns(
    lines: string[],
    generationId: string,
    findings: FailureDetection[],
  ): void {
    // Track indentation context for dead-code-after-return detection
    const terminators = /^\s*(return\b|raise\b|sys\.exit\s*\(|os\._exit\s*\(|exit\s*\(|quit\s*\()/;
    const blockOpeners = /^\s*(if\b|elif\b|else\s*:|for\b|while\b|try\s*:|except\b|finally\s*:|with\b|def\b|class\b|async\s+def\b|async\s+for\b|async\s+with\b)/;

    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      if (!line) continue;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // --- Dead code after terminator at same indent ---
      if (terminators.test(trimmed)) {
        // Skip multi-line statements: triple-quoted strings, open brackets/parens
        if (/"""/.test(trimmed) || /'''/.test(trimmed)) continue;  // Multi-line string
        if (/[\(\[\{,\\]\s*$/.test(trimmed)) continue;             // Open bracket / continuation
        // Check the terminator is a complete statement (not `return some_func(`)
        const openParens = (trimmed.match(/\(/g) || []).length;
        const closeParens = (trimmed.match(/\)/g) || []).length;
        if (openParens > closeParens) continue;  // Unclosed parentheses

        const indent = this.getIndentation(line);
        const nextIdx = i + 1;
        const nextLine = lines[nextIdx];
        if (!nextLine) continue;
        const nextTrimmed = nextLine.trim();
        if (!nextTrimmed || nextTrimmed.startsWith('#')) continue;

        const nextIndent = this.getIndentation(nextLine);

        // Dead code: same indentation, not a block closer (except/else/elif/finally)
        if (nextIndent === indent &&
            !blockOpeners.test(nextTrimmed) &&
            !nextTrimmed.startsWith('except') &&
            !nextTrimmed.startsWith('else') &&
            !nextTrimmed.startsWith('elif') &&
            !nextTrimmed.startsWith('finally') &&
            !nextTrimmed.startsWith('@') &&
            !nextTrimmed.startsWith('def ') &&
            !nextTrimmed.startsWith('class ')) {
          findings.push(new FailureDetectionModel(
            uuidv4(), generationId, 'CFC', 'warning',
            `Dead code after '${trimmed.split('(')[0]?.split(' ')[0] ?? trimmed}' at line ${i + 1}: line ${nextIdx + 1} is unreachable [source=pattern]`,
            new CodeLocationModel('generated_code', nextIdx + 1, 0),
            'graph-analysis',
          ));
        }
      }

      // --- Tautological / contradictory conditions ---
      const ifMatch = trimmed.match(/^(?:if|elif)\s+(.+?)\s*:/);
      if (ifMatch) {
        const cond = ifMatch[1]!;
        // Tautology: if True, if 1, if 1 == 1
        if (/^(True|1|1\s*==\s*1|""|''|not\s+False)$/.test(cond)) {
          findings.push(new FailureDetectionModel(
            uuidv4(), generationId, 'CFC', 'warning',
            `Tautological condition '${cond}' at line ${i + 1}: branch is always taken [source=pattern]`,
            new CodeLocationModel('generated_code', i + 1, 0),
            'graph-analysis',
          ));
        }
        // Contradiction: if False, if 0, if None
        if (/^(False|0|None|not\s+True)$/.test(cond)) {
          findings.push(new FailureDetectionModel(
            uuidv4(), generationId, 'CFC', 'error',
            `Contradictory condition '${cond}' at line ${i + 1}: branch is never taken (dead code) [source=pattern]`,
            new CodeLocationModel('generated_code', i + 1, 0),
            'graph-analysis',
          ));
        }
      }

      // --- Duplicate except handlers (same full exception class in same try) ---
      if (/^\s*except\s+[\w.]+/.test(trimmed)) {
        // Match full dotted name: except jwt.ExpiredSignatureError
        const excMatch = trimmed.match(/except\s+([\w.]+(?:\s+as\s+\w+)?)/);
        // Strip the "as alias" part to get the exception class
        const excType = excMatch?.[1]?.replace(/\s+as\s+\w+$/, '');
        if (excType) {
          const excIndent = this.getIndentation(line);
          for (let j = i + 1; j < lines.length; j++) {
            const fwd = lines[j];
            if (!fwd) continue;
            const fwdTrimmed = fwd.trim();
            if (!fwdTrimmed) continue;
            // Stop at anything that exits the current try block scope
            const fwdIndent = this.getIndentation(fwd);
            if (fwdIndent < excIndent && fwdTrimmed !== '') break;
            if (/^(try\s*:|def\s|class\s|async\s+def\s)/.test(fwdTrimmed)) break;
            // Check for same except at same indent
            if (fwdIndent === excIndent) {
              const dupMatch = fwdTrimmed.match(/^except\s+([\w.]+(?:\s+as\s+\w+)?)/);
              const dupType = dupMatch?.[1]?.replace(/\s+as\s+\w+$/, '');
              if (dupType && dupType === excType) {
                findings.push(new FailureDetectionModel(
                  uuidv4(), generationId, 'CFC', 'warning',
                  `Duplicate except handler for '${excType}' at lines ${i + 1} and ${j + 1}: second handler is unreachable [source=pattern]`,
                  new CodeLocationModel('generated_code', j + 1, 0),
                  'graph-analysis',
                ));
                break;
              }
            }
          }
        }
      }
    }

    // --- Infinite loop without exit ---
    this.detectInfiniteLoops(lines, generationId, findings, 'python');
  }

  private detectTypeScriptCFCPatterns(
    lines: string[],
    generationId: string,
    findings: FailureDetection[],
  ): void {
    const terminators = /^\s*(return\b|throw\b|process\.exit\s*\()/;

    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      if (!line) continue;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

      // --- Dead code after return/throw ---
      if (terminators.test(trimmed) && !trimmed.endsWith('{')) {
        // Check if the statement is complete (ends with ; or is single-line return)
        const isComplete = trimmed.endsWith(';') || trimmed.endsWith(')') ||
                           /^return\s*;?$/.test(trimmed) || /^throw\s+new\s+\w+\(.*\);?$/.test(trimmed);
        if (!isComplete) continue;

        const nextLine = lines[i + 1];
        if (!nextLine) continue;
        const nextTrimmed = nextLine.trim();
        if (!nextTrimmed || nextTrimmed.startsWith('//') || nextTrimmed.startsWith('*')) continue;
        if (nextTrimmed === '}' || nextTrimmed.startsWith('case ') ||
            nextTrimmed.startsWith('default:') || nextTrimmed.startsWith('catch') ||
            nextTrimmed.startsWith('finally')) continue;

        // Check indentation — dead code must be at same or deeper indent
        const indent = this.getIndentation(line);
        const nextIndent = this.getIndentation(nextLine);
        if (nextIndent >= indent && nextTrimmed !== '}') {
          findings.push(new FailureDetectionModel(
            uuidv4(), generationId, 'CFC', 'warning',
            `Dead code after '${trimmed.split('(')[0]?.split(' ')[0] ?? trimmed}' at line ${i + 1}: line ${i + 2} is unreachable [source=pattern]`,
            new CodeLocationModel('generated_code', i + 2, 0),
            'graph-analysis',
          ));
        }
      }

      // --- Tautological conditions ---
      const ifMatch = trimmed.match(/^(?:if|else\s+if)\s*\((.+?)\)\s*\{?/);
      if (ifMatch) {
        const cond = ifMatch[1]!.trim();
        if (/^(true|1|1\s*===?\s*1|!false|!!true)$/.test(cond)) {
          findings.push(new FailureDetectionModel(
            uuidv4(), generationId, 'CFC', 'warning',
            `Tautological condition '${cond}' at line ${i + 1}: branch is always taken [source=pattern]`,
            new CodeLocationModel('generated_code', i + 1, 0),
            'graph-analysis',
          ));
        }
        if (/^(false|0|null|undefined|!true|!!false)$/.test(cond)) {
          findings.push(new FailureDetectionModel(
            uuidv4(), generationId, 'CFC', 'error',
            `Contradictory condition '${cond}' at line ${i + 1}: branch is never taken (dead code) [source=pattern]`,
            new CodeLocationModel('generated_code', i + 1, 0),
            'graph-analysis',
          ));
        }
      }

      // --- Duplicate switch cases ---
      const caseMatch = trimmed.match(/^case\s+(.+?)\s*:/);
      if (caseMatch) {
        const caseVal = caseMatch[1]!;
        for (let j = i + 1; j < lines.length; j++) {
          const fwd = lines[j];
          if (!fwd) continue;
          const fwdTrimmed = fwd.trim();
          if (fwdTrimmed.startsWith('default:') || fwdTrimmed === '}') break;
          const dupCase = fwdTrimmed.match(/^case\s+(.+?)\s*:/);
          if (dupCase && dupCase[1] === caseVal) {
            findings.push(new FailureDetectionModel(
              uuidv4(), generationId, 'CFC', 'warning',
              `Duplicate case '${caseVal}' at lines ${i + 1} and ${j + 1}: second case is unreachable [source=pattern]`,
              new CodeLocationModel('generated_code', j + 1, 0),
              'graph-analysis',
            ));
            break;
          }
        }
      }
    }

    this.detectInfiniteLoops(lines, generationId, findings, 'typescript');
  }

  /**
   * Detect while True / while(true) loops that have no break, return, or
   * throw inside the loop body. These create infinite loops that make all
   * code after the loop unreachable.
   */
  private detectInfiniteLoops(
    lines: string[],
    generationId: string,
    findings: FailureDetection[],
    language: 'python' | 'typescript',
  ): void {
    const loopPattern = language === 'python'
      ? /^\s*while\s+(True|1)\s*:/
      : /^\s*while\s*\(\s*(true|1)\s*\)\s*\{?/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      if (!loopPattern.test(line)) continue;

      const loopIndent = this.getIndentation(line);
      let hasExit = false;

      // Scan the loop body for break/return/raise/throw
      for (let j = i + 1; j < lines.length; j++) {
        const bodyLine = lines[j];
        if (!bodyLine) continue;
        const bodyTrimmed = bodyLine.trim();
        if (!bodyTrimmed) continue;

        const bodyIndent = this.getIndentation(bodyLine);
        // Exited the loop body
        if (bodyIndent <= loopIndent && bodyTrimmed !== '') break;

        if (language === 'python') {
          if (/\b(break|return|raise|sys\.exit|os\._exit)\b/.test(bodyTrimmed)) {
            hasExit = true;
            break;
          }
        } else {
          if (/\b(break|return|throw|process\.exit)\b/.test(bodyTrimmed)) {
            hasExit = true;
            break;
          }
        }
      }

      if (!hasExit) {
        // Only flag if there is actual code after the loop that would be unreachable
        // (skip if the loop is the last meaningful statement in the function/module)
        let hasCodeAfterLoop = false;
        for (let j = i + 1; j < lines.length; j++) {
          const afterLine = lines[j];
          if (!afterLine) continue;
          const afterTrimmed = afterLine.trim();
          if (!afterTrimmed || afterTrimmed.startsWith('#') || afterTrimmed.startsWith('//')) continue;
          const afterIndent = this.getIndentation(afterLine);
          if (afterIndent > loopIndent) continue; // Still inside the loop body
          // A new function/class/decorator at same indent is a scope boundary, not dead code
          if (/^(def |class |async def |@|\})/.test(afterTrimmed)) break;
          if (language === 'typescript' && /^(function |export |const |let |var |import )/.test(afterTrimmed)) break;
          hasCodeAfterLoop = true;
          break;
        }

        if (hasCodeAfterLoop) {
          findings.push(new FailureDetectionModel(
            uuidv4(), generationId, 'CFC', 'error',
            `Infinite loop 'while ${language === 'python' ? 'True' : 'true'}' at line ${i + 1} has no break/return — code after this loop is unreachable [source=pattern]`,
            new CodeLocationModel('generated_code', i + 1, 0),
            'graph-analysis',
          ));
        }
      }
    }
  }

  // ─── CFC Layer 3: SAST-based detection (pylint/ESLint) ───────────────────


  private detectCFCPython(code: string, generationId: string): FailureDetection[] {
    let tmpDir: string | null = null;
    try {
      // 1. Write generated code to temp file
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patchwork-cfc-'));
      const tmpFile = path.join(tmpDir, 'generated_code.py');
      fs.writeFileSync(tmpFile, code);

      // 2. Run pylint with ONLY CFC-relevant checks enabled
      const pylintCmd = [
        'pylint',
        '--disable=all',
        '--enable=W0101,W0705,W1116',
        '--output-format=json2',
        '--jobs=1',
        tmpFile
      ].join(' ');

      let pylintOutput: string;
      try {
        pylintOutput = execSync(pylintCmd, {
          encoding: 'utf-8',
          timeout: 30000,
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch (e: any) {
        // pylint exits with non-zero when it finds issues — stdout has the JSON
        pylintOutput = e.stdout || '';
        // If pylint is not installed or crashes with no output, return empty
        if (!pylintOutput) return [];
      }

      // 3. Parse pylint JSON output
      interface PylintMessage {
        type: string;
        module: string;
        obj: string;
        line: number;
        column: number;
        endLine: number | null;
        endColumn: number | null;
        path: string;
        symbol: string;
        message: string;
        messageId: string;
      }

      let messages: PylintMessage[];
      try {
        const parsed = JSON.parse(pylintOutput);
        // json2 format wraps in {"messages": [...]}
        messages = parsed.messages || parsed;
        if (!Array.isArray(messages)) messages = [];
      } catch {
        return [];
      }

      // 4. Map pylint messages to CFC findings
      const findings: FailureDetection[] = [];
      for (const msg of messages) {
        if (!FailureDetector.CFC_PYLINT_RULES.has(msg.messageId)) continue;
        // Filter out syntax errors and import errors — not CFC
        if (msg.messageId.startsWith('E0')) continue;

        if (this.shouldSuppressPythonCFC(code, msg.line)) {
          continue;
        }

        const ruleTag = msg.messageId ? ` [rule=${msg.messageId}]` : '';
        findings.push(new FailureDetectionModel(
          uuidv4(),
          generationId,
          'CFC',
          msg.messageId.startsWith('E') ? 'error' : 'warning',
          `${msg.symbol}: ${msg.message}${msg.obj ? ` (in ${msg.obj})` : ''}${ruleTag}`,
          new CodeLocationModel('generated_code', msg.line, msg.column),
          'sast'
        ));
      }

      return findings;
    } catch {
      // pylint not available or other error — graceful degradation
      return [];
    } finally {
      if (tmpDir) {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  }

  private detectCFCTypeScript(code: string, generationId: string): FailureDetection[] {
    let tmpDir: string | null = null;
    try {
      // 1. Write generated code to temp file
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patchwork-cfc-'));
      const tmpFile = path.join(tmpDir, 'generated_code.ts');
      fs.writeFileSync(tmpFile, code);

      // 2. Write minimal ESLint flat config (ESLint v9+ compatible)
      const eslintConfig = `
import tsParser from "@typescript-eslint/parser";
export default [{
  files: ["**/*.ts"],
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: "module",
  },
  rules: {
    "no-unreachable": "error",
    "no-duplicate-case": "error",
  },
}];
`;
      const configFile = path.join(tmpDir, 'eslint.config.mjs');
      fs.writeFileSync(configFile, eslintConfig);

      // 3. Run ESLint
      const eslintCmd = [
        'npx', 'eslint',
        '--format=json',
        '--config', configFile,
        tmpFile
      ].join(' ');

      let eslintOutput: string;
      try {
        eslintOutput = execSync(eslintCmd, {
          encoding: 'utf-8',
          timeout: 30000,
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: path.join(__dirname, '..', '..'),  // project root for node_modules
        });
      } catch (e: any) {
        eslintOutput = e.stdout || '';
        if (!eslintOutput) return [];
      }

      // 4. Parse ESLint JSON output
      let results: any[];
      try {
        results = JSON.parse(eslintOutput);
        if (!Array.isArray(results)) return [];
      } catch {
        return [];
      }

      // 5. Map ESLint messages to CFC findings
      const findings: FailureDetection[] = [];
      for (const fileResult of results) {
        for (const msg of (fileResult.messages || [])) {
          if (!msg.ruleId || !FailureDetector.CFC_ESLINT_RULES.has(msg.ruleId)) continue;

          findings.push(new FailureDetectionModel(
            uuidv4(),
            generationId,
            'CFC',
            msg.severity === 2 ? 'error' : 'warning',
            `${msg.ruleId}: ${msg.message} [rule=${msg.ruleId}]`,
            new CodeLocationModel('generated_code', msg.line || 1, msg.column || 0),
            'sast'
          ));
        }
      }

      return findings;
    } catch {
      // ESLint not available or other error — graceful degradation
      return [];
    } finally {
      if (tmpDir) {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  }

  private shouldSuppressPythonCFC(code: string, line: number): boolean {
    const context = this.extractPythonFunctionContext(code, line);
    if (!context) return false;

    // Suppress for context managers and generators — these have inherently
    // non-linear control flow that pylint misjudges as unreachable.
    const hasContextDecorator = context.decorators.some(dec =>
      /contextmanager/.test(dec) || /asynccontextmanager/.test(dec)
    );
    const hasYield = context.bodyLines.some(l => /\byield\b/.test(l));

    if (hasContextDecorator || hasYield) {
      return true;
    }

    // Only suppress if the flagged line is *directly inside* a try/except/finally
    // block (within 3 lines of a try:/except:/finally: statement). This avoids
    // blanket-suppressing all CFC in functions that happen to contain error handling.
    const lines = code.split('\n');
    const targetIdx = Math.min(Math.max(line - 1, 0), lines.length - 1);
    const windowStart = Math.max(0, targetIdx - 3);
    const windowEnd = Math.min(lines.length - 1, targetIdx + 1);

    for (let i = windowStart; i <= windowEnd; i++) {
      const l = lines[i];
      if (!l) continue;
      const trimmed = l.trim();
      if (trimmed.startsWith('except') || trimmed.startsWith('finally:') ||
          trimmed === 'try:' || /^except\s/.test(trimmed) || /^except:/.test(trimmed)) {
        return true;
      }
    }

    return false;
  }

  private extractPythonFunctionContext(code: string, line: number): {
    signature: string;
    decorators: string[];
    bodyLines: string[];
  } | null {
    const lines = code.split('\n');
    if (!lines.length) return null;

    const targetIdx = Math.min(Math.max(line - 1, 0), lines.length - 1);
    let start = -1;

    for (let i = targetIdx; i >= 0; i--) {
      const line_i = lines[i];
      if (!line_i) continue;
      const trimmed = line_i.trim();
      if (/^def\s+\w+\s*\(/.test(trimmed)) {
        start = i;
        break;
      }
      if (/^class\s+\w+/.test(trimmed)) {
        break;
      }
    }

    if (start === -1) {
      return null;
    }

    const startLine = lines[start];
    if (!startLine) return null;
    const baseIndent = this.getIndentation(startLine);
    const bodyLines: string[] = [];

    for (let j = start + 1; j < lines.length; j++) {
      const text = lines[j];
      if (text === undefined) continue;
      const trimmed = text.trim();
      if (!trimmed) {
        bodyLines.push(text);
        continue;
      }

      const indent = this.getIndentation(text);
      if (indent <= baseIndent && !trimmed.startsWith('#')) {
        break;
      }
      bodyLines.push(text);
    }

    const decorators: string[] = [];
    for (let k = start - 1; k >= 0; k--) {
      const line_k = lines[k];
      if (!line_k) continue;
      const trimmed = line_k.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('@')) {
        decorators.push(trimmed);
        continue;
      }
      break;
    }

    return {
      signature: startLine,
      decorators,
      bodyLines
    };
  }

  private getIndentation(line: string): number {
    const match = line.match(/^\s*/);
    return match ? match[0].length : 0;
  }

  /**
   * Detect PIA (Phantom Import/API) - missing imports, circular dependencies
   * Detection method: Multi-Graph (import graph analysis)
   */
  async detectImportFailures(graphs: Graph[]): Promise<FailureDetection[]> {
    const failures: FailureDetection[] = [];

    const importGraphs = graphs.filter(g => g.type === 'import');
    const dependencyGraph = graphs.find(g => g.type === 'dependency');

    for (const graph of importGraphs) {
      // Detect missing imports - nodes that are referenced but not defined
      const missingImports = this.findMissingImports(graph);
      failures.push(...missingImports);

      // Detect circular dependencies
      const circularDeps = this.findCircularDependencies(graph);
      failures.push(...circularDeps);

      // PIA cross-graph check: imports whose dependency has registryExists === false
      // These are true phantom imports — the module doesn't exist anywhere
      if (dependencyGraph) {
        const standardLibs = this.loadStandardLibs();
        const phantomDeps = new Set<string>();
        for (const node of dependencyGraph.nodes) {
          if (node.properties['registryExists'] === false) {
            // Skip task-context internal modules (l2_task_1_models etc.)
            if (/^l\d+_task_/.test(node.label)) continue;
            phantomDeps.add(node.label);
          }
        }

        for (const node of graph.nodes) {
          if (node.type !== 'module') continue;
          const moduleName = node.label;
          const baseName = moduleName.includes('.')
            ? (moduleName.split('.')[0] || moduleName)
            : moduleName;
          const isStdLib = standardLibs.has(baseName) || standardLibs.has(moduleName);
          const isRelative = moduleName.startsWith('.') || moduleName.startsWith('/');

          if (!isStdLib && !isRelative && (phantomDeps.has(baseName) || phantomDeps.has(moduleName))) {
            const line = (node.properties['line'] as number) || 1;
            failures.push(new FailureDetectionModel(
              uuidv4(),
              graph.generationId,
              'PIA',
              'error',
              `Phantom import: Module '${moduleName}' does not exist in the package registry`,
              new CodeLocationModel('generated_code', line, 0),
              'graph-analysis'
            ));
          }
        }
      }
    }

    return failures;
  }

  /**
   * Detect call failures (undefined functions, signature mismatches)
   */
  async detectCallFailures(graphs: Graph[]): Promise<FailureDetection[]> {
    const failures: FailureDetection[] = [];

    const callGraphs = graphs.filter(g => g.type === 'call');
    const importGraph = graphs.find(g => g.type === 'import');
    const dependencyGraph = graphs.find(g => g.type === 'dependency');

    for (const graph of callGraphs) {
      // Detect undefined function calls
      const undefinedCalls = this.findUndefinedFunctionCalls(graph);
      failures.push(...undefinedCalls);

      // Detect signature mismatches
      const signatureMismatches = this.findSignatureMismatches(graph);
      failures.push(...signatureMismatches);

      // SRF cross-graph: calls to external functions from phantom/unresolved modules
      if (importGraph && dependencyGraph) {
        const standardLibs = this.loadStandardLibs();
        // Build set of phantom dependency labels
        const phantomDeps = new Set<string>();
        for (const node of dependencyGraph.nodes) {
          if (node.properties['registryExists'] === false) {
            const label = node.label;
            // Skip task-context internal modules (l2_task_1_models etc.)
            if (/^l\d+_task_/.test(label)) continue;
            if (!standardLibs.has(label) && !standardLibs.has(label.split('.')[0] || label)) {
              phantomDeps.add(label);
            }
          }
        }

        // Build import map: module label → imported names
        const importedFrom = new Map<string, string>();
        for (const node of importGraph.nodes) {
          if (node.type === 'import') {
            // Find the module this import comes from
            const moduleEdge = importGraph.edges.find(
              e => e.target === node.id && e.type === 'imports'
            );
            if (moduleEdge) {
              const moduleNode = importGraph.nodes.find(n => n.id === moduleEdge.source);
              if (moduleNode) {
                importedFrom.set(node.label, moduleNode.label);
              }
            }
          }
        }

        // Flag calls to external functions from phantom modules
        for (const node of graph.nodes) {
          if (node.properties['isExternal'] !== true) continue;
          const funcName = node.label;

          // Check 1: qualified call names like "phantom_pkg.func" where prefix is a phantom dep
          if (funcName.includes('.')) {
            const parts = funcName.split('.');
            const modulePrefix = parts[0] || funcName;
            if (phantomDeps.has(modulePrefix) || phantomDeps.has(funcName.substring(0, funcName.lastIndexOf('.')))) {
              const line = (node.properties['line'] as number) || 1;
              failures.push(new FailureDetectionModel(
                uuidv4(),
                graph.generationId,
                'SRF',
                'error',
                `Stale reference: Function '${parts[parts.length - 1]}' called from phantom module '${modulePrefix}' which does not exist`,
                new CodeLocationModel('generated_code', line, 0),
                'graph-analysis'
              ));
              continue;
            }
          }

          // Check 2: unqualified names resolved via import map ("from phantom import func")
          const fromModule = importedFrom.get(funcName);
          if (fromModule) {
            const baseName = fromModule.includes('.')
              ? (fromModule.split('.')[0] || fromModule)
              : fromModule;
            if (phantomDeps.has(baseName) || phantomDeps.has(fromModule)) {
              const line = (node.properties['line'] as number) || 1;
              failures.push(new FailureDetectionModel(
                uuidv4(),
                graph.generationId,
                'SRF',
                'error',
                `Stale reference: Function '${funcName}' called from phantom module '${fromModule}' which does not exist`,
                new CodeLocationModel('generated_code', line, 0),
                'graph-analysis'
              ));
            }
          }
        }
      }
    }

    return failures;
  }

  /**
   * Detect RCF (Resource Coherence Failures) via schema graph — type inconsistencies + constraint violations
   */
  async detectSchemaFailures(graphs: Graph[]): Promise<FailureDetection[]> {
    const failures: FailureDetection[] = [];
    
    const schemaGraphs = graphs.filter(g => g.type === 'schema');
    
    for (const graph of schemaGraphs) {
      // Detect type inconsistencies
      const typeInconsistencies = this.findTypeInconsistencies(graph);
      failures.push(...typeInconsistencies);
      
      // Detect constraint violations
      const constraintViolations = this.findConstraintViolations(graph);
      failures.push(...constraintViolations);
    }
    
    return failures;
  }

  /**
   * Detect configuration failures (invalid configs, missing settings)
   */
  async detectConfigFailures(graphs: Graph[]): Promise<FailureDetection[]> {
    const failures: FailureDetection[] = [];

    const configGraphs = graphs.filter(g => g.type === 'config');

    for (const graph of configGraphs) {
      // Detect invalid configurations
      const invalidConfigs = this.findInvalidConfigurations(graph);
      failures.push(...invalidConfigs);

      // Detect missing required settings
      const missingSettings = this.findMissingSettings(graph);
      failures.push(...missingSettings);

      // Detect unguarded environment variable accesses that may crash at runtime
      for (const node of graph.nodes) {
        const nodeType = node.properties['type'] as string | undefined;
        if (nodeType !== 'environment-variable' && node.type !== 'environment') continue;

        // Skip if any safety context detected (try/except, guard check)
        const safetyContext = node.properties['safetyContext'] as string | undefined;
        if (safetyContext) continue;

        // Only flag hard accessors — the graph now only contains these,
        // but double-check for backward compatibility
        const accessMethod = node.properties['accessMethod'] as string | undefined;
        const isHardAccess = accessMethod === 'subscript' ||
                              accessMethod === 'getenv_no_default' ||
                              accessMethod === 'dot_access' ||
                              accessMethod === 'non_null_assertion' ||
                              accessMethod === 'bracket_access';

        if (!isHardAccess && accessMethod !== undefined) continue;

        // Legacy nodes without accessMethod: fall back to hasDefault check
        if (accessMethod === undefined) {
          const hasDefault = node.properties['hasDefault'] === true ||
                             node.properties['defaultValue'] !== undefined;
          if (hasDefault) continue;
        }

        const line = (node.properties['line'] as number) || 1;
        failures.push(new FailureDetectionModel(
          uuidv4(),
          graph.generationId,
          'BCI',
          'error',
          `Unguarded access to environment variable '${node.label}' — no default value, no safety guard, may crash at runtime`,
          new CodeLocationModel('generated_code', line, 0),
          'graph-analysis'
        ));
      }
    }

    return failures;
  }

  /**
   * Analyze cross-graph structural inconsistencies
   */
  async analyzeStructuralInconsistencies(graphs: Graph[]): Promise<FailureDetection[]> {
    const failures: FailureDetection[] = [];
    
    // Group graphs by generation ID for cross-graph analysis
    const graphsByGeneration = this.groupGraphsByGeneration(graphs);
    
    for (const [, generationGraphs] of graphsByGeneration) {
      // Analyze inconsistencies between different graph types
      const inconsistencies = this.findCrossGraphInconsistencies(generationGraphs);
      failures.push(...inconsistencies);
    }
    
    return failures;
  }

  /**
   * Detect dependency failures (DHI - Dependency Hallucination)
   * Checks for missing dependencies, version conflicts, phantom imports
   */
  async detectDependencyFailures(generation: Generation, graphs: Graph[]): Promise<FailureDetection[]> {
    const failures: FailureDetection[] = [];

    const importGraph = graphs.find(g => g.type === 'import');
    const dependencyGraph = graphs.find(g => g.type === 'dependency');

    if (!importGraph || !dependencyGraph) {
      return failures;
    }

    // Get all imported modules
    const importedModules = new Set<string>();
    for (const node of importGraph.nodes) {
      if (node.type === 'module') {
        importedModules.add(node.label);
      }
    }

    // Get all declared dependencies
    const declaredDependencies = new Set<string>();
    for (const node of dependencyGraph.nodes) {
      if (node.type === 'dependency') {
        declaredDependencies.add(node.label);
      }
    }

    // Standard library modules to ignore — loaded from comprehensive list
    const standardLibs = this.loadStandardLibs();

    // Build set of context file basenames for filtering task-context internal modules
    const contextBasenames = new Set<string>();
    for (const ctxFile of (generation.contextFiles || [])) {
      // Extract basename without extension: "/path/to/models.py" → "models"
      const base = ctxFile.replace(/\\/g, '/').split('/').pop()?.replace(/\.[^.]+$/, '');
      if (base) contextBasenames.add(base);
    }

    // Check for imports that don't have corresponding dependencies
    for (const imported of importedModules) {
      // Handle both Python dot-paths (sqlalchemy.orm) and JS slash-paths (@scope/pkg)
      const baseName = imported.includes('.')
        ? (imported.split('.')[0] || imported)
        : (imported.split('/')[0] || imported);
      const isStdLib = standardLibs.has(baseName) || standardLibs.has(imported);
      const isRelative = imported.startsWith('.') || imported.startsWith('/') || /^[@~#]\//.test(imported);
      const isDeclared = declaredDependencies.has(baseName) ||
                         declaredDependencies.has(imported);

      // Skip task-context internal modules (l2_task_1_models etc.) and modules matching context files
      const isTaskContext = /^l\d+_task_/.test(imported) || /^l\d+_task_/.test(baseName);
      const isContextModule = contextBasenames.has(baseName) || contextBasenames.has(imported);
      // Skip placeholder modules hallucinated by LLMs
      const isPlaceholder = /^(some_|your_|my_|example_|placeholder_)/.test(baseName);

      if (!isStdLib && !isRelative && !isDeclared && !isTaskContext && !isContextModule && !isPlaceholder) {
        failures.push(new FailureDetectionModel(
          uuidv4(),
          generation.id,
          'DHI',  // Dependency Hallucination
          'error',
          `Missing dependency: Module '${imported}' is imported but not declared as a dependency`,
          new CodeLocationModel('generated_code', 1, 0),
          'graph-analysis'
        ));
      }
    }

    // Check for version-specific imports that might conflict
    const versionPattern = /@\d+\.\d+|==\d+\.\d+|>=\d+\.\d+/;
    for (const node of dependencyGraph.nodes) {
      if (node.properties['version'] && versionPattern.test(String(node.properties['version']))) {
        // Check if multiple versions of same package
        const samePkg = Array.from(dependencyGraph.nodes).filter(
          n => n.label === node.label && n.id !== node.id
        );
        if (samePkg.length > 0) {
          failures.push(new FailureDetectionModel(
            uuidv4(),
            generation.id,
            'DHI',  // Dependency Hallucination - version conflicts
            'warning',
            `Version conflict: Multiple versions of '${node.label}' may cause conflicts`,
            new CodeLocationModel('generated_code', 1, 0),
            'graph-analysis'
          ));
        }
      }
    }

    // Check for packages that don't exist in their registry (registry validation)
    // Skip stdlib modules — they're not on PyPI/npm but are valid imports
    for (const node of dependencyGraph.nodes) {
      if (node.properties['registryExists'] === false) {
        const pkgLabel = node.label;
        if (standardLibs.has(pkgLabel) || standardLibs.has(pkgLabel.split('.')[0] || pkgLabel)) {
          continue;
        }
        // Skip task-context internal modules (l2_task_1_models etc.)
        if (/^l\d+_task_/.test(pkgLabel)) continue;
        // Skip path aliases (@/..., ~/..., #/...) — these are local file references, not npm packages
        if (/^[@~#]\//.test(pkgLabel)) continue;
        const ecosystem = (node.properties['ecosystem'] as string) || 'unknown';
        failures.push(new FailureDetectionModel(
          uuidv4(),
          generation.id,
          'DHI',  // Dependency Hallucination - package not in registry
          'error',
          `Package '${pkgLabel}' not found in ${ecosystem} registry`,
          new CodeLocationModel('generated_code', 1, 0),
          'graph-analysis'
        ));
      }
    }

    return failures;
  }

  /**
   * Detect return/constraint failures (RCF)
   * Checks for missing returns, type mismatches.
   * CFC (unreachable code) detection has been moved to detectCFCFailures()
   * which uses pylint/ESLint instead of custom graph-based BFS.
   */
  async detectReturnFailures(generation: Generation, graphs: Graph[]): Promise<FailureDetection[]> {
    const failures: FailureDetection[] = [];

    const callGraph = graphs.find(g => g.type === 'call');
    const cfgGraph = graphs.find(g => g.type === 'cfg');

    // Analyze control flow for return issues (RCF only — CFC moved to detectCFCFailures)
    if (cfgGraph) {
      const functionNodes = cfgGraph.nodes.filter(n => n.type === 'function');

      for (const func of functionNodes) {
        const hasReturn = this.hasReturnPath(func.id, cfgGraph);

        if (!hasReturn && func.properties['hasReturnType']) {
          failures.push(new FailureDetectionModel(
            uuidv4(),
            generation.id,
            'RCF',
            'error',
            `Missing return: Function '${func.label}' has return type but may not return a value`,
            new CodeLocationModel('generated_code', func.properties['line'] as number || 1, 0),
            'graph-analysis'
          ));
        }
      }
    }

    // Analyze call graph for return value usage issues
    if (callGraph) {
      for (const edge of callGraph.edges) {
        if (edge.type === 'calls' && edge.properties['returnValueIgnored']) {
          failures.push(new FailureDetectionModel(
            uuidv4(),
            generation.id,
            'RCF',
            'warning',
            `Ignored return value: Return value from '${edge.target}' is not used`,
            new CodeLocationModel('generated_code', 1, 0),
            'graph-analysis'
          ));
        }
      }
    }

    return failures;
  }

  /**
   * Detect CCV (Cross-file Contract Violations) - middleware, decorator, aspect issues
   * Detection method: Multi-Graph (call graph + config graph analysis)
   */
  async detectCrossCuttingViolations(generation: Generation, graphs: Graph[]): Promise<FailureDetection[]> {
    const failures: FailureDetection[] = [];
    const callGraph = graphs.find(g => g.type === 'call');
    const configGraph = graphs.find(g => g.type === 'config');

    if (!callGraph) return failures;

    // Detect middleware chain issues
    const middlewareNodes = callGraph.nodes.filter(n =>
      n.type === 'middleware' ||
      n.label.toLowerCase().includes('middleware') ||
      n.label.toLowerCase().includes('interceptor')
    );

    for (const middleware of middlewareNodes) {
      // Check if middleware is properly chained — a middleware that is never
      // invoked (no incoming edges) is disconnected, even if it calls other functions
      const inEdges = callGraph.edges.filter(e => e.target === middleware.id);

      if (inEdges.length === 0) {
        failures.push(new FailureDetectionModel(
          uuidv4(),
          generation.id,
          'CCV',  // Cross-file Contract Violations
          'warning',
          `Disconnected middleware: '${middleware.label}' is not connected to any route or handler`,
          new CodeLocationModel('generated_code', middleware.properties['line'] as number || 1, 0),
          'graph-analysis'
        ));
      }
    }

    // Detect decorator/aspect application issues
    const decoratorNodes = callGraph.nodes.filter(n =>
      n.type === 'decorator' ||
      n.properties['isDecorator']
    );

    for (const decorator of decoratorNodes) {
      // Check if decorator is applied to any function
      const applications = callGraph.edges.filter(e =>
        e.source === decorator.id && e.type === 'decorates'
      );

      if (applications.length === 0) {
        failures.push(new FailureDetectionModel(
          uuidv4(),
          generation.id,
          'CCV',
          'warning',
          `Unused decorator: '${decorator.label}' is defined but not applied to any function`,
          new CodeLocationModel('generated_code', 1, 0),
          'graph-analysis'
        ));
      }
    }

    // Check config for middleware ordering issues
    if (configGraph) {
      const middlewareOrder = configGraph.nodes.filter(n =>
        n.properties['type'] === 'middleware_order'
      );

      for (const orderConfig of middlewareOrder) {
        const order = orderConfig.properties['order'] as string[] || [];
        // Check for duplicate middleware in order
        const seen = new Set<string>();
        for (const mw of order) {
          if (seen.has(mw)) {
            failures.push(new FailureDetectionModel(
              uuidv4(),
              generation.id,
              'CCV',
              'error',
              `Duplicate middleware in chain: '${mw}' appears multiple times in middleware order`,
              new CodeLocationModel('generated_code', 1, 0),
              'graph-analysis'
            ));
          }
          seen.add(mw);
        }
      }
    }

    // Detect field name convention mismatches across schema models
    const fieldNameMismatches = this.detectFieldNameConventionMismatches(generation, graphs);
    failures.push(...fieldNameMismatches);

    // Detect individual field name mismatches between related models (e.g., user_id vs userId)
    const fieldMismatches = this.detectFieldNameMismatches(generation, graphs);
    failures.push(...fieldMismatches);

    return failures;
  }

  // detectStateSyncRegressions removed — was disabled in Phase 3 (100% FP).
  // SSR detection now consolidated in detectRoutingFailures via resource-clustered auth pattern.

  /**
   * Detect RCF (Resource Coherence Failures) via resource graph - missing files/templates
   * Detection method: Resource graph analysis
   */
  async detectResourceFailures(generation: Generation, graphs: Graph[]): Promise<FailureDetection[]> {
    const failures: FailureDetection[] = [];

    const resourceGraphs = graphs.filter(g => g.type === 'resource');

    for (const graph of resourceGraphs) {
      for (const node of graph.nodes) {
        if (node.type !== 'resource_reference') continue;

        const refPath = node.label;
        const line = (node.properties['line'] as number) || 1;

        // Directory traversal patterns -> warning
        if (refPath.includes('..') && (refPath.match(/\.\./g) || []).length >= 2) {
          failures.push(new FailureDetectionModel(
            uuidv4(),
            generation.id,
            'RCF',
            'warning',
            `Suspicious directory traversal: '${refPath}' contains multiple '..' segments`,
            new CodeLocationModel('generated_code', line, 0),
            'graph-analysis'
          ));
        }

        // Template paths that don't match common patterns -> warning
        // Skip template literals that contain interpolation (${...}) — these are dynamic paths
        if (node.properties['resourceType'] === 'template') {
          const hasInterpolation = refPath.includes('${');
          const commonTemplatePattern = /\.(html|htm|jinja|jinja2|j2|txt|xml|md|mustache|hbs|ejs|pug)$/i;
          if (!hasInterpolation && !commonTemplatePattern.test(refPath)) {
            failures.push(new FailureDetectionModel(
              uuidv4(),
              generation.id,
              'RCF',
              'warning',
              `Unusual template path: '${refPath}' does not have a common template extension`,
              new CodeLocationModel('generated_code', line, 0),
              'graph-analysis'
            ));
          }
        }

        // Resources explicitly flagged as non-existent -> error (RCF)
        if (node.properties['exists'] === false) {
          failures.push(new FailureDetectionModel(
            uuidv4(),
            generation.id,
            'RCF',
            'error',
            `Missing resource: Referenced path '${refPath}' does not exist`,
            new CodeLocationModel('generated_code', line, 0),
            'graph-analysis'
          ));
        }

        // Hardcoded file reads in generated code — the referenced file may not
        // exist in the target repo (structural integration issue)
        const resourceType = node.properties['resourceType'] as string | undefined;
        // Skip template expressions (backtick template literals with ${...}) — these are dynamic paths
        const isTemplatePath = refPath.includes('${') || refPath.includes('`');
        if (resourceType === 'file_read' && !refPath.startsWith('/') && !isTemplatePath) {
          failures.push(new FailureDetectionModel(
            uuidv4(),
            generation.id,
            'RCF',
            'warning',
            `Hardcoded file path: '${refPath}' — generated code reads a file that may not exist in the target repository`,
            new CodeLocationModel('generated_code', line, 0),
            'graph-analysis'
          ));
        }
      }
    }

    return failures;
  }

  // ─── SSR Resource-Clustered Auth Pattern Detection ────────────────────────

  // Public resource segments that are inherently public — skip entire cluster
  private static readonly PUBLIC_RESOURCES = new Set([
    'health', 'healthz', 'healthcheck', 'status', 'ready', 'readiness', 'liveness',
    'login', 'signin', 'signup', 'register', 'auth',
    'public', 'open', 'webhook', 'webhooks', 'callback', 'oauth',
    'docs', 'swagger', 'openapi', 'redoc',
    'metrics', 'prometheus',
  ]);

  private static readonly SSR_MIN_CLUSTER_SIZE = 4;
  private static readonly SSR_GUARD_RATIO_THRESHOLD = 0.9;

  /**
   * Extract the resource segment from a route path.
   * Skips "api" and version prefixes (v1, v2), path parameters.
   * "/api/v1/users/{id}/posts" → "users"
   */
  private extractResourceSegment(routePath: string): string {
    const segments = routePath.replace(/^\/+|\/+$/g, '').split('/');
    const skipPrefixes = new Set(['api', 'v1', 'v2', 'v3', 'v4']);

    for (const segment of segments) {
      const lower = segment.toLowerCase();
      if (skipPrefixes.has(lower)) continue;
      // Skip path parameters: {id}, :id, <int:pk>
      if (segment.startsWith('{') || segment.startsWith(':') || segment.startsWith('<')) continue;
      if (segment.length > 0) return lower;
    }

    // Fallback: use the full normalized path
    return routePath.replace(/^\/+|\/+$/g, '').toLowerCase().replace(/\//g, '_') || 'root';
  }

  /**
   * Detect SSR (Security Structural Regressions) via resource-clustered auth pattern.
   *
   * Groups routes by resource segment, applies a public-route whitelist,
   * then flags routes that break an otherwise consistent auth pattern (>=90%
   * guarded) within their cluster. Cluster must have >= 4 routes.
   */
  async detectRoutingFailures(generation: Generation, graphs: Graph[]): Promise<FailureDetection[]> {
    const failures: FailureDetection[] = [];
    const routingGraphs = graphs.filter(g => g.type === 'routing');

    for (const graph of routingGraphs) {
      const routeNodes = graph.nodes.filter(n => n.type === 'route');
      if (routeNodes.length < FailureDetector.SSR_MIN_CLUSTER_SIZE) continue;

      // Layer 1: Cluster routes by resource segment, skipping whitelisted resources
      const clusters = new Map<string, GraphNode[]>();

      for (const node of routeNodes) {
        const resource = this.extractResourceSegment(node.label);
        if (FailureDetector.PUBLIC_RESOURCES.has(resource)) continue;

        const existing = clusters.get(resource) || [];
        existing.push(node);
        clusters.set(resource, existing);
      }

      // Layer 2+3: Apply majority rule per cluster
      for (const [resource, clusterRoutes] of clusters) {
        if (clusterRoutes.length < FailureDetector.SSR_MIN_CLUSTER_SIZE) continue;

        const guarded = clusterRoutes.filter(n => n.properties['hasAuth'] === true);
        const unguarded = clusterRoutes.filter(n => n.properties['hasAuth'] !== true);
        const guardRatio = guarded.length / clusterRoutes.length;

        if (guardRatio < FailureDetector.SSR_GUARD_RATIO_THRESHOLD) continue;
        if (unguarded.length === 0) continue;

        // Identify dominant guard name
        const guardCounts = new Map<string, number>();
        for (const node of guarded) {
          const guards = (node.properties['guards'] as string[]) || [];
          for (const guard of guards) {
            guardCounts.set(guard, (guardCounts.get(guard) || 0) + 1);
          }
        }
        let dominantGuard = 'auth';
        let maxCount = 0;
        for (const [guard, count] of guardCounts) {
          if (count > maxCount) {
            dominantGuard = guard;
            maxCount = count;
          }
        }

        // Flag deviants
        const destructiveMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
        for (const node of unguarded) {
          const method = ((node.properties['method'] as string) || 'GET').toUpperCase();
          const isDestructive = destructiveMethods.has(method);
          const line = (node.properties['line'] as number) || 1;
          const routePath = node.label;

          failures.push(new FailureDetectionModel(
            uuidv4(),
            generation.id,
            'SSR',
            isDestructive ? 'error' : 'warning',
            `Security regression: route '${method} ${routePath}' lacks guard '${dominantGuard}' present on ${guarded.length}/${clusterRoutes.length} sibling routes in /${resource}/* cluster`,
            new CodeLocationModel('generated_code', line, 0),
            'graph-analysis'
          ));
        }
      }
    }

    return failures;
  }

  /**
   * Detect all failure types for a generation
   */
  async detectAllFailures(generation: Generation, graphs: Graph[]): Promise<FailureDetection[]> {
    const failures: FailureDetection[] = [];

    // Filter graphs for this specific generation
    const generationGraphs = graphs.filter(g => g.generationId === generation.id);

    // Run all detection methods for all 8 paper categories
    const importFailures = await this.detectImportFailures(generationGraphs);       // PIA
    const callFailures = await this.detectCallFailures(generationGraphs);           // SRF
    const schemaFailures = await this.detectSchemaFailures(generationGraphs);       // RCF (schema constraints)
    const configFailures = await this.detectConfigFailures(generationGraphs);       // BCI
    const dependencyFailures = await this.detectDependencyFailures(generation, generationGraphs);  // DHI
    const returnFailures = await this.detectReturnFailures(generation, generationGraphs);  // RCF (return-type)
    const cfcFailures = await this.detectCFCFailures(generation, generationGraphs);  // CFC (hybrid: graph + pattern + SAST)
    const crossCuttingFailures = await this.detectCrossCuttingViolations(generation, generationGraphs);  // CCV
    const structuralFailures = await this.analyzeStructuralInconsistencies(generationGraphs);  // DHI
    const resourceFailures = await this.detectResourceFailures(generation, generationGraphs);  // RCF (resource integrity)
    const routingFailures = await this.detectRoutingFailures(generation, generationGraphs);  // SSR (routing)

    failures.push(
      ...importFailures,
      ...callFailures,
      ...schemaFailures,
      ...configFailures,
      ...dependencyFailures,
      ...returnFailures,
      ...cfcFailures,
      ...crossCuttingFailures,
      ...structuralFailures,
      ...resourceFailures,
      ...routingFailures
    );

    return failures;
  }

  // Helper methods for CCV field name convention mismatch detection

  private isSnakeCase(name: string): boolean {
    return name.includes('_') && name === name.toLowerCase();
  }

  private isCamelCase(name: string): boolean {
    return !name.includes('_') && /[a-z][A-Z]/.test(name);
  }

  private getModelBaseName(name: string): string {
    const suffixes = ['Response', 'Request', 'Create', 'Update', 'Delete', 'Patch', 'Input', 'Output', 'Schema', 'Model', 'Serializer', 'Form', 'View', 'DTO', 'Dto'];
    let result = name;
    for (const suffix of suffixes) {
      if (result.endsWith(suffix) && result.length > suffix.length) {
        result = result.slice(0, -suffix.length);
        break;
      }
    }
    return result;
  }

  private detectFieldNameConventionMismatches(generation: Generation, graphs: Graph[]): FailureDetection[] {
    const failures: FailureDetection[] = [];
    const schemaGraphs = graphs.filter(g => g.type === 'schema');

    // Collect all schema models with their fields
    const models: Array<{ name: string; baseName: string; fields: string[]; line: number }> = [];

    for (const graph of schemaGraphs) {
      const modelNodes = graph.nodes.filter(n => n.type === 'model' && !n.properties['isBase']);
      for (const model of modelNodes) {
        // Collect field names for this model via hasType edges
        const fieldEdges = graph.edges.filter(e => e.source === model.id && e.type === 'hasType');
        const fieldNames: string[] = [];
        for (const edge of fieldEdges) {
          const fieldNode = graph.nodes.find(n => n.id === edge.target && n.type === 'field');
          if (fieldNode) {
            fieldNames.push(fieldNode.label);
          }
        }

        if (fieldNames.length > 0) {
          models.push({
            name: model.label,
            baseName: this.getModelBaseName(model.label),
            fields: fieldNames,
            line: (model.properties['line'] as number) || 1,
          });
        }
      }
    }

    // Group models by base name
    const groups = new Map<string, typeof models>();
    for (const model of models) {
      const existing = groups.get(model.baseName) || [];
      existing.push(model);
      groups.set(model.baseName, existing);
    }

    // For each group with 2+ models, check field naming convention consistency
    for (const [baseName, group] of groups) {
      if (group.length < 2) continue;

      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const modelA = group[i]!;
          const modelB = group[j]!;

          const aSnakeFields = modelA.fields.filter(f => this.isSnakeCase(f));
          const aCamelFields = modelA.fields.filter(f => this.isCamelCase(f));
          const bSnakeFields = modelB.fields.filter(f => this.isSnakeCase(f));
          const bCamelFields = modelB.fields.filter(f => this.isCamelCase(f));

          const aIsSnake = aSnakeFields.length > aCamelFields.length && aSnakeFields.length > 0;
          const aIsCamel = aCamelFields.length > aSnakeFields.length && aCamelFields.length > 0;
          const bIsSnake = bSnakeFields.length > bCamelFields.length && bSnakeFields.length > 0;
          const bIsCamel = bCamelFields.length > bSnakeFields.length && bCamelFields.length > 0;

          if ((aIsSnake && bIsCamel) || (aIsCamel && bIsSnake)) {
            failures.push(new FailureDetectionModel(
              uuidv4(),
              generation.id,
              'CCV',
              'warning',
              `Field name convention mismatch: '${modelA.name}' uses ${aIsSnake ? 'snake_case' : 'camelCase'} but related model '${modelB.name}' uses ${bIsSnake ? 'snake_case' : 'camelCase'} (group: ${baseName})`,
              new CodeLocationModel('generated_code', modelA.line, 0),
              'graph-analysis'
            ));
          }
        }
      }
    }

    return failures;
  }

  /**
   * Detect individual field name mismatches between related models.
   * For example, a Pydantic model returning `user_id` paired with a TypeScript
   * interface destructuring `userId` — the same semantic field in different casing.
   */
  private detectFieldNameMismatches(generation: Generation, graphs: Graph[]): FailureDetection[] {
    const failures: FailureDetection[] = [];
    const schemaGraphs = graphs.filter(g => g.type === 'schema');

    // Collect all model fields grouped by model base name
    const modelFields: Array<{ modelName: string; baseName: string; fields: Array<{ name: string; normalized: string }>; line: number }> = [];

    for (const graph of schemaGraphs) {
      for (const node of graph.nodes) {
        if (node.type !== 'model' && node.type !== 'interface' && node.type !== 'type' && node.type !== 'schema') continue;
        if (node.properties['isBase']) continue;

        const fieldEdges = graph.edges.filter(e => e.source === node.id && e.type === 'hasType');
        const fields: Array<{ name: string; normalized: string }> = [];

        for (const edge of fieldEdges) {
          const fieldNode = graph.nodes.find(n => n.id === edge.target && n.type === 'field');
          if (fieldNode) {
            fields.push({ name: fieldNode.label, normalized: this.normalizeFieldName(fieldNode.label) });
          }
        }

        if (fields.length > 0) {
          modelFields.push({
            modelName: node.label,
            baseName: this.getModelBaseName(node.label),
            fields,
            line: (node.properties['line'] as number) || 1,
          });
        }
      }
    }

    // Group by base name and check for field-level mismatches
    const groups = new Map<string, typeof modelFields>();
    for (const model of modelFields) {
      const existing = groups.get(model.baseName) || [];
      existing.push(model);
      groups.set(model.baseName, existing);
    }

    for (const [, group] of groups) {
      if (group.length < 2) continue;

      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const modelA = group[i]!;
          const modelB = group[j]!;

          // Find fields that normalize to the same name but have different actual names
          for (const fieldA of modelA.fields) {
            for (const fieldB of modelB.fields) {
              if (fieldA.normalized === fieldB.normalized && fieldA.name !== fieldB.name) {
                failures.push(new FailureDetectionModel(
                  uuidv4(),
                  generation.id,
                  'CCV',
                  'warning',
                  `Field name mismatch: '${modelA.modelName}.${fieldA.name}' vs '${modelB.modelName}.${fieldB.name}' — same semantic field with different casing`,
                  new CodeLocationModel('generated_code', modelA.line, 0),
                  'graph-analysis'
                ));
              }
            }
          }
        }
      }
    }

    return failures;
  }

  /**
   * Normalize a field name to a canonical form for comparison.
   * Converts snake_case, camelCase, and PascalCase to the same lowercase form.
   */
  private normalizeFieldName(name: string): string {
    // Split on underscores and camelCase boundaries
    return name
      .replace(/([a-z])([A-Z])/g, '$1_$2')  // camelCase → camel_Case
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')  // HTMLParser → HTML_Parser
      .toLowerCase()
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  // Helper methods for return failure detection

  private hasReturnPath(functionId: string, cfgGraph: Graph): boolean {
    const visited = new Set<string>();
    const queue = [functionId];

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = cfgGraph.nodes.find(n => n.id === nodeId);
      if (node?.type === 'return' || node?.label === 'return') {
        return true;
      }

      const outEdges = cfgGraph.edges.filter(e => e.source === nodeId);
      for (const edge of outEdges) {
        queue.push(edge.target);
      }
    }

    return false;
  }

  // Private helper methods for specific failure detection

  private findMissingImports(graph: Graph): FailureDetection[] {
    const failures: FailureDetection[] = [];

    // Build ID→label lookup so we can resolve edge targets to human-readable names
    const idToLabel = new Map<string, string>();
    for (const node of graph.nodes) {
      idToLabel.set(node.id, node.label);
    }

    // Collect module labels (defined sources) and referenced target labels
    const definedModuleLabels = new Set<string>();
    for (const node of graph.nodes) {
      if (node.type === 'module' || node.type === 'file') {
        definedModuleLabels.add(node.label);
      }
    }

    // In the import graph, edges go from module→import (source=module, target=import-name)
    // The imported *names* are the targets. PIA means a name is imported from a module
    // that doesn't exist. We check if edge *sources* (the modules) are all defined.
    const referencedModuleLabels = new Set<string>();
    for (const edge of graph.edges) {
      if (edge.type === 'imports' || edge.type === 'requires') {
        // The source is the module node; resolve its label
        const sourceLabel = idToLabel.get(edge.source);
        if (sourceLabel) referencedModuleLabels.add(sourceLabel);
        // The target is the import-name node; resolve its label
        const targetLabel = idToLabel.get(edge.target);
        if (targetLabel) referencedModuleLabels.add(targetLabel);
      }
    }

    // PIA: check if any edge target resolves to a label not among defined modules
    // Actually, in our graph structure module→importedName, the modules ARE defined nodes.
    // PIA should detect when code uses a module that isn't in the import graph at all.
    // With enhanced tools, this is better handled by cross-graph checks.
    // Keep minimal: only flag if an edge references a node ID that doesn't exist in the graph.
    const allNodeIds = new Set(graph.nodes.map(n => n.id));
    for (const edge of graph.edges) {
      if (edge.type === 'imports' || edge.type === 'requires') {
        if (!allNodeIds.has(edge.target)) {
          const label = edge.target; // fallback if ID not found
          const failure = new FailureDetectionModel(
            uuidv4(),
            graph.generationId,
            'PIA',
            'error',
            `Missing import: Module '${label}' is referenced but not defined`,
            new CodeLocationModel('unknown', 1, 0),
            'graph-analysis'
          );
          failures.push(failure);
        }
      }
    }

    return failures;
  }

  private findCircularDependencies(graph: Graph): FailureDetection[] {
    const failures: FailureDetection[] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const adjacencyList = this.buildAdjacencyList(graph);
    
    // DFS to detect cycles
    const hasCycle = (node: string, path: string[]): boolean => {
      if (recursionStack.has(node)) {
        // Found a cycle
        const cycleStart = path.indexOf(node);
        const cycle = path.slice(cycleStart).concat(node);
        
        const failure = new FailureDetectionModel(
          uuidv4(),
          graph.generationId,
          'PIA',  // Circular deps are Phantom Import/API
          'error',
          `Circular dependency detected: ${cycle.join(' -> ')}`,
          new CodeLocationModel('unknown', 1, 0),
          'graph-analysis'
        );
        failures.push(failure);
        return true;
      }
      
      if (visited.has(node)) {
        return false;
      }
      
      visited.add(node);
      recursionStack.add(node);
      
      const neighbors = adjacencyList.get(node) || [];
      for (const neighbor of neighbors) {
        if (hasCycle(neighbor, [...path, node])) {
          return true;
        }
      }
      
      recursionStack.delete(node);
      return false;
    };
    
    // Check all nodes for cycles
    for (const node of graph.nodes) {
      if (!visited.has(node.id)) {
        hasCycle(node.id, []);
      }
    }
    
    return failures;
  }

  private findUndefinedFunctionCalls(graph: Graph): FailureDetection[] {
    const failures: FailureDetection[] = [];

    // Build label-based lookup: use node.label (function name) not node.id (UUID)
    const definedFunctionLabels = new Set<string>();
    const allNodeIds = new Set<string>();
    const idToLabel = new Map<string, string>();

    for (const node of graph.nodes) {
      allNodeIds.add(node.id);
      idToLabel.set(node.id, node.label);
      if (node.type === 'function' || node.type === 'method') {
        definedFunctionLabels.add(node.label);
      }
    }

    // Only flag if an edge target doesn't exist as a node in the graph
    // (EnhancedGraphConstructor creates nodes for external callees too)
    for (const edge of graph.edges) {
      if (edge.type === 'calls' || edge.type === 'invokes') {
        if (!allNodeIds.has(edge.target)) {
          const label = idToLabel.get(edge.target) || edge.target;
          const failure = new FailureDetectionModel(
            uuidv4(),
            graph.generationId,
            'SRF',
            'error',
            `Undefined function call: Function '${label}' is called but not defined`,
            new CodeLocationModel('unknown', 1, 0),
            'graph-analysis'
          );
          failures.push(failure);
        }
      }
    }

    return failures;
  }

  private findSignatureMismatches(graph: Graph): FailureDetection[] {
    const failures: FailureDetection[] = [];
    
    // Analyze function signatures and their call sites
    for (const edge of graph.edges) {
      if (edge.type === 'calls' && edge.properties['arguments'] && edge.properties['expectedParameters']) {
        const args = edge.properties['arguments'] as any[];
        const params = edge.properties['expectedParameters'] as any[];
        
        if (args.length !== params.length) {
          const failure = new FailureDetectionModel(
            uuidv4(),
            graph.generationId,
            'SRF',  // Schema/Resource/Return Failures - signature mismatch
            'error',
            `Signature mismatch: Function expects ${params.length} parameters but received ${args.length} arguments`,
            new CodeLocationModel('unknown', 1, 0),
            'graph-analysis'
          );
          failures.push(failure);
        }
      }
    }
    
    return failures;
  }

  private findTypeInconsistencies(graph: Graph): FailureDetection[] {
    const failures: FailureDetection[] = [];
    
    // Analyze type relationships in schema graph
    for (const edge of graph.edges) {
      if (edge.type === 'hasType' || edge.type === 'extends') {
        const sourceNode = graph.nodes.find(n => n.id === edge.source);
        const targetNode = graph.nodes.find(n => n.id === edge.target);
        
        if (sourceNode && targetNode) {
          // Check for type compatibility
          if (this.areTypesIncompatible(sourceNode, targetNode)) {
            const failure = new FailureDetectionModel(
              uuidv4(),
              graph.generationId,
              'RCF',  // Resource Coherence Failures - type inconsistency
              'error',
              `Type inconsistency: ${sourceNode.label} cannot be assigned type ${targetNode.label}`,
              new CodeLocationModel('unknown', 1, 0),
              'graph-analysis'
            );
            failures.push(failure);
          }
        }
      }
    }
    
    return failures;
  }

  private findConstraintViolations(graph: Graph): FailureDetection[] {
    const failures: FailureDetection[] = [];
    
    // Check schema constraints
    for (const node of graph.nodes) {
      if (node.type === 'field' && node.properties['constraints']) {
        const constraints = node.properties['constraints'] as any[];
        
        for (const constraint of constraints) {
          if (this.violatesConstraint(node, constraint)) {
            const failure = new FailureDetectionModel(
              uuidv4(),
              graph.generationId,
              'RCF',  // Resource Coherence Failures - constraint violation
              'warning',
              `Constraint violation: Field '${node.label}' violates constraint '${constraint.type}'`,
              new CodeLocationModel('unknown', 1, 0),
              'graph-analysis'
            );
            failures.push(failure);
          }
        }
      }
    }
    
    return failures;
  }

  private findInvalidConfigurations(graph: Graph): FailureDetection[] {
    const failures: FailureDetection[] = [];
    
    // Check configuration validity
    for (const node of graph.nodes) {
      if (node.type === 'config' && node.properties['value'] !== undefined) {
        if (this.isInvalidConfigValue(node)) {
          const failure = new FailureDetectionModel(
            uuidv4(),
            graph.generationId,
            'BCI',  // Build/Configuration Incoherence
            'error',
            `Invalid configuration: '${node.label}' has invalid value '${node.properties['value']}'`,
            new CodeLocationModel('unknown', 1, 0),
            'graph-analysis'
          );
          failures.push(failure);
        }
      }
    }
    
    return failures;
  }

  private findMissingSettings(graph: Graph): FailureDetection[] {
    const failures: FailureDetection[] = [];

    // Only flag config issues if the config graph actually has nodes.
    // Previously this used a hardcoded list ['database_url', 'api_key', 'port']
    // which produced false positives on every file. Now we only flag
    // configs where the value is empty/undefined or type mismatches.
    for (const node of graph.nodes) {
      if (node.type !== 'config') continue;

      const value = node.properties['value'];
      const expectedType = node.properties['expectedType'] as string | undefined;

      // Flag configs with no value set — but skip required dataclass/class fields.
      // A field like `db_type: str` (has expectedType, no value) is a required
      // constructor parameter, not a missing config. Only flag fields with neither
      // a type annotation nor a value, or fields without any type annotation.
      if (value === undefined || value === null || value === '') {
        // Skip required typed fields — these are constructor parameters by design
        if (expectedType) continue;

        failures.push(new FailureDetectionModel(
          uuidv4(),
          graph.generationId,
          'BCI',
          'warning',
          `Config '${node.label}' has no value set`,
          new CodeLocationModel('generated_code', (node.properties['line'] as number) || 1, 0),
          'graph-analysis'
        ));
      }

      // Flag type mismatches if expectedType is specified
      if (expectedType && value !== undefined && value !== null) {
        const valueStr = String(value);
        // Allow simple arithmetic expressions (e.g. 60 * 24 * 8) as valid int values
        const isArithmeticExpr = /^[\d\s+\-*/().]+$/.test(valueStr);
        if (expectedType === 'int' && isNaN(Number(valueStr)) && !isArithmeticExpr) {
          failures.push(new FailureDetectionModel(
            uuidv4(),
            graph.generationId,
            'BCI',
            'error',
            `Config '${node.label}' expects ${expectedType} but got '${valueStr}'`,
            new CodeLocationModel('generated_code', (node.properties['line'] as number) || 1, 0),
            'graph-analysis'
          ));
        }
        if (expectedType === 'bool' && !['true', 'false', 'True', 'False', '0', '1'].includes(valueStr)) {
          failures.push(new FailureDetectionModel(
            uuidv4(),
            graph.generationId,
            'BCI',
            'error',
            `Config '${node.label}' expects ${expectedType} but got '${valueStr}'`,
            new CodeLocationModel('generated_code', (node.properties['line'] as number) || 1, 0),
            'graph-analysis'
          ));
        }
      }
    }

    return failures;
  }

  private findCrossGraphInconsistencies(graphs: Graph[]): FailureDetection[] {
    const failures: FailureDetection[] = [];

    if (graphs.length < 2) return failures;

    const generationId = graphs[0]?.generationId;
    if (!generationId) return failures;

    // Check for inconsistencies between import and call graphs
    const importGraph = graphs.find(g => g.type === 'import');
    const callGraph = graphs.find(g => g.type === 'call');

    if (importGraph && callGraph) {
      // Build ID→label maps for both graphs
      const importIdToLabel = new Map<string, string>();
      for (const node of importGraph.nodes) {
        importIdToLabel.set(node.id, node.label);
      }
      const callIdToLabel = new Map<string, string>();
      for (const node of callGraph.nodes) {
        callIdToLabel.set(node.id, node.label);
      }

      // Collect imported module labels (not UUIDs)
      const importedModuleLabels = new Set<string>();
      for (const node of importGraph.nodes) {
        if (node.type === 'module') {
          importedModuleLabels.add(node.label);
        }
        if (node.type === 'import') {
          importedModuleLabels.add(node.label);
        }
      }

      // Collect locally-defined names from the call graph — these are functions,
      // classes, parameters, and variables defined in the generated code itself.
      // Method calls on these (e.g., cursor.execute(), data.get()) should NOT be
      // flagged as missing imports.
      const locallyDefinedNames = new Set<string>();
      for (const node of callGraph.nodes) {
        // Skip external function references — these represent imported module functions
        // (e.g., "unimported_module.some_function" is external, not locally defined)
        if (node.properties['isExternal']) continue;

        // Function/class definition nodes define local names — but only unqualified
        // names (no dots). Qualified labels like "module.func" are external references.
        if (node.type === 'function' || node.type === 'class' || node.type === 'method') {
          if (!node.label.includes('.')) {
            locallyDefinedNames.add(node.label);
          }
        }
        // Parameters and variables are local
        if (node.type === 'parameter' || node.type === 'variable') {
          locallyDefinedNames.add(node.label);
        }
      }

      // Build the set of known importable module names from stdlib + dependency graph
      const standardLibs = this.loadStandardLibs();
      const dependencyGraph = graphs.find(g => g.type === 'dependency');
      const knownPackages = new Set<string>(standardLibs);
      if (dependencyGraph) {
        for (const node of dependencyGraph.nodes) {
          knownPackages.add(node.label);
          const base = node.label.split('.')[0];
          if (base) knownPackages.add(base);
        }
      }

      // Collect called function labels
      const calledFunctionLabels = new Set<string>();
      for (const edge of callGraph.edges) {
        if (edge.type === 'calls') {
          const label = callIdToLabel.get(edge.target);
          if (label) calledFunctionLabels.add(label);
        }
      }

      // Check if called functions belong to imported modules
      for (const funcLabel of calledFunctionLabels) {
        const moduleName = this.extractModuleName(funcLabel);
        if (!moduleName) continue;

        // Skip builtins — these don't need imports
        if (moduleName === '<builtin>' || moduleName === 'builtins') continue;

        // Skip self/cls/this — always local references
        if (moduleName === 'self' || moduleName === 'cls' || moduleName === 'this') continue;

        // Skip temp-file prefixed names (PyCG artifacts like tmpXXXXXX.ClassName)
        if (/^tmp[a-z0-9_]{4,}$/i.test(moduleName)) continue;

        // Skip names defined locally in the call graph (functions, classes, variables)
        if (locallyDefinedNames.has(moduleName)) continue;

        // Skip names that are NOT known importable packages — if the name isn't
        // in stdlib, dependency graph, or import graph, it's most likely a local
        // variable (e.g., cursor, data, conn, app) rather than a missing import.
        if (!knownPackages.has(moduleName) && !importedModuleLabels.has(moduleName)) continue;

        // Normalize: check both with and without leading dot (relative imports)
        const dotModule = '.' + moduleName;
        if (importedModuleLabels.has(moduleName) || importedModuleLabels.has(dotModule)) continue;
        // Also check if any imported module label ends with the module name (e.g., '.compat' contains 'compat')
        let found = false;
        for (const imp of importedModuleLabels) {
          const impBase = imp.replace(/^\.+/, ''); // strip leading dots
          if (impBase === moduleName || impBase.endsWith('.' + moduleName)) {
            found = true;
            break;
          }
        }
        if (found) continue;

        // Skip local variable method calls that collide with stdlib module names.
        // E.g., email.lower() → moduleName='email', but 'email' is a local variable,
        // not the stdlib email package. Detect by checking if the method part of
        // funcLabel is a common instance method (lower, encode, execute, etc.).
        const methodPart = funcLabel.includes('.') ? funcLabel.split('.').pop() : null;
        if (methodPart && knownPackages.has(moduleName)) {
          const COMMON_INSTANCE_METHODS = new Set([
            // String methods
            'lower', 'upper', 'strip', 'lstrip', 'rstrip', 'split', 'rsplit',
            'join', 'replace', 'find', 'rfind', 'index', 'rindex', 'startswith',
            'endswith', 'encode', 'decode', 'format', 'format_map', 'count',
            'capitalize', 'title', 'swapcase', 'center', 'ljust', 'rjust',
            'zfill', 'expandtabs', 'isalpha', 'isdigit', 'isalnum', 'isspace',
            'isupper', 'islower', 'istitle',
            // Collection methods
            'append', 'extend', 'insert', 'remove', 'pop', 'clear', 'sort',
            'reverse', 'copy', 'get', 'keys', 'values', 'items', 'update',
            'setdefault', 'add', 'discard',
            // DB/IO methods
            'execute', 'executemany', 'fetchone', 'fetchall', 'fetchmany',
            'commit', 'rollback', 'close', 'read', 'write', 'readline',
            'readlines', 'writelines', 'flush', 'seek', 'tell',
            // Network/request methods
            'send', 'recv', 'connect', 'bind', 'listen', 'accept',
            'json', 'text', 'status_code', 'headers',
            // General object methods
            'save', 'delete', 'create', 'filter', 'exclude', 'all', 'first',
            'last', 'exists', 'count', 'order_by', 'select_related',
          ]);
          if (COMMON_INSTANCE_METHODS.has(methodPart)) continue;
        }

        const failure = new FailureDetectionModel(
          uuidv4(),
          generationId,
          'DHI',
          'error',
          `Cross-graph inconsistency: Function '${funcLabel}' is called but its module '${moduleName}' is not imported`,
          new CodeLocationModel('unknown', 1, 0),
          'graph-analysis'
        );
        failures.push(failure);
      }
    }

    return failures;
  }

  // Utility methods

  private buildAdjacencyList(graph: Graph): Map<string, string[]> {
    const adjacencyList = new Map<string, string[]>();
    
    for (const node of graph.nodes) {
      adjacencyList.set(node.id, []);
    }
    
    for (const edge of graph.edges) {
      const neighbors = adjacencyList.get(edge.source) || [];
      neighbors.push(edge.target);
      adjacencyList.set(edge.source, neighbors);
    }
    
    return adjacencyList;
  }

  private groupGraphsByGeneration(graphs: Graph[]): Map<string, Graph[]> {
    const grouped = new Map<string, Graph[]>();
    
    for (const graph of graphs) {
      const existing = grouped.get(graph.generationId) || [];
      existing.push(graph);
      grouped.set(graph.generationId, existing);
    }
    
    return grouped;
  }

  private areTypesIncompatible(sourceNode: GraphNode, targetNode: GraphNode): boolean {
    // Simple type compatibility check - can be extended with more sophisticated logic
    const sourceType = sourceNode.properties['dataType'] || sourceNode.type;
    const targetType = targetNode.properties['dataType'] || targetNode.type;
    
    // Basic incompatibility rules
    const incompatiblePairs = [
      ['string', 'number'],
      ['boolean', 'string'],
      ['array', 'object'],
    ];
    
    return incompatiblePairs.some(([type1, type2]) => 
      (sourceType === type1 && targetType === type2) ||
      (sourceType === type2 && targetType === type1)
    );
  }

  private violatesConstraint(node: GraphNode, constraint: any): boolean {
    // Simple constraint validation - can be extended
    switch (constraint.type) {
      case 'required':
        return !node.properties['value'];
      case 'minLength':
        return typeof node.properties['value'] === 'string' && 
               node.properties['value'].length < constraint.value;
      case 'maxLength':
        return typeof node.properties['value'] === 'string' && 
               node.properties['value'].length > constraint.value;
      default:
        return false;
    }
  }

  private isInvalidConfigValue(node: GraphNode): boolean {
    // Simple config validation - can be extended
    const value = node.properties['value'];
    const expectedType = node.properties['expectedType'];
    
    if (expectedType === 'number' && isNaN(Number(value))) {
      return true;
    }
    
    if (expectedType === 'boolean' && typeof value !== 'boolean') {
      return true;
    }
    
    if (expectedType === 'url' && typeof value === 'string') {
      try {
        new URL(value);
        return false;
      } catch {
        return true;
      }
    }
    
    return false;
  }

  private extractModuleName(functionName: string): string | null {
    // Extract module name from function name (e.g., "module.function" -> "module")
    const parts = functionName.split('.');
    return parts.length > 1 ? parts[0] ?? null : null;
  }
}
