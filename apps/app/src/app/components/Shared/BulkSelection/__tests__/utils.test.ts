import {
  getBulkSelectionState,
  getScopedSelectedIds,
  pruneSelection,
  removeSelectedIds,
  setSelectionForId,
  setSelectionForScope,
  uniqueIds,
} from '../utils';

describe('bulk selection utils', () => {
  it('keeps ids unique in insertion order', () => {
    expect(uniqueIds(['one', 'two', 'one', 'three', 'two'])).toEqual([
      'one',
      'two',
      'three',
    ]);
  });

  it('computes scoped checkbox state for empty, partial, and full selection', () => {
    expect(
      getBulkSelectionState({
        selectedIds: ['outside'],
        scopeIds: ['one', 'two'],
      }),
    ).toMatchObject({
      selectedScopedCount: 0,
      allScopedSelected: false,
      hasScopedSelection: false,
      checkboxState: false,
    });

    expect(
      getBulkSelectionState({
        selectedIds: ['outside', 'one'],
        scopeIds: ['one', 'two'],
      }),
    ).toMatchObject({
      selectedScopedCount: 1,
      allScopedSelected: false,
      hasScopedSelection: true,
      checkboxState: 'indeterminate',
    });

    expect(
      getBulkSelectionState({
        selectedIds: ['two', 'one', 'outside'],
        scopeIds: ['one', 'two', 'two'],
      }),
    ).toMatchObject({
      selectedScopedIds: ['two', 'one'],
      selectedScopedCount: 2,
      allScopedSelected: true,
      hasScopedSelection: true,
      checkboxState: true,
    });
  });

  it('selects and unselects a single id without duplicating it', () => {
    expect(
      setSelectionForId({
        selectedIds: ['one'],
        id: 'one',
        checked: true,
      }),
    ).toEqual(['one']);

    expect(
      setSelectionForId({
        selectedIds: ['one'],
        id: 'two',
        checked: true,
      }),
    ).toEqual(['one', 'two']);

    expect(
      setSelectionForId({
        selectedIds: ['one', 'two'],
        id: 'one',
        checked: false,
      }),
    ).toEqual(['two']);
  });

  it('selects or clears only ids in the current scope', () => {
    expect(
      setSelectionForScope({
        selectedIds: ['outside', 'one'],
        scopeIds: ['one', 'two', 'two'],
        checked: true,
      }),
    ).toEqual(['outside', 'one', 'two']);

    expect(
      setSelectionForScope({
        selectedIds: ['outside', 'one', 'two'],
        scopeIds: ['one', 'two'],
        checked: false,
      }),
    ).toEqual(['outside']);
  });

  it('removes deleted ids and prunes ids that no longer exist', () => {
    expect(
      removeSelectedIds({
        selectedIds: ['one', 'two', 'three'],
        idsToRemove: ['two'],
      }),
    ).toEqual(['one', 'three']);

    expect(
      pruneSelection({
        selectedIds: ['one', 'two', 'three'],
        validIds: ['two', 'three', 'four'],
      }),
    ).toEqual(['two', 'three']);
  });

  it('returns selected ids scoped to the current filtered list', () => {
    expect(
      getScopedSelectedIds({
        selectedIds: ['one', 'two', 'one', 'three'],
        scopeIds: ['three', 'one'],
      }),
    ).toEqual(['one', 'three']);
  });
});
