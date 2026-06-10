export type BulkCheckboxState = boolean | 'indeterminate';

export const uniqueIds = (ids: readonly string[]) => Array.from(new Set(ids));

export const sameIds = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

export const getScopedSelectedIds = ({
  selectedIds,
  scopeIds,
}: {
  selectedIds: readonly string[];
  scopeIds: readonly string[];
}) => {
  const scopeSet = new Set(scopeIds);

  return uniqueIds(selectedIds).filter((id) => scopeSet.has(id));
};

export const getBulkSelectionState = ({
  selectedIds,
  scopeIds,
}: {
  selectedIds: readonly string[];
  scopeIds: readonly string[];
}) => {
  const uniqueScopeIds = uniqueIds(scopeIds);
  const selectedScopedIds = getScopedSelectedIds({
    selectedIds,
    scopeIds: uniqueScopeIds,
  });
  const selectedScopedCount = selectedScopedIds.length;
  const allScopedSelected =
    uniqueScopeIds.length > 0 && selectedScopedCount === uniqueScopeIds.length;
  const hasScopedSelection = selectedScopedCount > 0;
  const checkboxState: BulkCheckboxState = allScopedSelected
    ? true
    : hasScopedSelection
      ? 'indeterminate'
      : false;

  return {
    selectedScopedIds,
    selectedScopedCount,
    allScopedSelected,
    hasScopedSelection,
    checkboxState,
  };
};

export const setSelectionForId = ({
  selectedIds,
  id,
  checked,
}: {
  selectedIds: readonly string[];
  id: string;
  checked: boolean;
}) => {
  const uniqueSelectedIds = uniqueIds(selectedIds);

  if (!checked) {
    return uniqueSelectedIds.filter((selectedId) => selectedId !== id);
  }

  if (uniqueSelectedIds.includes(id)) {
    return uniqueSelectedIds;
  }

  return [...uniqueSelectedIds, id];
};

export const setSelectionForScope = ({
  selectedIds,
  scopeIds,
  checked,
}: {
  selectedIds: readonly string[];
  scopeIds: readonly string[];
  checked: boolean;
}) => {
  const uniqueSelectedIds = uniqueIds(selectedIds);
  const uniqueScopeIds = uniqueIds(scopeIds);
  const scopeSet = new Set(uniqueScopeIds);

  if (!checked) {
    return uniqueSelectedIds.filter((id) => !scopeSet.has(id));
  }

  const nextSet = new Set(uniqueSelectedIds);
  const nextIds = [...uniqueSelectedIds];

  for (const id of uniqueScopeIds) {
    if (!nextSet.has(id)) {
      nextSet.add(id);
      nextIds.push(id);
    }
  }

  return nextIds;
};

export const removeSelectedIds = ({
  selectedIds,
  idsToRemove,
}: {
  selectedIds: readonly string[];
  idsToRemove: readonly string[];
}) => {
  const removedSet = new Set(idsToRemove);

  return uniqueIds(selectedIds).filter((id) => !removedSet.has(id));
};

export const pruneSelection = ({
  selectedIds,
  validIds,
}: {
  selectedIds: readonly string[];
  validIds: readonly string[];
}) => {
  const validSet = new Set(validIds);

  return uniqueIds(selectedIds).filter((id) => validSet.has(id));
};
