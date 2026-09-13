import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as nodeModule from 'node:module';
import { parse, type Node, type Token } from 'acorn';
import { canonicalJson } from '../replay/canonical-json.js';

const exec = promisify(execFile);
type Tree = Record<string, unknown>;
function tree(value: unknown): value is Tree { return typeof value === 'object' && value !== null && !Array.isArray(value); }

function jsParse(source: string, path: string): { ast: Node; tokens: Token[] } {
  let code = source;
  if (/\.[cm]?ts$/u.test(path)) {
    if (typeof nodeModule.stripTypeScriptTypes !== 'function') throw new Error('TypeScript parser unavailable');
    code = nodeModule.stripTypeScriptTypes(source, { mode: 'strip' });
    if (code.length !== source.length) throw new Error('TypeScript parser did not preserve source positions');
  }
  const tokens: Token[] = [];
  const ast = parse(code, { ecmaVersion: 2022, sourceType: path.endsWith('.cjs') ? 'script' : 'module', onToken: tokens });
  return { ast, tokens: tokens.filter((token) => token.type.label !== 'eof') };
}

/** Existing syntax and all original bytes remain fixed; only enumerated token insertions are accepted. */
function insertedJsTokens(before: string, after: string, oldTokens: Token[], newTokens: Token[]): Token[] {
  let cursor = 0;
  const added: Token[] = [];
  for (const token of newTokens) {
    const old = oldTokens[cursor];
    if (old && before.slice(old.start, old.end) === after.slice(token.start, token.end)) cursor += 1;
    else if (['await', 'async'].includes(after.slice(token.start, token.end))) added.push(token);
    else throw new Error('change exceeds async token insertions');
  }
  if (cursor !== oldTokens.length || added.length === 0 || added.length > 8) throw new Error('original tokens changed or no bounded insertion');
  // Try optional single following spaces. No changed comments, indentation, literals, or type annotations.
  const reconstruct = (index: number, end: number): string[] => {
    if (index < 0) return [after.slice(0, end)];
    const token = added[index]!;
    const suffix = after.slice(token.end, end);
    return reconstruct(index - 1, token.start).flatMap((prefix) => [prefix + suffix, ...(suffix.startsWith(' ') ? [prefix + suffix.slice(1)] : [])]);
  };
  if (!reconstruct(added.length - 1, after.length).includes(before)) throw new Error('bytes outside inserted async syntax changed');
  return added;
}

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (!tree(value)) return value;
  if (value.type === 'AwaitExpression') return normalized(value.argument);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['start', 'end', 'loc', 'raw'].includes(key)).map(([key, item]) => [key, key === 'async' ? false : normalized(item)]));
}

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const UNSAFE_COMPLETION = new Set(['IfStatement', 'SwitchStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement', 'TryStatement', 'ThrowStatement', 'ReturnStatement', 'LogicalExpression', 'ConditionalExpression', 'AssignmentExpression', 'UpdateExpression', 'YieldExpression']);
function children(node: Tree): Tree[] {
  return Object.values(node).flatMap((value) => Array.isArray(value) ? value.filter(tree) : tree(value) ? [value] : []);
}
function straightLineBody(fn: Tree): Tree {
  if (!tree(fn.body) || fn.body.type !== 'BlockStatement' || !Array.isArray(fn.body.body) || fn.body.body.some((s) => !tree(s) || !['ExpressionStatement', 'VariableDeclaration'].includes(String(s.type)))) throw new Error('completion body is not supported straight-line syntax');
  const check = (node: Tree): void => {
    if (UNSAFE_COMPLETION.has(String(node.type)) || FUNCTIONS.has(String(node.type))) throw new Error('ambiguous completion control flow');
    children(node).forEach(check);
  };
  check(fn.body);
  return fn.body;
}
function importedVitestTest(ast: Tree): boolean {
  return children(ast).some((node) => node.type === 'ImportDeclaration' && tree(node.source) && node.source.value === 'vitest' && Array.isArray(node.specifiers) && node.specifiers.some((spec) => tree(spec) && spec.type === 'ImportSpecifier' && tree(spec.imported) && spec.imported.name === 'test' && tree(spec.local) && spec.local.name === 'test'));
}
function knownExpectBinding(ast: Tree): boolean {
  let known = true;
  const bindsExpect = (node: unknown): boolean => tree(node) && (node.type === 'Identifier' ? node.name === 'expect' : children(node).some(bindsExpect));
  const visit = (node: Tree, parent?: Tree): void => {
    if (node.type === 'ImportSpecifier' && tree(node.local) && node.local.name === 'expect' && !(parent && tree(parent.source) && parent.source.value === 'vitest' && tree(node.imported) && node.imported.name === 'expect')) known = false;
    if (['ImportDefaultSpecifier', 'ImportNamespaceSpecifier'].includes(String(node.type)) && bindsExpect(node.local)) known = false;
    if (node.type === 'VariableDeclarator' && bindsExpect(node.id)) known = false;
    if (FUNCTIONS.has(String(node.type)) && (bindsExpect(node.id) || (Array.isArray(node.params) && node.params.some(bindsExpect)))) known = false;
    if (node.type === 'AssignmentExpression' && bindsExpect(node.left)) known = false;
    children(node).forEach((child) => visit(child, node));
  };
  visit(ast); return known;
}

export function validateJavaScriptAwaitEdit(before: string, after: string, path: string): void {
  const old = jsParse(before, path); const next = jsParse(after, path);
  const added = insertedJsTokens(before, after, old.tokens, next.tokens);
  const awaitStarts = new Set(added.filter((t) => after.slice(t.start, t.end) === 'await').map((t) => t.start));
  const asyncStarts = new Set(added.filter((t) => after.slice(t.start, t.end) === 'async').map((t) => t.start));
  const usedAwait = new Set<number>(); const usedAsync = new Set<number>();
  const ast = next.ast as unknown as Tree;
  const parents = new Map<Tree, Tree>();
  const index = (node: Tree): void => { for (const child of children(node)) { parents.set(child, node); index(child); } };
  index(ast);
  const isDirectStatement = (node: Tree, body: Tree): boolean => parents.get(node)?.type === 'ExpressionStatement' && parents.get(parents.get(node)!) === body;
  const observedValue = (value: Tree, body: Tree): boolean => {
    let expression = value;
    while (parents.get(expression)?.type === 'MemberExpression' && parents.get(expression)?.object === expression) expression = parents.get(expression)!;
    const expectation = parents.get(expression);
    if (expectation?.type !== 'CallExpression' || !tree(expectation.callee) || expectation.callee.type !== 'Identifier' || expectation.callee.name !== 'expect' || !Array.isArray(expectation.arguments) || expectation.arguments.length !== 1 || expectation.arguments[0] !== expression || !knownExpectBinding(ast)) return false;
    const member = parents.get(expectation); const assertion = member && parents.get(member);
    return member?.type === 'MemberExpression' && member.object === expectation && member.computed === false && tree(member.property) && ['toBe', 'toEqual', 'toStrictEqual'].includes(String(member.property.name)) && assertion?.type === 'CallExpression' && assertion.callee === member && isDirectStatement(assertion, body);
  };
  const setupUsesOnlyObservedValues = (binding: Tree, body: Tree): boolean => {
    const references: Tree[] = [];
    const collect = (node: Tree): void => {
      const parent = parents.get(node);
      if (node !== binding && node.type === 'Identifier' && node.name === binding.name && !(parent?.type === 'MemberExpression' && parent.property === node && parent.computed === false)) references.push(node);
      children(node).forEach(collect);
    };
    collect(body);
    return references.length > 0 && references.every((reference) => observedValue(reference, body));
  };
  function visit(node: Tree, enclosing?: Tree): void {
    const fn = FUNCTIONS.has(String(node.type)) ? node : enclosing;
    if (node.type === 'AwaitExpression' && awaitStarts.has(node.start as number)) {
      if (!fn || fn.async !== true || !tree(node.argument) || node.argument.type !== 'CallExpression') throw new Error('await must wrap an existing call in an async function');
      const body = straightLineBody(fn);
      // Existing async syntax also needs a caller that waits for completion.
      // Otherwise inserting await can detach assertions that ran before the first suspension.
      const call = parents.get(fn);
      if (!importedVitestTest(ast) || !call || call.type !== 'CallExpression' || !tree(call.callee) || call.callee.type !== 'Identifier' || call.callee.name !== 'test' || !Array.isArray(call.arguments) || call.arguments.length !== 2 || call.arguments[1] !== fn || !Array.isArray(fn.params) || fn.params.length !== 0 || !isDirectStatement(call, ast)) throw new Error('edited callback is not proven completion-aware');
      if (asyncStarts.has(fn.start as number)) usedAsync.add(fn.start as number);
      const parent = parents.get(node);
      let safePosition = isDirectStatement(node, body);
      if (parent?.type === 'VariableDeclarator' && parent.init === node && tree(parent.id) && parent.id.type === 'Identifier') {
        const declaration = parents.get(parent);
        safePosition = declaration?.type === 'VariableDeclaration' && declaration.kind === 'const' && Array.isArray(declaration.declarations) && declaration.declarations.length === 1 && parents.get(declaration) === body && setupUsesOnlyObservedValues(parent.id, body);
      }
      if (observedValue(node, body)) safePosition = true;
      if (!safePosition) throw new Error('await is not an observed assertion value or direct setup operation');
      usedAwait.add(node.start as number);
    }
    children(node).forEach((child) => visit(child, fn));
  }
  visit(ast);
  if (usedAwait.size !== awaitStarts.size || usedAwait.size === 0 || usedAsync.size !== asyncStarts.size) throw new Error('only necessary enclosing async modifiers are allowed');
  if (canonicalJson(normalized(old.ast)) !== canonicalJson(normalized(next.ast))) throw new Error('expression or enclosing structure changed');
}

const PYTHON_COMPARE = `
import ast, io, json, sys, tokenize
data=json.loads(sys.argv[1]); before=data['before']; after=data['after']
a=ast.parse(before); b=ast.parse(after)
def tokens(source):
 return [t for t in tokenize.generate_tokens(io.StringIO(source).readline) if t.type not in (tokenize.ENCODING,tokenize.ENDMARKER)]
old=tokens(before); new=tokens(after); cursor=0; added=[]
lines=after.splitlines(keepends=True)
def offset(pos): return sum(len(x) for x in lines[:pos[0]-1])+pos[1]
for token in new:
 if cursor<len(old) and (token.type,token.string)==(old[cursor].type,old[cursor].string): cursor+=1
 elif token.type==tokenize.NAME and token.string in ('async','await'): added.append(token)
 else: raise ValueError('only added async/await tokens allowed')
if cursor!=len(old) or not 1<=len(added)<=8: raise ValueError('tokens removed or unbounded additions')
variants=[after]
for token in reversed(added):
 start=offset(token.start); end=offset(token.end)
 variants=[v[:start]+v[end+n:] for v in variants for n in ([0,1] if v[end:end+1]==' ' else [0])]
if before not in variants: raise ValueError('original source bytes changed')
new_await={(t.start[0],t.start[1]) for t in added if t.string=='await'}
new_async={(t.start[0],t.start[1]) for t in added if t.string=='async'}
used_await=set(); used_async=set()
parents={child:parent for parent in ast.walk(b) for child in ast.iter_child_nodes(parent)}
unsafe=(ast.If,ast.For,ast.AsyncFor,ast.While,ast.Try,ast.With,ast.AsyncWith,ast.BoolOp,ast.IfExp,ast.ListComp,ast.SetComp,ast.DictComp,ast.GeneratorExp,ast.Lambda,ast.NamedExpr,ast.Yield,ast.YieldFrom)
def direct_expr(node,enclosing):
 parent=parents.get(node)
 return isinstance(parent,ast.Expr) and parent in enclosing.body
def completion_method(fn):
 cls=parents.get(fn)
 if not isinstance(cls,ast.ClassDef) or parents.get(cls) is not b or len(cls.bases)!=1 or cls.keywords or cls.decorator_list or fn.decorator_list or not fn.name.startswith('test_'): return False
 if any(not isinstance(member,(ast.FunctionDef,ast.AsyncFunctionDef)) or not member.name.startswith('test_') or member.decorator_list for member in cls.body): return False
 base=cls.bases[0]
 if not isinstance(base,ast.Attribute) or not isinstance(base.value,ast.Name) or base.value.id!='unittest' or base.attr!='IsolatedAsyncioTestCase': return False
 if len(fn.args.args)!=1 or fn.args.args[0].arg!='self' or fn.args.posonlyargs or fn.args.kwonlyargs or fn.args.vararg or fn.args.kwarg: return False
 imported=False
 for node in b.body:
  if isinstance(node,ast.Import):
   for alias in node.names:
    if alias.name=='unittest' and alias.asname is None: imported=True
    elif (alias.asname or alias.name.split('.')[0])=='unittest': return False
  elif isinstance(node,ast.ImportFrom):
   if any((alias.asname or alias.name)=='unittest' for alias in node.names): return False
  elif isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)):
   if node.name=='unittest': return False
  elif any(isinstance(n,ast.Name) and isinstance(n.ctx,ast.Store) and n.id=='unittest' for n in ast.walk(node)): return False
 return imported
def observed_value(node,enclosing):
 expression=node
 while isinstance(parents.get(expression),(ast.Attribute,ast.Subscript)) and parents[expression].value is expression: expression=parents[expression]
 parent=parents.get(expression)
 if isinstance(parent,ast.Call) and isinstance(parent.func,ast.Attribute) and isinstance(parent.func.value,ast.Name) and parent.func.value.id=='self' and parent.func.attr=='assertEqual' and len(parent.args)==2 and parent.args[0] is expression and not parent.keywords and direct_expr(parent,enclosing): return True
 if isinstance(parent,ast.Compare) and parent.left is expression and len(parent.ops)==1 and isinstance(parent.ops[0],ast.Eq):
  assertion=parents.get(parent)
  return isinstance(assertion,ast.Assert) and assertion.test is parent and assertion in enclosing.body
 return False
def setup_uses_observed_values(binding,enclosing):
 refs=[n for statement in enclosing.body for n in ast.walk(statement) if isinstance(n,ast.Name) and n.id==binding.id and n is not binding]
 return bool(refs) and all(isinstance(n.ctx,ast.Load) and observed_value(n,enclosing) for n in refs)
def walk(node,enclosing=None):
 if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef,ast.Lambda)): enclosing=node
 if isinstance(node,ast.Await) and (node.lineno,node.col_offset) in new_await:
  if not isinstance(enclosing,ast.AsyncFunctionDef) or not isinstance(node.value,ast.Call): raise ValueError('unsupported await target')
  if any(not isinstance(s,(ast.Assign,ast.AnnAssign,ast.Expr,ast.Assert)) for s in enclosing.body): raise ValueError('not straight-line completion')
  for statement in enclosing.body:
   if any(isinstance(n,unsafe+(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)) for n in ast.walk(statement)): raise ValueError('ambiguous completion control flow')
  pos=(enclosing.lineno,enclosing.col_offset)
  if not completion_method(enclosing): raise ValueError('edited method is not completion-aware')
  if pos in new_async: used_async.add(pos)
  parent=parents.get(node); safe=direct_expr(node,enclosing)
  if isinstance(parent,(ast.Assign,ast.AnnAssign)) and parent.value is node and parent in enclosing.body:
   targets=parent.targets if isinstance(parent,ast.Assign) else [parent.target]
   safe=len(targets)==1 and isinstance(targets[0],ast.Name) and setup_uses_observed_values(targets[0],enclosing)
  if observed_value(node,enclosing): safe=True
  if not safe: raise ValueError('await is not observed assertion value or setup')
  used_await.add((node.lineno,node.col_offset))
 for child in ast.iter_child_nodes(node): walk(child,enclosing)
walk(b)
if used_await!=new_await or not used_await or used_async!=new_async: raise ValueError('unnecessary async syntax')

class Normalize(ast.NodeTransformer):
 def visit_Await(self,node): return self.visit(node.value)
 def visit_AsyncFunctionDef(self,node):
  self.generic_visit(node)
  return ast.FunctionDef(**{field:getattr(node,field) for field in node._fields})
if ast.dump(Normalize().visit(a),include_attributes=False)!=ast.dump(Normalize().visit(b),include_attributes=False): raise ValueError('structure changed')
print('ok')
`;

export async function validateAwaitEdit(before: string, after: string, path: string): Promise<void> {
  if (Buffer.byteLength(before) > 16_000 || Buffer.byteLength(after) > 16_000) throw new Error('source exceeds syntax bound');
  if (/\.py$/u.test(path)) {
    try {
      const result = await exec('python3', ['-I', '-c', PYTHON_COMPARE, JSON.stringify({ before, after })], { timeout: 5_000, maxBuffer: 16_384 });
      if (result.stdout.trim() !== 'ok') throw new Error('unexpected parser response');
    } catch { throw new Error('Python syntax comparison rejected the candidate'); }
  } else if (/\.[cm]?[jt]s$/u.test(path)) validateJavaScriptAwaitEdit(before, after, path);
  else throw new Error('unsupported async language');
}

export async function validateAwaitSource(source: string, path: string): Promise<void> {
  if (/\.py$/u.test(path)) {
    await exec('python3', ['-I', '-c', 'import ast,sys; ast.parse(sys.argv[1]); print("ok")', source], { timeout: 5_000, maxBuffer: 16_384 });
  } else if (/\.[cm]?[jt]s$/u.test(path)) jsParse(source, path);
  else throw new Error('unsupported async language');
}

/** Parse duplicate-free strict JSON; JSONC, trailing commas and duplicate properties abstain. */
export function strictJson(source: string): Tree {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error('configuration must be strict JSON'); }
  if (!tree(value)) throw new Error('configuration must be an object');
  const tokens = source.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|[^\s{}\[\]:,]+/gu) ?? [];
  const stack: Array<Set<string> | null> = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token === '{') stack.push(new Set()); else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token.startsWith('"') && tokens[i + 1] === ':') {
      const key = JSON.parse(token) as string; const keys = stack.at(-1);
      if (keys?.has(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('duplicate or unsafe JSON property');
      keys?.add(key);
    }
  }
  return value;
}

export function validateStrictConfigEdit(before: string, after: string, key: string): void {
  const old = strictJson(before); const next = strictJson(after);
  if (!tree(old.compilerOptions) || !tree(next.compilerOptions)) throw new Error('compilerOptions must exist');
  if ((Object.hasOwn(old.compilerOptions, key) && old.compilerOptions[key] !== false) || next.compilerOptions[key] !== true) throw new Error('strict restoration must change missing/false to true');
  old.compilerOptions[key] = true;
  if (canonicalJson(old) !== canonicalJson(next)) throw new Error('other configuration changed');
}

/** Deliberately narrow recognition of the existing fixture's explicit strictness test. */
export function existingStrictRequirement(source: string, configName: string, key: string): boolean {
  try {
    const { ast } = jsParse(source, 'authority.mjs');
    let fsImported = false; let expectImported = false; let testImported = false;
    const statements = (ast as unknown as { body: Tree[] }).body;
    const tests: Tree[] = [];
    for (const node of statements) {
      if (node.type === 'ImportDeclaration' && tree(node.source) && Array.isArray(node.specifiers)) {
        if (!['node:fs/promises', 'vitest'].includes(String(node.source.value)) || node.specifiers.length === 0) return false;
        for (const spec of node.specifiers) {
          if (!tree(spec) || spec.type !== 'ImportSpecifier' || !tree(spec.imported) || !tree(spec.local) || spec.imported.name !== spec.local.name) return false;
          if (node.source.value === 'node:fs/promises' && spec.local.name === 'readFile') fsImported = true;
          else if (node.source.value === 'vitest' && spec.local.name === 'expect') expectImported = true;
          else if (node.source.value === 'vitest' && spec.local.name === 'test') testImported = true;
          else return false;
        }
      } else if (node.type === 'ExpressionStatement' && tree(node.expression)) tests.push(node.expression);
      else return false;
    }
    if (!fsImported || !expectImported || !testImported || tests.length !== 1) return false;
    const test = tests[0]!;
    if (test.type !== 'CallExpression' || !tree(test.callee) || test.callee.name !== 'test' || !Array.isArray(test.arguments) || test.arguments.length !== 2) return false;
    const callback: unknown = test.arguments[1];
    if (!tree(callback) || callback.type !== 'ArrowFunctionExpression' || callback.async !== true || !Array.isArray(callback.params) || callback.params.length !== 0 || !tree(callback.body) || !Array.isArray(callback.body.body) || callback.body.body.length !== 2) return false;
    const [declaration, assertion] = callback.body.body as Tree[];
    if (!declaration || declaration.type !== 'VariableDeclaration' || declaration.kind !== 'const' || !Array.isArray(declaration.declarations) || declaration.declarations.length !== 1) return false;
    const variable: unknown = declaration.declarations[0];
    if (!tree(variable) || !tree(variable.id) || variable.id.type !== 'Identifier' || !tree(variable.init) || ['JSON', 'URL', 'readFile', 'expect', 'test'].includes(String(variable.id.name))) return false;
    if (source.slice(variable.init.start as number, variable.init.end as number) !== `JSON.parse(await readFile(new URL('./${configName}', import.meta.url), 'utf8'))`) return false;
    if (!assertion || assertion.type !== 'ExpressionStatement' || !tree(assertion.expression)) return false;
    return source.slice(assertion.expression.start as number, assertion.expression.end as number) === `expect(${String(variable.id.name)}.compilerOptions.${key}).toBe(true)`;
  } catch { return false; }
}
