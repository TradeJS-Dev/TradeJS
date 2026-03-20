export default function prismIncludeLanguages(PrismObject: any): void {
  const Prism = PrismObject;

  Prism.languages.pine = Prism.languages.extend('clike', {
    keyword:
      /\b(?:if|else|for|while|switch|case|break|continue|return|var|and|or|not|true|false)\b/,
    function:
      /\b(?:indicator|strategy|plot|input(?:\.\w+)?|ta\.\w+|math\.\w+|request\.\w+|color\.\w+|nz|na)\b/,
    number: /\b(?:\d+(?:\.\d+)?|\.\d+)\b/,
  });

  Prism.languages.pine.comment = [/\/\/.*$/, /\/\*[\s\S]*?\*\//];

  Prism.languages.tstype = {
    comment: Prism.languages.typescript.comment,
    string: Prism.languages.typescript.string,
    keyword: /\b(?:type|readonly|keyof|extends|infer|as|is)\b/,
    builtin:
      /\b(?:string|number|boolean|bigint|symbol|unknown|void|never|undefined|null|object|any|true|false)\b/,
    property: {
      pattern: /(^|[\s{;,])([A-Za-z_$][\w$]*)(?=\??\s*:)/m,
      lookbehind: true,
    },
    'class-name': /\b[A-Z][\w$]*\b/,
    operator: /=>|[?:|&=]/,
    punctuation: /[{}[\]();,.<>]/,
  };
}
