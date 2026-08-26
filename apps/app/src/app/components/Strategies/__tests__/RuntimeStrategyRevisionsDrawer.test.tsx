import React from 'react';
import { render, screen } from '@testing-library/react';
import type { RuntimeStrategyView } from '@tradejs/types';
import {
  buildRuntimeStrategyRevisionItems,
  RuntimeStrategyRevisionsDrawer,
} from '../RuntimeStrategyRevisionsDrawer';

jest.mock('@chakra-ui/react', () => {
  const React = require('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const DrawerRoot = ({
    children,
    open,
  }: {
    children?: React.ReactNode;
    open?: boolean;
  }) => (open ? <div>{children}</div> : null);
  const Button = ({ children }: { children?: React.ReactNode }) => (
    <button>{children}</button>
  );

  return {
    Badge: passthrough,
    Box: passthrough,
    Button,
    CloseButton: Button,
    Drawer: {
      Root: DrawerRoot,
      Backdrop: passthrough,
      Positioner: passthrough,
      Content: passthrough,
      Header: passthrough,
      Title: passthrough,
      CloseTrigger: passthrough,
      Body: passthrough,
      Footer: passthrough,
    },
    Flex: passthrough,
    Portal: passthrough,
    Text: passthrough,
  };
});

const strategy = {
  strategyName: 'DoubleTap',
  strategyRevision: 'sr1:3333333333333333',
  revisionChanges: [
    { timestamp: 100, strategyRevision: 'sr1:1111111111111111' },
    { timestamp: 200, strategyRevision: 'sr1:2222222222222222' },
    { timestamp: 300, strategyRevision: 'sr1:3333333333333333' },
  ],
} as RuntimeStrategyView;

describe('RuntimeStrategyRevisionsDrawer', () => {
  it('shows the current revision and every recorded revision', () => {
    render(
      <RuntimeStrategyRevisionsDrawer
        open
        strategy={strategy}
        onOpenChange={jest.fn()}
      />,
    );

    expect(screen.getByText('DoubleTap revisions')).toBeTruthy();
    expect(screen.getByText('Current')).toBeTruthy();
    expect(screen.getByText('sr1:3333333333333333')).toBeTruthy();
    expect(screen.getByText('sr1:2222222222222222')).toBeTruthy();
    expect(screen.getByText('sr1:1111111111111111')).toBeTruthy();
  });

  it('deduplicates rolled-back revisions and keeps their latest change', () => {
    expect(
      buildRuntimeStrategyRevisionItems({
        strategyRevision: 'sr1:2222222222222222',
        revisionChanges: [
          { timestamp: 100, strategyRevision: 'sr1:1111111111111111' },
          { timestamp: 200, strategyRevision: 'sr1:2222222222222222' },
          { timestamp: 300, strategyRevision: 'sr1:1111111111111111' },
          { timestamp: 400, strategyRevision: 'sr1:2222222222222222' },
        ],
      }),
    ).toEqual([
      {
        strategyRevision: 'sr1:2222222222222222',
        changedAt: 400,
        current: true,
      },
      {
        strategyRevision: 'sr1:1111111111111111',
        changedAt: 300,
        current: false,
      },
    ]);
  });
});
