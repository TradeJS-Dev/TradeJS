import { act, renderHook } from '@testing-library/react';
import { useBulkSelection } from '../useBulkSelection';

describe('useBulkSelection', () => {
  it('selects current scope while preserving selection outside the filter', () => {
    const { result, rerender } = renderHook(
      ({ scopeIds, validIds }: { scopeIds: string[]; validIds: string[] }) =>
        useBulkSelection({ scopeIds, validIds }),
      {
        initialProps: {
          scopeIds: ['one', 'two'],
          validIds: ['one', 'two', 'outside'],
        },
      },
    );

    act(() => {
      result.current.toggleSelection('outside', true);
      result.current.setScopeSelected(true);
    });

    expect(result.current.selectedIds).toEqual(['outside', 'one', 'two']);
    expect(result.current.selectedScopedCount).toBe(2);
    expect(result.current.checkboxState).toBe(true);

    rerender({
      scopeIds: ['two'],
      validIds: ['one', 'two', 'outside'],
    });

    expect(result.current.selectedIds).toEqual(['outside', 'one', 'two']);
    expect(result.current.selectedScopedCount).toBe(1);
    expect(result.current.checkboxState).toBe(true);

    act(() => {
      result.current.setScopeSelected(false);
    });

    expect(result.current.selectedIds).toEqual(['outside', 'one']);
  });

  it('prunes missing ids and clears selection when disabled', () => {
    const { result, rerender } = renderHook(
      ({ validIds, enabled }: { validIds: string[]; enabled: boolean }) =>
        useBulkSelection({
          scopeIds: validIds,
          validIds,
          enabled,
        }),
      {
        initialProps: {
          validIds: ['one', 'two'],
          enabled: true,
        },
      },
    );

    act(() => {
      result.current.setScopeSelected(true);
    });

    expect(result.current.selectedIds).toEqual(['one', 'two']);

    rerender({
      validIds: ['two'],
      enabled: true,
    });

    expect(result.current.selectedIds).toEqual(['two']);

    rerender({
      validIds: ['two'],
      enabled: false,
    });

    expect(result.current.selectedIds).toEqual([]);
    expect(result.current.checkboxState).toBe(false);
  });
});
