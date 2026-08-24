import { dirname, resolve } from "node:path";

import ts from "typescript";

export type TransactionSourceFile = {
  file: string;
  sourceText: string;
};

export type TransactionConcurrencyViolation = {
  file: string;
  line: number;
  combinator: string;
  transactionClient: string;
};

const concurrentPromiseCombinators = new Set(["all", "allSettled", "any", "race"]);

function normalizedFileName(file: string) {
  const normalized = resolve(file).replaceAll("\\", "/");
  return ts.sys.useCaseSensitiveFileNames ? normalized : normalized.toLowerCase();
}

function unwrappedExpression(expression: ts.Expression): ts.Expression {
  let current = expression;

  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

function functionWithBody(
  declaration: ts.Node | undefined,
): declaration is ts.FunctionLikeDeclaration & { body: ts.ConciseBody } {
  return Boolean(
    declaration
    && ts.isFunctionLike(declaration)
    && "body" in declaration
    && declaration.body,
  );
}

export function transactionConcurrencyViolations(
  sourceFiles: readonly TransactionSourceFile[],
): TransactionConcurrencyViolation[] {
  const compilerOptions: ts.CompilerOptions = {
    baseUrl: process.cwd(),
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noLib: true,
    paths: { "@/*": ["src/*"] },
    skipLibCheck: true,
    target: ts.ScriptTarget.Latest,
    types: [],
  };
  const sourceByFile = new Map(
    sourceFiles.map(({ file, sourceText }) => [normalizedFileName(file), sourceText]),
  );
  const displayFileByFile = new Map(
    sourceFiles.map(({ file }) => [normalizedFileName(file), file.replaceAll("\\", "/")]),
  );
  const host = ts.createCompilerHost(compilerOptions, true);
  const defaultFileExists = host.fileExists.bind(host);
  const defaultDirectoryExists = host.directoryExists?.bind(host);
  const defaultReadFile = host.readFile.bind(host);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  const virtualDirectories = new Set<string>();
  for (const file of sourceByFile.keys()) {
    let directory = dirname(file);
    while (!virtualDirectories.has(directory)) {
      virtualDirectories.add(directory);
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }

  host.fileExists = (file) => sourceByFile.has(normalizedFileName(file)) || defaultFileExists(file);
  host.directoryExists = (directory) =>
    virtualDirectories.has(normalizedFileName(directory))
    || Boolean(defaultDirectoryExists?.(directory));
  host.readFile = (file) => sourceByFile.get(normalizedFileName(file)) ?? defaultReadFile(file);
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => {
    const sourceText = sourceByFile.get(normalizedFileName(file));
    return sourceText === undefined
      ? defaultGetSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(file, sourceText, languageVersion, true);
  };

  const program = ts.createProgram({
    rootNames: [...sourceByFile.keys()],
    options: compilerOptions,
    host,
  });
  const checker = program.getTypeChecker();
  const violations = new Map<string, TransactionConcurrencyViolation>();
  const analyzedFunctions = new Set<string>();
  const transactionOperationChecks = new Map<string, boolean>();

  function sourceIsInScope(node: ts.Node) {
    return sourceByFile.has(normalizedFileName(node.getSourceFile().fileName));
  }

  function symbolAt(node: ts.Node) {
    return checker.getSymbolAtLocation(node);
  }

  function addBindingSymbols(name: ts.BindingName, symbols: Set<ts.Symbol>) {
    if (ts.isIdentifier(name)) {
      const symbol = symbolAt(name);
      if (symbol) symbols.add(symbol);
      return;
    }

    for (const element of name.elements) {
      if (!ts.isOmittedExpression(element)) addBindingSymbols(element.name, symbols);
    }
  }

  function variableInitializer(symbol: ts.Symbol): ts.Expression | undefined {
    for (const declaration of symbol.declarations ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        return declaration.initializer;
      }
      if (ts.isBindingElement(declaration)) {
        const variableDeclaration = declaration.parent.parent;
        if (ts.isVariableDeclaration(variableDeclaration) && variableDeclaration.initializer) {
          return variableDeclaration.initializer;
        }
      }
    }
    return undefined;
  }

  function expressionIsTransactionValue(
    rawExpression: ts.Expression,
    transactionSymbols: ReadonlySet<ts.Symbol>,
    seenSymbols = new Set<ts.Symbol>(),
  ): boolean {
    const expression = unwrappedExpression(rawExpression);

    if (ts.isIdentifier(expression)) {
      const symbol = symbolAt(expression);
      return Boolean(symbol && transactionSymbols.has(symbol));
    }

    if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
      return expressionIsTransactionValue(expression.expression, transactionSymbols, seenSymbols);
    }
    if (ts.isConditionalExpression(expression)) {
      return expressionIsTransactionValue(expression.whenTrue, transactionSymbols, seenSymbols)
        || expressionIsTransactionValue(expression.whenFalse, transactionSymbols, seenSymbols);
    }
    if (ts.isBinaryExpression(expression)) {
      if (expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
        return expressionIsTransactionValue(expression.right, transactionSymbols, seenSymbols);
      }
      if (
        expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
        || expression.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      ) {
        return expressionIsTransactionValue(expression.left, transactionSymbols, seenSymbols)
          || expressionIsTransactionValue(expression.right, transactionSymbols, seenSymbols);
      }
    }
    if (ts.isAwaitExpression(expression)) {
      return expressionIsTransactionValue(expression.expression, transactionSymbols, seenSymbols);
    }

    return false;
  }

  function collectTransactionAliases(
    body: ts.ConciseBody,
    initialSymbols: ReadonlySet<ts.Symbol>,
    beforePosition = Number.POSITIVE_INFINITY,
  ) {
    const aliases = new Set(initialSymbols);
    const writes: Array<{
      name: ts.BindingName;
      position: number;
      value?: ts.Expression;
      definite: boolean;
    }> = [];

    function writeIsUnconditional(node: ts.Node) {
      if (node === body) return true;
      let current = node.parent;
      while (current && current !== body) {
        if (
          ts.isIfStatement(current)
          || ts.isConditionalExpression(current)
          || ts.isSwitchStatement(current)
          || ts.isCaseClause(current)
          || ts.isDefaultClause(current)
          || ts.isForStatement(current)
          || ts.isForInStatement(current)
          || ts.isForOfStatement(current)
          || ts.isWhileStatement(current)
          || ts.isDoStatement(current)
          || ts.isTryStatement(current)
          || ts.isCatchClause(current)
          || ts.isWithStatement(current)
          || (ts.isCallExpression(current) && Boolean(current.questionDotToken))
          || ((ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current))
            && Boolean(current.questionDotToken))
          || (ts.isBinaryExpression(current)
            && [
              ts.SyntaxKind.AmpersandAmpersandToken,
              ts.SyntaxKind.BarBarToken,
              ts.SyntaxKind.QuestionQuestionToken,
            ].includes(current.operatorToken.kind))
        ) {
          return false;
        }
        current = current.parent;
      }
      return current === body;
    }

    function collectWrites(node: ts.Node) {
      if (node !== body && ts.isFunctionLike(node)) return;
      if (node.getStart() >= beforePosition) return;
      if (ts.isVariableDeclaration(node)) {
        writes.push({
          name: node.name,
          position: node.getStart(),
          value: node.initializer,
          definite: writeIsUnconditional(node),
        });
      }
      if (
        ts.isBinaryExpression(node)
        && [
          ts.SyntaxKind.EqualsToken,
          ts.SyntaxKind.QuestionQuestionEqualsToken,
          ts.SyntaxKind.BarBarEqualsToken,
          ts.SyntaxKind.AmpersandAmpersandEqualsToken,
        ].includes(node.operatorToken.kind)
      ) {
        const left = unwrappedExpression(node.left as ts.Expression);
        if (ts.isIdentifier(left)) {
          writes.push({
            name: left,
            position: node.getStart(),
            value: node.right,
            definite: node.operatorToken.kind === ts.SyntaxKind.EqualsToken
              && writeIsUnconditional(node),
          });
        }
      }
      ts.forEachChild(node, collectWrites);
    }

    collectWrites(body);
    writes.sort((left, right) => left.position - right.position);
    for (const write of writes) {
      const writtenSymbols = new Set<ts.Symbol>();
      addBindingSymbols(write.name, writtenSymbols);
      const transactionValue = Boolean(
        write.value && expressionIsTransactionValue(write.value, aliases),
      );
      for (const symbol of writtenSymbols) {
        if (transactionValue) aliases.add(symbol);
        else if (write.definite) aliases.delete(symbol);
      }
    }

    return aliases;
  }

  function isGlobalReference(
    rawExpression: ts.Expression,
    globalName: string,
    seenSymbols = new Set<ts.Symbol>(),
  ): boolean {
    const expression = unwrappedExpression(rawExpression);
    if (!ts.isIdentifier(expression)) return false;

    const symbol = symbolAt(expression);
    if (expression.text === globalName && !symbol) return true;
    if (!symbol || seenSymbols.has(symbol)) return false;
    seenSymbols.add(symbol);
    const initializer = variableInitializer(symbol);
    return Boolean(initializer && isGlobalReference(initializer, globalName, seenSymbols));
  }

  function isGlobalPromiseReference(
    expression: ts.Expression,
    seenSymbols = new Set<ts.Symbol>(),
  ) {
    return isGlobalReference(expression, "Promise", seenSymbols);
  }

  function propertyName(expression: ts.Expression): string | undefined {
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
    if (
      ts.isElementAccessExpression(expression)
      && expression.argumentExpression
      && (ts.isStringLiteral(expression.argumentExpression)
        || ts.isNoSubstitutionTemplateLiteral(expression.argumentExpression))
    ) {
      return expression.argumentExpression.text;
    }
    return undefined;
  }

  function propertyOwner(expression: ts.Expression): ts.Expression | undefined {
    return ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)
      ? expression.expression
      : undefined;
  }

  function promiseCombinator(
    rawExpression: ts.Expression,
    seenSymbols = new Set<ts.Symbol>(),
  ): string | undefined {
    const expression = unwrappedExpression(rawExpression);
    const name = propertyName(expression);
    const owner = propertyOwner(expression);
    if (name && owner && concurrentPromiseCombinators.has(name) && isGlobalPromiseReference(owner)) {
      return name;
    }

    if (
      ts.isCallExpression(expression)
      && propertyName(expression.expression) === "bind"
    ) {
      const boundMethod = propertyOwner(expression.expression);
      if (boundMethod) return promiseCombinator(boundMethod, seenSymbols);
    }

    if (!ts.isIdentifier(expression)) return undefined;
    const symbol = symbolAt(expression);
    if (!symbol || seenSymbols.has(symbol)) return undefined;
    seenSymbols.add(symbol);

    for (const declaration of symbol.declarations ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        const result = promiseCombinator(declaration.initializer, seenSymbols);
        if (result) return result;
      }
      if (ts.isBindingElement(declaration)) {
        const variableDeclaration = declaration.parent.parent;
        const initializer = ts.isVariableDeclaration(variableDeclaration)
          ? variableDeclaration.initializer
          : undefined;
        const bindingName = declaration.propertyName ?? declaration.name;
        if (
          initializer
          && ts.isIdentifier(bindingName)
          && concurrentPromiseCombinators.has(bindingName.text)
          && isGlobalPromiseReference(initializer)
        ) {
          return bindingName.text;
        }
      }
    }
    return undefined;
  }

  function prismaLikeReference(
    rawExpression: ts.Expression,
    seenSymbols = new Set<ts.Symbol>(),
  ): boolean {
    const expression = unwrappedExpression(rawExpression);
    if (ts.isIdentifier(expression) && /^prisma(?:Client)?$/i.test(expression.text)) return true;
    if (
      ts.isNewExpression(expression)
      && ts.isIdentifier(expression.expression)
      && /PrismaClient/.test(expression.expression.text)
    ) {
      return true;
    }

    const typeName = checker.typeToString(checker.getTypeAtLocation(expression));
    if (/PrismaClient/.test(typeName)) return true;

    if (!ts.isIdentifier(expression)) return false;
    const symbol = symbolAt(expression);
    if (!symbol || seenSymbols.has(symbol)) return false;
    seenSymbols.add(symbol);
    for (const declaration of symbol.declarations ?? []) {
      if (ts.isImportSpecifier(declaration)) {
        const importDeclaration = declaration.parent.parent.parent;
        if (
          ts.isImportDeclaration(importDeclaration)
          && ts.isStringLiteral(importDeclaration.moduleSpecifier)
          && /prisma/i.test(importDeclaration.moduleSpecifier.text)
        ) {
          return true;
        }
      }
    }
    const initializer = variableInitializer(symbol);
    return Boolean(initializer && prismaLikeReference(initializer, seenSymbols));
  }

  function transactionMethodReference(
    rawExpression: ts.Expression,
    seenSymbols = new Set<ts.Symbol>(),
  ): boolean {
    const expression = unwrappedExpression(rawExpression);
    if (propertyName(expression) === "$transaction") {
      const owner = propertyOwner(expression);
      return Boolean(owner && prismaLikeReference(owner));
    }

    if (
      ts.isCallExpression(expression)
      && propertyName(expression.expression) === "bind"
    ) {
      const owner = propertyOwner(expression.expression);
      return Boolean(owner && transactionMethodReference(owner, seenSymbols));
    }

    if (!ts.isIdentifier(expression)) return false;
    const symbol = symbolAt(expression);
    if (!symbol || seenSymbols.has(symbol)) return false;
    seenSymbols.add(symbol);

    for (const declaration of symbol.declarations ?? []) {
      if (!ts.isBindingElement(declaration)) continue;
      const bindingName = declaration.propertyName ?? declaration.name;
      const variableDeclaration = declaration.parent.parent;
      if (
        ts.isIdentifier(bindingName)
        && bindingName.text === "$transaction"
        && ts.isVariableDeclaration(variableDeclaration)
        && variableDeclaration.initializer
        && prismaLikeReference(variableDeclaration.initializer)
      ) {
        return true;
      }
    }
    const initializer = variableInitializer(symbol);
    return Boolean(initializer && transactionMethodReference(initializer, seenSymbols));
  }

  function callableFunctions(rawExpression: ts.Expression) {
    const declarations = new Set<ts.FunctionLikeDeclaration & { body: ts.ConciseBody }>();
    const expression = unwrappedExpression(rawExpression);
    if ((ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) && expression.body) {
      declarations.add(expression);
    }

    for (const signature of checker.getTypeAtLocation(expression).getCallSignatures()) {
      if (functionWithBody(signature.declaration) && sourceIsInScope(signature.declaration)) {
        declarations.add(signature.declaration);
      }
    }

    return declarations;
  }

  function calledFunctions(call: ts.CallExpression) {
    const declarations = callableFunctions(call.expression);
    const signatureDeclaration = checker.getResolvedSignature(call)?.declaration;
    if (functionWithBody(signatureDeclaration) && sourceIsInScope(signatureDeclaration)) {
      declarations.add(signatureDeclaration);
    }
    return declarations;
  }

  function initializedExpression(
    rawExpression: ts.Expression,
    seenSymbols = new Set<ts.Symbol>(),
  ): ts.Expression {
    const expression = unwrappedExpression(rawExpression);
    if (!ts.isIdentifier(expression)) return expression;
    const symbol = symbolAt(expression);
    if (!symbol || seenSymbols.has(symbol)) return expression;
    seenSymbols.add(symbol);
    const initializer = variableInitializer(symbol);
    return initializer ? initializedExpression(initializer, seenSymbols) : expression;
  }

  function objectPropertyExpression(
    object: ts.ObjectLiteralExpression,
    name: string,
  ): ts.Expression | undefined {
    for (const property of object.properties) {
      if (ts.isShorthandPropertyAssignment(property) && property.name.text === name) {
        return property.name;
      }
      if (
        ts.isPropertyAssignment(property)
        && ((ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
          && property.name.text === name)
      ) {
        return property.initializer;
      }
      if (ts.isSpreadAssignment(property)) {
        const spread = initializedExpression(property.expression);
        if (ts.isObjectLiteralExpression(spread)) {
          const result = objectPropertyExpression(spread, name);
          if (result) return result;
        }
      }
    }
    return undefined;
  }

  function addTaintedParameterBindings(
    name: ts.BindingName,
    rawArgument: ts.Expression,
    transactionSymbols: ReadonlySet<ts.Symbol>,
    symbols: Set<ts.Symbol>,
  ) {
    if (ts.isIdentifier(name)) {
      if (expressionIsTransactionValue(rawArgument, transactionSymbols)) {
        const symbol = symbolAt(name);
        if (symbol) symbols.add(symbol);
      }
      return;
    }

    if (expressionIsTransactionValue(rawArgument, transactionSymbols)) {
      addBindingSymbols(name, symbols);
      return;
    }

    const argument = initializedExpression(rawArgument);
    if (ts.isObjectBindingPattern(name) && ts.isObjectLiteralExpression(argument)) {
      for (const element of name.elements) {
        const property = element.propertyName ?? element.name;
        if (!ts.isIdentifier(property) && !ts.isStringLiteral(property)) continue;
        const value = objectPropertyExpression(argument, property.text);
        if (value) {
          addTaintedParameterBindings(element.name, value, transactionSymbols, symbols);
        }
      }
      return;
    }

    if (ts.isArrayBindingPattern(name) && ts.isArrayLiteralExpression(argument)) {
      name.elements.forEach((element, index) => {
        if (ts.isOmittedExpression(element)) return;
        const value = argument.elements[index];
        if (value && !ts.isSpreadElement(value)) {
          addTaintedParameterBindings(element.name, value, transactionSymbols, symbols);
        }
      });
    }
  }

  function taintedParametersForCall(
    call: ts.CallExpression,
    declaration: ts.FunctionLikeDeclaration,
    transactionSymbols: ReadonlySet<ts.Symbol>,
  ) {
    const symbols = new Set<ts.Symbol>();
    declaration.parameters.forEach((parameter, index) => {
      const argument = call.arguments[index];
      if (!argument) return;
      addTaintedParameterBindings(parameter.name, argument, transactionSymbols, symbols);
    });
    return symbols;
  }

  function transactionSymbolsForCall(
    call: ts.CallExpression,
    declaration: ts.FunctionLikeDeclaration,
    transactionSymbols: ReadonlySet<ts.Symbol>,
  ) {
    const symbols = taintedParametersForCall(call, declaration, transactionSymbols);
    for (const symbol of transactionSymbols) symbols.add(symbol);
    return symbols;
  }

  function functionKey(
    declaration: ts.FunctionLikeDeclaration,
    transactionSymbols: ReadonlySet<ts.Symbol>,
  ) {
    const symbolKeys = [...transactionSymbols].map((symbol) => {
      const symbolDeclaration = symbol.declarations?.[0];
      return symbolDeclaration
        ? `${normalizedFileName(symbolDeclaration.getSourceFile().fileName)}:${symbolDeclaration.pos}`
        : symbol.getName();
    }).sort();
    return `${normalizedFileName(declaration.getSourceFile().fileName)}:${declaration.pos}:${symbolKeys.join(",")}`;
  }

  function functionHasTransactionOperation(
    declaration: ts.FunctionLikeDeclaration & { body: ts.ConciseBody },
    initialSymbols: ReadonlySet<ts.Symbol>,
    activeChecks = new Set<string>(),
  ): boolean {
    const key = functionKey(declaration, initialSymbols);
    const cached = transactionOperationChecks.get(key);
    if (cached !== undefined) return cached;
    if (activeChecks.has(key)) return false;
    activeChecks.add(key);
    let found = false;

    function visit(node: ts.Node) {
      if (found || (node !== declaration.body && ts.isFunctionLike(node))) return;
      if (ts.isCallExpression(node)) {
        const transactionSymbols = collectTransactionAliases(
          declaration.body,
          initialSymbols,
          node.getStart(),
        );
        if (expressionIsTransactionValue(node.expression, transactionSymbols)) {
          found = true;
          return;
        }
        const receiver = propertyOwner(node.expression);
        if (receiver && expressionIsTransactionValue(receiver, transactionSymbols)) {
          found = true;
          return;
        }

        const callees = calledFunctions(node);
        for (const callee of callees) {
          const symbols = transactionSymbolsForCall(node, callee, transactionSymbols);
          if (
            symbols.size > 0
            && functionHasTransactionOperation(callee, symbols, activeChecks)
          ) {
            found = true;
            return;
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(declaration.body);
    activeChecks.delete(key);
    transactionOperationChecks.set(key, found);
    return found;
  }

  function expressionHasTransactionWork(
    expression: ts.Expression,
    transactionSymbols: ReadonlySet<ts.Symbol>,
    seenSymbols = new Set<ts.Symbol>(),
    seenOperations = new Set<string>(),
  ): boolean {
    let found = false;

    function markOperation(node: ts.CallExpression) {
      const key = `${normalizedFileName(node.getSourceFile().fileName)}:${node.pos}`;
      if (seenOperations.has(key)) return false;
      seenOperations.add(key);
      return true;
    }

    function visit(node: ts.Node) {
      if (found || (node !== expression && ts.isFunctionLike(node))) return;
      if (ts.isIdentifier(node)) {
        const symbol = symbolAt(node);
        if (symbol && !transactionSymbols.has(symbol) && !seenSymbols.has(symbol)) {
          const initializer = variableInitializer(symbol);
          if (initializer && !containsAwait(initializer)) {
            seenSymbols.add(symbol);
            if (
              expressionHasTransactionWork(
                initializer,
                transactionSymbols,
                seenSymbols,
                seenOperations,
              )
            ) {
              found = true;
              return;
            }
          }
        }
      }
      if (ts.isCallExpression(node)) {
        if (expressionIsTransactionValue(node.expression, transactionSymbols)) {
          found = markOperation(node);
          if (found) return;
        }
        const receiver = propertyOwner(node.expression);
        if (receiver && expressionIsTransactionValue(receiver, transactionSymbols)) {
          found = markOperation(node);
          if (found) return;
        }

        const taintedCallees = [...calledFunctions(node)].flatMap((callee) => {
          const symbols = transactionSymbolsForCall(node, callee, transactionSymbols);
          return [{ callee, symbols }];
        });
        if (
          taintedCallees.some(({ callee, symbols }) =>
            functionHasTransactionOperation(callee, symbols))
        ) {
          found = markOperation(node);
          if (found) return;
        }

        const hasTransactionArgument = node.arguments.some((argument) =>
          expressionIsTransactionValue(argument, transactionSymbols));
        const promiseMethod = propertyName(node.expression);
        const promiseOwner = propertyOwner(node.expression);
        const isSafePromiseWrapper = Boolean(
          promiseMethod
          && promiseOwner
          && ["resolve", "reject"].includes(promiseMethod)
          && isGlobalPromiseReference(promiseOwner),
        );
        if (hasTransactionArgument && taintedCallees.length === 0 && !isSafePromiseWrapper) {
          found = markOperation(node);
          if (found) return;
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(expression);
    return found;
  }

  function concurrentTransactionWorkCount(
    expression: ts.Expression,
    transactionSymbols: ReadonlySet<ts.Symbol>,
    seenSymbols = new Set<ts.Symbol>(),
    seenOperations = new Set<string>(),
  ): number {
    const candidate = unwrappedExpression(expression);
    if (ts.isArrayLiteralExpression(candidate)) {
      return candidate.elements.reduce((count, element) => {
        if (count >= 2) return count;
        if (ts.isSpreadElement(element)) {
          return count + concurrentTransactionWorkCount(
            element.expression,
            transactionSymbols,
            seenSymbols,
            seenOperations,
          );
        }
        return count + (
          expressionHasTransactionWork(
            element,
            transactionSymbols,
            new Set<ts.Symbol>(),
            seenOperations,
          )
            ? 1
            : 0
        );
      }, 0);
    }

    if (ts.isObjectLiteralExpression(candidate)) {
      return candidate.properties.reduce((count, property) => {
        if (count >= 2) return count;
        if (ts.isSpreadAssignment(property)) {
          return count + concurrentTransactionWorkCount(
            property.expression,
            transactionSymbols,
            seenSymbols,
            seenOperations,
          );
        }
        const value = ts.isPropertyAssignment(property)
          ? property.initializer
          : ts.isShorthandPropertyAssignment(property)
            ? property.name
            : undefined;
        return count + (
          value
          && expressionHasTransactionWork(
            value,
            transactionSymbols,
            new Set<ts.Symbol>(),
            seenOperations,
          )
            ? 1
            : 0
        );
      }, 0);
    }

    if (
      ts.isCallExpression(candidate)
      && ["map", "flatMap"].includes(propertyName(candidate.expression) ?? "")
    ) {
      const callback = candidate.arguments[0];
      if (
        callback
        && expressionHasTransactionWork(
          callback,
          transactionSymbols,
          new Set<ts.Symbol>(),
          seenOperations,
        )
      ) {
        return 2;
      }
    }

    if (
      ts.isCallExpression(candidate)
      && propertyName(candidate.expression) === "from"
      && propertyOwner(candidate.expression)
      && isGlobalReference(propertyOwner(candidate.expression)!, "Array")
    ) {
      const callback = candidate.arguments[1];
      if (
        callback
        && expressionHasTransactionWork(
          callback,
          transactionSymbols,
          new Set<ts.Symbol>(),
          seenOperations,
        )
      ) {
        return 2;
      }
      const source = candidate.arguments[0];
      if (source) {
        return concurrentTransactionWorkCount(
          source,
          transactionSymbols,
          seenSymbols,
          seenOperations,
        );
      }
    }

    if (ts.isCallExpression(candidate) && propertyName(candidate.expression) === "filter") {
      const filtered = propertyOwner(candidate.expression);
      if (filtered) {
        return concurrentTransactionWorkCount(
          filtered,
          transactionSymbols,
          seenSymbols,
          seenOperations,
        );
      }
    }

    if (
      ts.isCallExpression(candidate)
      && propertyName(candidate.expression) === "values"
      && propertyOwner(candidate.expression)
      && isGlobalReference(propertyOwner(candidate.expression)!, "Object")
    ) {
      const object = candidate.arguments[0];
      if (object) {
        return concurrentTransactionWorkCount(
          object,
          transactionSymbols,
          seenSymbols,
          seenOperations,
        );
      }
    }

    if (ts.isIdentifier(candidate)) {
      const symbol = symbolAt(candidate);
      if (symbol && !seenSymbols.has(symbol)) {
        seenSymbols.add(symbol);
        const initializer = variableInitializer(symbol);
        let count = initializer
          ? concurrentTransactionWorkCount(
            initializer,
            transactionSymbols,
            seenSymbols,
            seenOperations,
          )
          : 0;

        if (count < 2) {
          let scope: ts.Node = candidate;
          while (scope.parent && !ts.isFunctionLike(scope.parent) && !ts.isSourceFile(scope.parent)) {
            scope = scope.parent;
          }
          const mutationRoot = ts.isFunctionLike(scope.parent) && "body" in scope.parent
            ? scope.parent.body
            : candidate.getSourceFile();

          function findPushes(node: ts.Node) {
            if (count >= 2 || node.getStart() >= candidate.getStart()) return;
            if (node !== mutationRoot && ts.isFunctionLike(node)) return;
            if (
              ts.isCallExpression(node)
              && propertyName(node.expression) === "push"
            ) {
              const owner = propertyOwner(node.expression);
              const ownerSymbol = owner && ts.isIdentifier(owner) ? symbolAt(owner) : undefined;
              if (ownerSymbol === symbol) {
                for (const argument of node.arguments) {
                  if (count >= 2) break;
                  count += ts.isSpreadElement(argument)
                    ? concurrentTransactionWorkCount(
                      argument.expression,
                      transactionSymbols,
                      new Set<ts.Symbol>(),
                      seenOperations,
                    )
                    : expressionHasTransactionWork(
                      argument,
                      transactionSymbols,
                      new Set<ts.Symbol>(),
                      seenOperations,
                    )
                      ? 1
                      : 0;
                }
              }
            }
            ts.forEachChild(node, findPushes);
          }

          if (mutationRoot) findPushes(mutationRoot);
        }
        return count;
      }
    }

    return expressionHasTransactionWork(
      candidate,
      transactionSymbols,
      new Set<ts.Symbol>(),
      seenOperations,
    )
      ? 1
      : 0;
  }

  function recordViolation(
    node: ts.Node,
    policy: string,
    transactionSymbols: ReadonlySet<ts.Symbol>,
  ) {
    const source = node.getSourceFile();
    const sourceKey = normalizedFileName(source.fileName);
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    const key = `${sourceKey}:${node.getStart(source)}:${policy}`;
    const transactionClient = [...transactionSymbols][0]?.getName() ?? "transaction";
    violations.set(key, {
      file: displayFileByFile.get(sourceKey) ?? source.fileName.replaceAll("\\", "/"),
      line: line + 1,
      combinator: policy,
      transactionClient,
    });
  }

  function containsAwait(expression: ts.Expression) {
    let found = false;
    function visit(node: ts.Node) {
      if (found || (node !== expression && ts.isFunctionLike(node))) return;
      if (ts.isAwaitExpression(node)) {
        found = true;
        return;
      }
      ts.forEachChild(node, visit);
    }
    visit(expression);
    return found;
  }

  function symbolIsHandledLater(
    symbol: ts.Symbol,
    afterPosition: number,
    body: ts.ConciseBody,
    initiallyPromise = true,
  ) {
    function referenceIsAssimilated(reference: ts.Identifier) {
      let current: ts.Node = reference;
      let isPromise = initiallyPromise;

      while (current.parent && current.parent !== body) {
        if (current === body) return isPromise;
        const parent = current.parent;
        if (
          (ts.isParenthesizedExpression(parent)
            || ts.isAsExpression(parent)
            || ts.isTypeAssertionExpression(parent)
            || ts.isNonNullExpression(parent)
            || ts.isSatisfiesExpression(parent))
          && parent.expression === current
        ) {
          current = parent;
          continue;
        }
        if (
          ts.isConditionalExpression(parent)
          && (parent.whenTrue === current || parent.whenFalse === current)
          && isPromise
        ) {
          current = parent;
          continue;
        }
        if (ts.isArrayLiteralExpression(parent)) {
          current = parent;
          isPromise = false;
          continue;
        }
        if (
          ts.isPropertyAccessExpression(parent)
          && parent.expression === current
          && ["then", "catch", "finally"].includes(parent.name.text)
          && ts.isCallExpression(parent.parent)
          && parent.parent.expression === parent
          && isPromise
        ) {
          current = parent.parent;
          continue;
        }
        if (
          (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent))
          && parent.expression === current
          && propertyName(parent)
          && ["filter", "slice"].includes(propertyName(parent)!)
          && ts.isCallExpression(parent.parent)
          && parent.parent.expression === parent
          && !isPromise
        ) {
          current = parent.parent;
          continue;
        }
        if (ts.isCallExpression(parent) && parent.arguments.includes(current as ts.Expression)) {
          const combinator = promiseCombinator(parent.expression);
          if (combinator && parent.arguments[0] === current) {
            current = parent;
            isPromise = true;
            continue;
          }
          const method = propertyName(parent.expression);
          const owner = propertyOwner(parent.expression);
          if (
            method === "resolve"
            && owner
            && isGlobalPromiseReference(owner)
            && parent.arguments[0] === current
            && isPromise
          ) {
            current = parent;
            continue;
          }
          if (
            method === "from"
            && owner
            && isGlobalReference(owner, "Array")
            && parent.arguments[0] === current
          ) {
            current = parent;
            isPromise = false;
            continue;
          }
          if (
            method === "values"
            && owner
            && isGlobalReference(owner, "Object")
            && parent.arguments[0] === current
            && !isPromise
          ) {
            current = parent;
            continue;
          }
        }
        if (ts.isAwaitExpression(parent) && parent.expression === current) return isPromise;
        if (ts.isReturnStatement(parent) && parent.expression === current) return isPromise;
        return false;
      }

      return current === body && isPromise;
    }

    let handled = false;
    function visit(node: ts.Node) {
      if (handled || (node !== body && ts.isFunctionLike(node))) return;
      if (
        ts.isIdentifier(node)
        && node.getStart() > afterPosition
        && symbolAt(node) === symbol
      ) {
        handled = referenceIsAssimilated(node);
        if (handled) return;
      }
      ts.forEachChild(node, visit);
    }
    visit(body);
    return handled;
  }

  function storesNonPromiseContainer(rawExpression: ts.Expression) {
    const expression = unwrappedExpression(rawExpression);
    if (ts.isArrayLiteralExpression(expression) || ts.isObjectLiteralExpression(expression)) {
      return true;
    }
    if (!ts.isCallExpression(expression)) return false;
    const method = propertyName(expression.expression);
    const owner = propertyOwner(expression.expression);
    return ["map", "flatMap", "filter", "slice"].includes(method ?? "")
      || Boolean(
        method === "from" && owner && isGlobalReference(owner, "Array"),
      )
      || Boolean(
        method === "values" && owner && isGlobalReference(owner, "Object"),
      );
  }

  function assignedSymbol(expression: ts.Expression) {
    const candidate = unwrappedExpression(expression);
    if (
      ts.isBinaryExpression(candidate)
      && candidate.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(candidate.left)
    ) {
      return symbolAt(candidate.left);
    }
    return undefined;
  }

  function pushedCollectionSymbol(expression: ts.Expression) {
    const candidate = unwrappedExpression(expression);
    if (!ts.isCallExpression(candidate) || propertyName(candidate.expression) !== "push") {
      return undefined;
    }
    const owner = propertyOwner(candidate.expression);
    return owner && ts.isIdentifier(owner) ? symbolAt(owner) : undefined;
  }

  function analyzeFunction(
    declaration: ts.FunctionLikeDeclaration & { body: ts.ConciseBody },
    initialSymbols: ReadonlySet<ts.Symbol>,
  ) {
    const key = functionKey(declaration, initialSymbols);
    if (analyzedFunctions.has(key)) return;
    analyzedFunctions.add(key);
    const symbolsByPosition = new Map<number, Set<ts.Symbol>>();

    function symbolsAt(node: ts.Node) {
      const position = node.getStart();
      const cached = symbolsByPosition.get(position);
      if (cached) return cached;
      const symbols = collectTransactionAliases(declaration.body, initialSymbols, position);
      symbolsByPosition.set(position, symbols);
      return symbols;
    }

    function visit(node: ts.Node) {
      if (node !== declaration.body && ts.isFunctionLike(node)) return;
      if (
        ts.isVariableDeclaration(node)
        && node.initializer
        && !ts.isArrowFunction(unwrappedExpression(node.initializer))
        && !ts.isFunctionExpression(unwrappedExpression(node.initializer))
        && !containsAwait(node.initializer)
      ) {
        const transactionSymbols = symbolsAt(node);
        if (expressionHasTransactionWork(node.initializer, transactionSymbols)) {
          const bindingSymbols = new Set<ts.Symbol>();
          addBindingSymbols(node.name, bindingSymbols);
          const handled = [...bindingSymbols].some((symbol) =>
            symbolIsHandledLater(
              symbol,
              node.getStart(),
              declaration.body,
              !storesNonPromiseContainer(node.initializer!),
            ));
          if (!handled) recordViolation(node, "detached transaction start", initialSymbols);
        }
      }
      if (ts.isExpressionStatement(node) && !containsAwait(node.expression)) {
        const transactionSymbols = symbolsAt(node);
        if (expressionHasTransactionWork(node.expression, transactionSymbols)) {
          const storedSymbol = assignedSymbol(node.expression)
            ?? pushedCollectionSymbol(node.expression);
          const handled = storedSymbol
            ? symbolIsHandledLater(
              storedSymbol,
              node.getStart(),
              declaration.body,
              !pushedCollectionSymbol(node.expression),
            )
            : false;
          if (!handled) recordViolation(node, "detached transaction start", initialSymbols);
        }
      }
      if (ts.isCallExpression(node)) {
        const transactionSymbols = symbolsAt(node);
        const combinator = promiseCombinator(node.expression);
        const iterable = node.arguments[0];
        if (
          combinator
          && iterable
          && concurrentTransactionWorkCount(iterable, transactionSymbols) >= 2
        ) {
          recordViolation(node, `Promise.${combinator}`, initialSymbols);
        }

        for (const callee of calledFunctions(node)) {
          const symbols = transactionSymbolsForCall(node, callee, transactionSymbols);
          if (symbols.size > 0) analyzeFunction(callee, symbols);
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(declaration.body);
  }

  for (const file of sourceFiles) {
    const source = program.getSourceFile(resolve(file.file))
      ?? program.getSourceFile(normalizedFileName(file.file));
    if (!source) continue;

    function findTransactions(node: ts.Node) {
      if (ts.isCallExpression(node) && transactionMethodReference(node.expression)) {
        const callback = node.arguments[0];
        for (const callbackDeclaration of callback ? callableFunctions(callback) : []) {
          const parameter = callbackDeclaration.parameters[0];
          if (!parameter) continue;
          const symbols = new Set<ts.Symbol>();
          addBindingSymbols(parameter.name, symbols);
          if (symbols.size > 0) analyzeFunction(callbackDeclaration, symbols);
        }
      }
      ts.forEachChild(node, findTransactions);
    }

    findTransactions(source);
  }

  return [...violations.values()].sort((left, right) =>
    left.file.localeCompare(right.file) || left.line - right.line);
}
