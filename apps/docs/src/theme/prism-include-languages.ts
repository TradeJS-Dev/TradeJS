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
}
