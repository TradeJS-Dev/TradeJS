#!/usr/bin/env node
// Static inventory, not a proof of runtime use or causal eligibility.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'packages/types/src');
const declarations = new Map();
for (const file of fs.readdirSync(directory).filter((f) => f.endsWith('.ts'))) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(path.join(directory, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  for (const node of source.statements)
    if (
      (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
      node.name
    )
      declarations.set(node.name.text, {
        node,
        source,
        file: 'packages/types/src/' + file,
      });
}
const inventory = [];
function visit(node, prefix, source, file, trail = []) {
  if (ts.isInterfaceDeclaration(node) || ts.isTypeLiteralNode(node)) {
    if (ts.isInterfaceDeclaration(node))
      for (const clause of node.heritageClauses ?? [])
        for (const parent of clause.types) {
          const name = parent.expression.getText(source),
            d = declarations.get(name);
          if (d && !trail.includes(name))
            visit(d.node, prefix, d.source, d.file, [...trail, name]);
        }
    for (const member of node.members)
      if (ts.isPropertySignature(member) && member.type)
        visit(
          member.type,
          prefix +
            '.' +
            member.name.getText(source).replace(/^['"]|['"]$/g, ''),
          source,
          file,
          trail,
        );
    return;
  }
  if (ts.isTypeAliasDeclaration(node))
    return visit(node.type, prefix, source, file, trail);
  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText(source),
      declaration = declarations.get(name);
    if (declaration && !trail.includes(name))
      return visit(
        declaration.node,
        prefix,
        declaration.source,
        declaration.file,
        [...trail, name],
      );
  }
  const type = node.getText(source);
  inventory.push({
    path: prefix,
    type,
    source: file,
    line: source.getLineAndCharacterOfPosition(node.pos).line + 1,
    projection:
      ts.isArrayTypeNode(node) || /^Array</.test(type)
        ? 'explicit-array-projection-required'
        : ts.isUnionTypeNode(node) &&
            node.types.some((t) => ts.isTypeLiteralNode(t))
          ? 'inspect-union'
          : 'primitive-or-reference-review',
  });
}
for (const name of [
  'BaseStrategyContextSnapshot',
  'BaseIndicatorsHistorySnapshot',
  'IndicatorSnapshot',
  'TickerProfileContext',
]) {
  const d = declarations.get(name);
  if (d) visit(d.node, name, d.source, d.file, [name]);
}
const report = {
  schema: 'tradejs-context-schema-audit/v1',
  scope:
    'Static public schema inventory. Optional/opaque unions and imported generic types need runtime inspection. No field is declared unused or training-safe merely from this inventory.',
  fields: inventory.length,
  arrayProjections: inventory.filter(
    (f) => f.projection === 'explicit-array-projection-required',
  ).length,
  inventory,
};
const flag = process.argv.indexOf('--out');
if (flag >= 0) {
  const out = process.argv[flag + 1];
  if (!out) throw new Error('--out requires a file');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      output: out,
      fields: report.fields,
      arrayProjections: report.arrayProjections,
    }),
  );
} else console.log(JSON.stringify(report, null, 2));
