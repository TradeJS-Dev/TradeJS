import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type {
  StrategyEvidenceMarker,
  StrategyEvidenceTimeline,
} from '@tradejs/types';
import {
  filterStrategyEvidenceMarkers,
  StrategyEvidencePopover,
} from '../StrategyEvidencePopover';

jest.mock('@chakra-ui/react', () => {
  const React = require('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  const Button = ({
    children,
    'aria-label': ariaLabel,
  }: {
    children?: React.ReactNode;
    'aria-label'?: string;
  }) => <button aria-label={ariaLabel}>{children}</button>;
  const CheckboxRoot = ({
    children,
    checked,
    onCheckedChange,
  }: {
    children?: React.ReactNode;
    checked?: boolean;
    onCheckedChange?: (details: { checked: boolean }) => void;
  }) => (
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) =>
          onCheckedChange?.({ checked: event.currentTarget.checked })
        }
      />
      {children}
    </label>
  );

  return {
    Badge: passthrough,
    Box: passthrough,
    Button,
    Flex: passthrough,
    Portal: passthrough,
    Text: passthrough,
    Checkbox: {
      Root: CheckboxRoot,
      HiddenInput: () => null,
      Control: passthrough,
      Indicator: () => null,
      Label: passthrough,
    },
    Popover: {
      Root: passthrough,
      Trigger: passthrough,
      Positioner: passthrough,
      Content: passthrough,
      Arrow: () => null,
      Body: passthrough,
    },
  };
});

const marker = (
  id: string,
  type: StrategyEvidenceMarker['type'],
): StrategyEvidenceMarker => ({
  id,
  type,
  timestamp: 1_700_000_000_000,
  label: `${type} event`,
  summary: `${type} summary`,
  artifactId: 'artifact-1',
  artifactSha256: 'a'.repeat(64),
});

describe('StrategyEvidencePopover', () => {
  it('keeps required markers and filters only parity and recommendations', () => {
    const markers = (['G', 'L', 'E', 'D', 'P', 'R'] as const).map((type) =>
      marker(type, type),
    );

    expect(
      filterStrategyEvidenceMarkers({
        markers,
        showParity: false,
        showRecommendations: false,
      }).map(({ type }) => type),
    ).toEqual(['G', 'L', 'E', 'D']);
  });

  it('shows explicit missing evidence without a mutable fallback', () => {
    const timeline: StrategyEvidenceTimeline = {
      status: 'missing',
      observedFrom: null,
      markers: [],
    };

    render(
      <StrategyEvidencePopover
        timeline={timeline}
        showParity
        showRecommendations
        onShowParityChange={jest.fn()}
        onShowRecommendationsChange={jest.fn()}
      />,
    );

    expect(screen.getByLabelText('Evidence: missing')).toBeTruthy();
    expect(
      screen.getByText(/No checksum-verified evidence artifact is available/),
    ).toBeTruthy();
    expect(screen.getByText(/No mutable fallback is used/)).toBeTruthy();
  });

  it('exposes filters and checksum provenance inside the popover', () => {
    const onShowParityChange = jest.fn();
    const onShowRecommendationsChange = jest.fn();
    const timeline: StrategyEvidenceTimeline = {
      status: 'verified',
      observedFrom: 1_699_999_000_000,
      markers: [marker('parity', 'P'), marker('recommendation', 'R')],
    };

    render(
      <StrategyEvidencePopover
        timeline={timeline}
        showParity
        showRecommendations
        onShowParityChange={onShowParityChange}
        onShowRecommendationsChange={onShowRecommendationsChange}
      />,
    );

    expect(screen.getByText('Artifact provenance')).toBeTruthy();
    expect(screen.getByText(/artifact-1 · aaaaaaaaaaaa/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Parity (P)'));
    fireEvent.click(screen.getByLabelText('Recommendations (R)'));

    expect(onShowParityChange).toHaveBeenCalledWith(false);
    expect(onShowRecommendationsChange).toHaveBeenCalledWith(false);
  });
});
