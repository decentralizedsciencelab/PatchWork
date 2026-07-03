import * as ts from 'typescript';

export interface TSImportInfo {
  moduleName: string;
  importedNames: string[];
  isTypeOnly: boolean;
  line: number;
  isRelative: boolean;
}

export interface TSFunctionInfo {
  name: string;
  line: number;
  parameters: number;
  isMethod: boolean;
  isAsync: boolean;
  hasReturnType: boolean;
  returnType: string | null;
}

export interface TSCallInfo {
  caller: string;
  callees: string[];
  line: number;
}

export interface TSCFGNode {
  type: string;
  line: number;
  condition?: string;
  functionScope?: string;
  loopType?: string;
  // Branching CFG fields
  blockId?: string;
  parentBlockId?: string | null;
  blockKind?: string;
  isTerminator?: boolean;
}

export interface TSResourceRef {
  type: 'fs' | 'require-resolve' | 'path-join' | 'template' | 'public-dir';
  referencedPath: string;
  line: number;
  callExpression: string;
}

export interface TSRouteInfo {
  path: string;
  method: string;
  line: number;
  handlerName: string;
  guards: string[];
  hasAuth: boolean;
}

export interface TSMiddlewareInfo {
  name: string;
  line: number;
  path?: string | undefined;
  type: 'middleware' | 'error-handler';
}

/**
 * Enhanced TypeScript analysis using the ts compiler API.
 */
export class TypeScriptAnalyzer {

  /**
   * Detect tsconfig path aliases like @/..., ~/..., #/...
   * These are local file references, not npm packages.
   * Real scoped packages have an org name: @angular/core, @nestjs/common.
   */
  private isPathAlias(moduleName: string): boolean {
    return /^[@~#]\//.test(moduleName);
  }

  analyzeImports(code: string): { imports: TSImportInfo[]; errors: string[] } {
    const imports: TSImportInfo[] = [];
    const errors: string[] = [];

    try {
      const sourceFile = ts.createSourceFile('temp.ts', code, ts.ScriptTarget.Latest, true);

      const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node)) {
          const moduleSpecifier = node.moduleSpecifier;
          if (ts.isStringLiteral(moduleSpecifier)) {
            const moduleName = moduleSpecifier.text;
            const isTypeOnly = node.importClause?.isTypeOnly || false;
            const isRelative = moduleName.startsWith('.') || this.isPathAlias(moduleName);
            const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

            const importedNames: string[] = [];

            if (node.importClause) {
              // Default import
              if (node.importClause.name) {
                importedNames.push(node.importClause.name.text);
              }
              // Named imports
              if (node.importClause.namedBindings) {
                if (ts.isNamedImports(node.importClause.namedBindings)) {
                  node.importClause.namedBindings.elements.forEach(el => {
                    importedNames.push(el.name.text);
                  });
                } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
                  importedNames.push(`* as ${node.importClause.namedBindings.name.text}`);
                }
              }
            }

            imports.push({ moduleName, importedNames, isTypeOnly, line, isRelative });
          }
        }

        // Also catch require() calls
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
          if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0]!)) {
            const moduleName = (node.arguments[0] as ts.StringLiteral).text;
            const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
            imports.push({
              moduleName,
              importedNames: [moduleName.split('/').pop() || moduleName],
              isTypeOnly: false,
              line,
              isRelative: moduleName.startsWith('.') || this.isPathAlias(moduleName),
            });
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    } catch (e: any) {
      errors.push(e.message);
    }

    return { imports, errors };
  }

  analyzeCalls(code: string): { functions: TSFunctionInfo[]; calls: TSCallInfo[]; errors: string[] } {
    const functions: TSFunctionInfo[] = [];
    const calls: TSCallInfo[] = [];
    const errors: string[] = [];

    try {
      const sourceFile = ts.createSourceFile('temp.ts', code, ts.ScriptTarget.Latest, true);
      const currentScope: string[] = [];

      const visit = (node: ts.Node) => {
        // Function declarations
        if (ts.isFunctionDeclaration(node) && node.name) {
          const funcInfo = this.extractFunctionInfo(node, sourceFile, false);
          functions.push(funcInfo);

          currentScope.push(funcInfo.name);
          const callTargets = this.collectCallsInNode(node, sourceFile);
          if (callTargets.length > 0) {
            calls.push({ caller: funcInfo.name, callees: callTargets, line: funcInfo.line });
          }
          ts.forEachChild(node, visit);
          currentScope.pop();
          return;
        }

        // Method declarations
        if (ts.isMethodDeclaration(node) && node.name) {
          const name = node.name.getText(sourceFile);
          const parentClass = this.findParentClassName(node, sourceFile);
          const fullName = parentClass ? `${parentClass}.${name}` : name;

          functions.push({
            name: fullName,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            parameters: node.parameters.length,
            isMethod: true,
            isAsync: node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) || false,
            hasReturnType: !!node.type,
            returnType: node.type ? node.type.getText(sourceFile) : null,
          });

          currentScope.push(fullName);
          const callTargets = this.collectCallsInNode(node, sourceFile);
          if (callTargets.length > 0) {
            calls.push({ caller: fullName, callees: callTargets, line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
          }
          ts.forEachChild(node, visit);
          currentScope.pop();
          return;
        }

        // Arrow functions assigned to variables
        if (ts.isVariableDeclaration(node) && node.initializer &&
            (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
          const name = node.name.getText(sourceFile);
          const fn = node.initializer;
          functions.push({
            name,
            line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            parameters: fn.parameters.length,
            isMethod: false,
            isAsync: fn.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) || false,
            hasReturnType: !!fn.type,
            returnType: fn.type ? fn.type.getText(sourceFile) : null,
          });

          currentScope.push(name);
          const callTargets = this.collectCallsInNode(fn, sourceFile);
          if (callTargets.length > 0) {
            calls.push({ caller: name, callees: callTargets, line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
          }
          ts.forEachChild(node, visit);
          currentScope.pop();
          return;
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    } catch (e: any) {
      errors.push(e.message);
    }

    return { functions, calls, errors };
  }

  analyzeControlFlow(code: string): { functions: Array<{ name: string; line: number; hasReturnType: boolean; isAsync: boolean; cfgNodes: TSCFGNode[] }>; errors: string[] } {
    const functions: Array<{ name: string; line: number; hasReturnType: boolean; isAsync: boolean; cfgNodes: TSCFGNode[] }> = [];
    const errors: string[] = [];

    try {
      const sourceFile = ts.createSourceFile('temp.ts', code, ts.ScriptTarget.Latest, true);

      const visit = (node: ts.Node) => {
        if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) {
          const name = node.name.getText(sourceFile);
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          const cfgNodes: TSCFGNode[] = [];
          let blockCounter = 0;
          const allocBlock = (): string => `blk_${blockCounter++}`;

          const walkCFG = (n: ts.Node, blockId: string, parentBlockId: string | null, blockKind: string) => {
            const nLine = sourceFile.getLineAndCharacterOfPosition(n.getStart()).line + 1;
            const base = { blockId, parentBlockId, blockKind, isTerminator: false };

            if (ts.isIfStatement(n)) {
              cfgNodes.push({ type: 'conditional', line: nLine, condition: n.expression.getText(sourceFile).slice(0, 80), ...base });
              const trueBlk = allocBlock();
              ts.forEachChild(n.thenStatement, (child) => walkCFG(child, trueBlk, blockId, 'if_true'));
              if (n.elseStatement) {
                const falseBlk = allocBlock();
                ts.forEachChild(n.elseStatement, (child) => walkCFG(child, falseBlk, blockId, 'if_false'));
              }
              return;
            } else if (ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isForInStatement(n)) {
              cfgNodes.push({ type: 'loop', line: nLine, loopType: 'for', ...base });
              const bodyBlk = allocBlock();
              if (n.statement) {
                ts.forEachChild(n.statement, (child) => walkCFG(child, bodyBlk, blockId, 'for_body'));
              }
              return;
            } else if (ts.isWhileStatement(n) || ts.isDoStatement(n)) {
              cfgNodes.push({ type: 'loop', line: nLine, loopType: 'while', ...base });
              const bodyBlk = allocBlock();
              if (n.statement) {
                ts.forEachChild(n.statement, (child) => walkCFG(child, bodyBlk, blockId, 'while_body'));
              }
              return;
            } else if (ts.isReturnStatement(n)) {
              cfgNodes.push({ type: 'return', line: nLine, functionScope: name, blockId, parentBlockId, blockKind, isTerminator: true });
              return;
            } else if (ts.isTryStatement(n)) {
              cfgNodes.push({ type: 'try', line: nLine, ...base });
              const tryBlk = allocBlock();
              ts.forEachChild(n.tryBlock, (child) => walkCFG(child, tryBlk, blockId, 'try_body'));
              if (n.catchClause) {
                const catchBlk = allocBlock();
                if (n.catchClause.block) {
                  ts.forEachChild(n.catchClause.block, (child) => walkCFG(child, catchBlk, blockId, 'except_handler'));
                }
              }
              if (n.finallyBlock) {
                const finallyBlk = allocBlock();
                ts.forEachChild(n.finallyBlock, (child) => walkCFG(child, finallyBlk, blockId, 'finally'));
              }
              return;
            } else if (ts.isThrowStatement(n)) {
              cfgNodes.push({ type: 'throw', line: nLine, blockId, parentBlockId, blockKind, isTerminator: true });
              return;
            } else if (ts.isSwitchStatement(n)) {
              cfgNodes.push({ type: 'conditional', line: nLine, condition: 'switch', ...base });
              for (const clause of n.caseBlock.clauses) {
                const caseBlk = allocBlock();
                for (const stmt of clause.statements) {
                  walkCFG(stmt, caseBlk, blockId, 'case_body');
                }
              }
              return;
            } else if (ts.isBreakStatement(n)) {
              cfgNodes.push({ type: 'break', line: nLine, functionScope: name, blockId, parentBlockId, blockKind, isTerminator: true });
              return;
            } else if (ts.isContinueStatement(n)) {
              cfgNodes.push({ type: 'continue', line: nLine, functionScope: name, blockId, parentBlockId, blockKind, isTerminator: true });
              return;
            }

            // For blocks and other container nodes, recurse into children
            if (ts.isBlock(n)) {
              ts.forEachChild(n, (child) => walkCFG(child, blockId, parentBlockId, blockKind));
              return;
            }

            // Generic statements (expression statements, variable declarations, etc.)
            if (ts.isExpressionStatement(n) || ts.isVariableStatement(n)) {
              cfgNodes.push({ type: 'statement', line: nLine, functionScope: name, ...base });
              return;
            }

            ts.forEachChild(n, (child) => walkCFG(child, blockId, parentBlockId, blockKind));
          };

          if (node.body) {
            const rootBlock = allocBlock();
            ts.forEachChild(node.body, (child) => walkCFG(child, rootBlock, null, 'function_body'));
          }

          functions.push({
            name,
            line,
            hasReturnType: !!(node as ts.FunctionDeclaration).type && !this.isVoidLikeType((node as ts.FunctionDeclaration).type!, sourceFile),
            isAsync: node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) || false,
            cfgNodes,
          });
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    } catch (e: any) {
      errors.push(e.message);
    }

    return { functions, errors };
  }

  analyzeSchemas(code: string): { schemas: Array<{ name: string; type: 'interface' | 'type-alias' | 'zod' | 'class'; fields: Array<{ name: string; dataType: string; line: number }>; line: number; bases: string[] }>; errors: string[] } {
    const schemas: Array<{ name: string; type: 'interface' | 'type-alias' | 'zod' | 'class'; fields: Array<{ name: string; dataType: string; line: number }>; line: number; bases: string[] }> = [];
    const errors: string[] = [];

    try {
      const sourceFile = ts.createSourceFile('temp.ts', code, ts.ScriptTarget.Latest, true);

      const visit = (node: ts.Node) => {
        // Interface declarations
        if (ts.isInterfaceDeclaration(node)) {
          const name = node.name.text;
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          const bases: string[] = [];

          if (node.heritageClauses) {
            for (const clause of node.heritageClauses) {
              for (const type of clause.types) {
                bases.push(type.expression.getText(sourceFile));
              }
            }
          }

          const fields: Array<{ name: string; dataType: string; line: number }> = [];
          for (const member of node.members) {
            if (ts.isPropertySignature(member) && member.name) {
              const fieldName = member.name.getText(sourceFile);
              const dataType = member.type ? member.type.getText(sourceFile) : 'any';
              const fieldLine = sourceFile.getLineAndCharacterOfPosition(member.getStart()).line + 1;
              fields.push({ name: fieldName, dataType, line: fieldLine });
            }
          }

          schemas.push({ name, type: 'interface', fields, line, bases });
        }

        // Type alias declarations with object literal types
        if (ts.isTypeAliasDeclaration(node)) {
          const name = node.name.text;
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          const fields: Array<{ name: string; dataType: string; line: number }> = [];

          if (ts.isTypeLiteralNode(node.type)) {
            for (const member of node.type.members) {
              if (ts.isPropertySignature(member) && member.name) {
                const fieldName = member.name.getText(sourceFile);
                const dataType = member.type ? member.type.getText(sourceFile) : 'any';
                const fieldLine = sourceFile.getLineAndCharacterOfPosition(member.getStart()).line + 1;
                fields.push({ name: fieldName, dataType, line: fieldLine });
              }
            }
          }

          if (fields.length > 0) {
            schemas.push({ name, type: 'type-alias', fields, line, bases: [] });
          }
        }

        // Class declarations with typed properties
        if (ts.isClassDeclaration(node) && node.name) {
          const name = node.name.text;
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          const bases: string[] = [];

          if (node.heritageClauses) {
            for (const clause of node.heritageClauses) {
              for (const type of clause.types) {
                bases.push(type.expression.getText(sourceFile));
              }
            }
          }

          const fields: Array<{ name: string; dataType: string; line: number }> = [];
          for (const member of node.members) {
            if (ts.isPropertyDeclaration(member) && member.name) {
              const fieldName = member.name.getText(sourceFile);
              const dataType = member.type ? member.type.getText(sourceFile) : 'any';
              const fieldLine = sourceFile.getLineAndCharacterOfPosition(member.getStart()).line + 1;
              fields.push({ name: fieldName, dataType, line: fieldLine });
            }
          }

          if (fields.length > 0) {
            schemas.push({ name, type: 'class', fields, line, bases });
          }
        }

        // Zod schemas: const X = z.object({...})
        if (ts.isVariableStatement(node)) {
          for (const decl of node.declarationList.declarations) {
            if (ts.isVariableDeclaration(decl) && decl.name && ts.isIdentifier(decl.name) && decl.initializer) {
              // Check if initializer is z.object(...)
              if (ts.isCallExpression(decl.initializer) &&
                  ts.isPropertyAccessExpression(decl.initializer.expression)) {
                const obj = decl.initializer.expression;
                const methodName = obj.name.text;
                const objName = ts.isIdentifier(obj.expression) ? obj.expression.text : '';

                if (objName === 'z' && methodName === 'object' && decl.initializer.arguments.length > 0) {
                  const name = decl.name.text;
                  const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
                  const fields: Array<{ name: string; dataType: string; line: number }> = [];

                  const arg = decl.initializer.arguments[0]!;
                  if (ts.isObjectLiteralExpression(arg)) {
                    for (const prop of arg.properties) {
                      if (ts.isPropertyAssignment(prop) && prop.name) {
                        const fieldName = prop.name.getText(sourceFile);
                        // Extract zod type as string (e.g., "z.string()")
                        const dataType = prop.initializer.getText(sourceFile);
                        const fieldLine = sourceFile.getLineAndCharacterOfPosition(prop.getStart()).line + 1;
                        fields.push({ name: fieldName, dataType, line: fieldLine });
                      }
                    }
                  }

                  schemas.push({ name, type: 'zod', fields, line, bases: [] });
                }
              }
            }
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    } catch (e: any) {
      errors.push(e.message);
    }

    return { schemas, errors };
  }

  analyzeResources(code: string): { resources: TSResourceRef[]; errors: string[] } {
    const resources: TSResourceRef[] = [];
    const errors: string[] = [];

    try {
      const sourceFile = ts.createSourceFile('temp.ts', code, ts.ScriptTarget.Latest, true);

      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

          // fs.readFileSync("path"), fs.readFile("path", ...), fs.existsSync("path"), etc.
          if (ts.isPropertyAccessExpression(node.expression)) {
            const obj = node.expression;
            const method = obj.name.text;
            const objName = ts.isIdentifier(obj.expression) ? obj.expression.text : '';

            // fs module calls with string literal first argument
            const fsMethods = ['readFileSync', 'readFile', 'writeFileSync', 'writeFile',
              'existsSync', 'accessSync', 'statSync', 'unlinkSync', 'readdirSync',
              'createReadStream', 'createWriteStream'];
            if (fsMethods.includes(method) && node.arguments.length > 0) {
              const pathArg = this.extractStringLiteral(node.arguments[0]!, sourceFile);
              if (pathArg !== null) {
                resources.push({ type: 'fs', referencedPath: pathArg, line, callExpression: `${objName}.${method}` });
              }
            }

            // path.join(...), path.resolve(...)
            if (objName === 'path' && (method === 'join' || method === 'resolve') && node.arguments.length > 0) {
              const parts: string[] = [];
              for (const arg of node.arguments) {
                const s = this.extractStringLiteral(arg, sourceFile);
                if (s !== null) parts.push(s);
              }
              if (parts.length > 0) {
                resources.push({ type: 'path-join', referencedPath: parts.join('/'), line, callExpression: `path.${method}` });
              }
            }
          }

          // require.resolve("path")
          if (ts.isPropertyAccessExpression(node.expression) &&
              ts.isIdentifier(node.expression.expression) &&
              node.expression.expression.text === 'require' &&
              node.expression.name.text === 'resolve' &&
              node.arguments.length > 0) {
            const pathArg = this.extractStringLiteral(node.arguments[0]!, sourceFile);
            if (pathArg !== null) {
              resources.push({ type: 'require-resolve', referencedPath: pathArg, line, callExpression: 'require.resolve' });
            }
          }
        }

        // Template literals containing path-like patterns (e.g., `./templates/${name}.html`)
        if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          const text = node.getText(sourceFile);
          // Check for path-like template literals
          if (/[./\\].*\.(html|json|yaml|yml|css|ejs|hbs|pug|txt|md|xml|svg|png|jpg|jpeg|gif|ico)/.test(text)) {
            resources.push({ type: 'template', referencedPath: text, line, callExpression: 'template-literal' });
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    } catch (e: any) {
      errors.push(e.message);
    }

    return { resources, errors };
  }

  analyzeRouting(code: string): { routes: TSRouteInfo[]; middleware: TSMiddlewareInfo[]; errors: string[] } {
    const routes: TSRouteInfo[] = [];
    const middleware: TSMiddlewareInfo[] = [];
    const errors: string[] = [];

    try {
      const sourceFile = ts.createSourceFile('temp.ts', code, ts.ScriptTarget.Latest, true);

      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const method = node.expression.name.text;
          const objName = ts.isIdentifier(node.expression.expression)
            ? node.expression.expression.text : '';
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

          const httpMethods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'all'];
          const routerObjects = ['app', 'router', 'server', 'route', 'api', ''];

          // Express/Koa route handlers: app.get("/path", handler) or router.post("/path", ...)
          if (httpMethods.includes(method) && routerObjects.includes(objName) && node.arguments.length >= 2) {
            const pathArg = this.extractStringLiteral(node.arguments[0]!, sourceFile);
            if (pathArg !== null) {
              const guards: string[] = [];
              let handlerName = '<anonymous>';

              // Scan middleware arguments (all args between path and final handler)
              for (let i = 1; i < node.arguments.length; i++) {
                const arg = node.arguments[i]!;
                if (ts.isIdentifier(arg)) {
                  if (i < node.arguments.length - 1) {
                    // Middleware/guard argument
                    guards.push(arg.text);
                  } else {
                    handlerName = arg.text;
                  }
                } else if (ts.isCallExpression(arg) && ts.isIdentifier(arg.expression)) {
                  // e.g., authenticate(), requireRole('admin')
                  guards.push(arg.expression.text);
                }
              }

              const authPatterns = ['auth', 'authenticate', 'requireAuth', 'isAuthenticated',
                'passport', 'verify', 'protect', 'requireLogin', 'ensureAuth',
                'requireRole', 'checkAuth', 'verifyToken', 'isLoggedIn'];
              const hasAuth = guards.some(g =>
                authPatterns.some(p => g.toLowerCase().includes(p.toLowerCase())));

              routes.push({ path: pathArg, method: method.toUpperCase(), line, handlerName, guards, hasAuth });
            }
          }

          // app.use() or router.use() — middleware registration
          if (method === 'use' && node.arguments.length >= 1) {
            let mwPath: string | undefined;
            let mwName = '<anonymous>';
            let startArgIdx = 0;

            // First arg might be a path string
            if (node.arguments.length >= 1) {
              const firstArg = node.arguments[0]!;
              const pathStr = this.extractStringLiteral(firstArg, sourceFile);
              if (pathStr !== null) {
                mwPath = pathStr;
                startArgIdx = 1;
              }
            }

            // Remaining args are middleware functions
            for (let i = startArgIdx; i < node.arguments.length; i++) {
              const arg = node.arguments[i]!;
              if (ts.isIdentifier(arg)) {
                mwName = arg.text;
              } else if (ts.isCallExpression(arg) && ts.isIdentifier(arg.expression)) {
                mwName = arg.expression.text;
              }

              // Detect error handlers (4-param functions)
              let isErrorHandler = false;
              if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) {
                isErrorHandler = arg.parameters.length === 4;
                mwName = '<error-handler>';
              }

              middleware.push({
                name: mwName,
                line,
                path: mwPath,
                type: isErrorHandler ? 'error-handler' : 'middleware',
              });
            }
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);
    } catch (e: any) {
      errors.push(e.message);
    }

    return { routes, middleware, errors };
  }

  private extractStringLiteral(node: ts.Node, _sourceFile: ts.SourceFile): string | null {
    if (ts.isStringLiteral(node)) {
      return node.text;
    }
    if (ts.isNoSubstitutionTemplateLiteral(node)) {
      return node.text;
    }
    return null;
  }

  private extractFunctionInfo(node: ts.FunctionDeclaration, sourceFile: ts.SourceFile, isMethod: boolean): TSFunctionInfo {
    return {
      name: node.name?.text || '<anonymous>',
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      parameters: node.parameters.length,
      isMethod,
      isAsync: node.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) || false,
      hasReturnType: !!node.type,
      returnType: node.type ? node.type.getText(sourceFile) : null,
    };
  }

  private collectCallsInNode(node: ts.Node, _sourceFile: ts.SourceFile): string[] {
    const targets = new Set<string>();

    const walk = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        if (ts.isIdentifier(n.expression)) {
          targets.add(n.expression.text);
        } else if (ts.isPropertyAccessExpression(n.expression)) {
          targets.add(n.expression.name.text);
        }
      }
      ts.forEachChild(n, walk);
    };

    ts.forEachChild(node, walk);
    return Array.from(targets);
  }

  private isVoidLikeType(typeNode: ts.TypeNode, sourceFile: ts.SourceFile): boolean {
    // Direct void keyword
    if (typeNode.kind === ts.SyntaxKind.VoidKeyword) return true;
    // Promise<void>
    if (ts.isTypeReferenceNode(typeNode)) {
      const typeName = typeNode.typeName.getText(sourceFile);
      if (typeName === 'Promise' && typeNode.typeArguments && typeNode.typeArguments.length === 1) {
        return this.isVoidLikeType(typeNode.typeArguments[0]!, sourceFile);
      }
    }
    // Union types containing void (e.g., void | undefined)
    if (ts.isUnionTypeNode(typeNode)) {
      return typeNode.types.every(t =>
        t.kind === ts.SyntaxKind.VoidKeyword ||
        t.kind === ts.SyntaxKind.UndefinedKeyword ||
        t.kind === ts.SyntaxKind.NeverKeyword
      );
    }
    return false;
  }

  private findParentClassName(node: ts.Node, _sourceFile: ts.SourceFile): string | null {
    let parent = node.parent;
    while (parent) {
      if (ts.isClassDeclaration(parent) && parent.name) {
        return parent.name.text;
      }
      parent = parent.parent;
    }
    return null;
  }
}
