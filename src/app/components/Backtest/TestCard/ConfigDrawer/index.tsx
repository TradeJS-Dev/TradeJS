'use client';

import { useState } from 'react';
import _ from 'lodash';
import {
  IconButton,
  CloseButton,
  Drawer,
  Portal,
  Tabs,
  CodeBlock,
  createShikiAdapter,
} from '@chakra-ui/react';
import type { HighlighterGeneric } from 'shiki';
import { FiSettings } from 'react-icons/fi';
import { useTestResult } from '../context';

type TabType = 'test' | 'bot';

const shikiAdapter = createShikiAdapter<HighlighterGeneric<any, any>>({
  async load() {
    const { createHighlighter } = await import('shiki');
    return createHighlighter({
      langs: ['json'],
      themes: ['github-dark'],
    });
  },
});

export const TaskCardConfigDrawer = () => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabType>('test');
  const { testResult } = useTestResult();

  const testConf = JSON.stringify(testResult.test, null, 2);
  const botConf = JSON.stringify(
    _.omit(
      { ...testResult.test, disabled: false },
      'name',
      'testId',
      'testSuiteId',
      'options',
    ),
    null,
    2,
  );

  return (
    <Tabs.Root
      value={tab}
      onValueChange={(e) => setTab(e.value as TabType)}
      variant={'line'}
    >
      <Drawer.Root
        open={open}
        onOpenChange={(e) => setOpen(e.open)}
        size={'lg'}
      >
        <Drawer.Trigger asChild>
          <IconButton
            colorPalette="teal"
            size="xs"
            variant={open ? 'surface' : 'outline'}
          >
            <FiSettings />
          </IconButton>
        </Drawer.Trigger>
        <Portal>
          <Drawer.Backdrop />
          <Drawer.Positioner>
            <Drawer.Content display="flex" flexDirection="column">
              <Drawer.Header>
                <Drawer.Title>Configuration
                <Tabs.List mt={2}>
                  <Tabs.Trigger value="test">Test</Tabs.Trigger>
                  <Tabs.Trigger value="bot">Bot</Tabs.Trigger>
                </Tabs.List>
                </Drawer.Title>

                <Drawer.CloseTrigger asChild>
                  <CloseButton position="absolute" right="3" top="3" />
                </Drawer.CloseTrigger>
              </Drawer.Header>

              <Drawer.Body overflowY="auto" flex="1">
                <Tabs.Content value="test">
                  <CodeBlock.AdapterProvider value={shikiAdapter}>
                    <CodeBlock.Root code={testConf} language={'json'}>
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
                </Tabs.Content>
                <Tabs.Content value="bot">
                  <CodeBlock.AdapterProvider value={shikiAdapter}>
                    <CodeBlock.Root code={botConf} language={'json'}>
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
                </Tabs.Content>
              </Drawer.Body>
            </Drawer.Content>
          </Drawer.Positioner>
        </Portal>
      </Drawer.Root>
    </Tabs.Root>
  );
};
