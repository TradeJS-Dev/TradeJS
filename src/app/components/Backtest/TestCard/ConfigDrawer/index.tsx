'use client';

import { useState } from 'react';
import _ from 'lodash';
import {
  IconButton,
  CloseButton,
  Drawer,
  Portal,
  Tabs,
} from '@chakra-ui/react';
import dynamic from 'next/dynamic';
import { FiSettings } from 'react-icons/fi';
import { useTestContext } from '../context';

const JsonCodeBlock = dynamic(() => import('./JsonCodeBlock'), { ssr: false });

type TabType = 'test' | 'bot';

export const TestCardConfigDrawer = () => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabType>('test');
  const { testResult } = useTestContext();

  const getTestConf = () => JSON.stringify(testResult.test, null, 2);
  const getBotConf = () =>
    JSON.stringify(
      _.omit(
        { ...testResult.test, disabled: false },
        'name',
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
                <Drawer.Title>
                  Configuration
                  <Tabs.List mt={2}>
                    <Tabs.Trigger colorPalette={'teal'} value="test">
                      Test
                    </Tabs.Trigger>
                    <Tabs.Trigger colorPalette={'teal'} value="bot">
                      Bot
                    </Tabs.Trigger>
                  </Tabs.List>
                </Drawer.Title>

                <Drawer.CloseTrigger asChild>
                  <CloseButton position="absolute" right="3" top="3" />
                </Drawer.CloseTrigger>
              </Drawer.Header>

              <Drawer.Body overflowY="auto" flex="1">
                <Tabs.Content value="test">
                  <JsonCodeBlock tab={tab} code={getTestConf()} />
                </Tabs.Content>
                <Tabs.Content value="bot">
                  <JsonCodeBlock tab={tab} code={getBotConf()} />
                </Tabs.Content>
              </Drawer.Body>
            </Drawer.Content>
          </Drawer.Positioner>
        </Portal>
      </Drawer.Root>
    </Tabs.Root>
  );
};
