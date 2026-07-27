'use client';

import { CodeBlock, createShikiAdapter, IconButton } from '@chakra-ui/react';
import type { HighlighterGeneric } from 'shiki';
import { useMemo } from 'react';

interface JsonCodeBlockProps {
  tab: string;
  code: string;
}

const JsonCodeBlock = ({ code, tab }: JsonCodeBlockProps) => {
  const adapter = useMemo(() => {
    return createShikiAdapter<HighlighterGeneric<any, any>>({
      theme: 'github-dark',
      async load() {
        const { createHighlighter } = await import('shiki');
        return createHighlighter({
          langs: ['json'],
          themes: ['github-dark'],
        });
      },
    });
  }, []);

  return (
    <CodeBlock.AdapterProvider value={adapter}>
      <CodeBlock.Root code={code} language={'json'}>
        <CodeBlock.Header>
          <CodeBlock.Title>{tab}</CodeBlock.Title>
          <CodeBlock.CopyTrigger asChild>
            <IconButton variant="ghost" size="2xs">
              <CodeBlock.CopyIndicator />
            </IconButton>
          </CodeBlock.CopyTrigger>
        </CodeBlock.Header>
        <CodeBlock.Content>
          <CodeBlock.Code>
            <CodeBlock.CodeText />
          </CodeBlock.Code>
        </CodeBlock.Content>
      </CodeBlock.Root>
    </CodeBlock.AdapterProvider>
  );
};

export default JsonCodeBlock;
