'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getBulkSelectionState,
  pruneSelection,
  removeSelectedIds,
  sameIds,
  setSelectionForId,
  setSelectionForScope,
} from './utils';

interface UseBulkSelectionOptions {
  scopeIds: readonly string[];
  validIds?: readonly string[];
  enabled?: boolean;
}

export const useBulkSelection = ({
  scopeIds,
  validIds = scopeIds,
  enabled = true,
}: UseBulkSelectionOptions) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    setSelectedIds((prev) => {
      if (!enabled) {
        return prev.length === 0 ? prev : [];
      }

      const next = pruneSelection({ selectedIds: prev, validIds });
      return sameIds(prev, next) ? prev : next;
    });
  }, [enabled, validIds]);

  const state = useMemo(
    () =>
      getBulkSelectionState({
        selectedIds,
        scopeIds: enabled ? scopeIds : [],
      }),
    [enabled, scopeIds, selectedIds],
  );

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggleSelection = useCallback(
    (id: string, checked: boolean) => {
      if (!enabled) {
        return;
      }

      setSelectedIds((prev) =>
        setSelectionForId({ selectedIds: prev, id, checked }),
      );
    },
    [enabled],
  );

  const setScopeSelected = useCallback(
    (checked: boolean) => {
      if (!enabled) {
        return;
      }

      setSelectedIds((prev) =>
        setSelectionForScope({
          selectedIds: prev,
          scopeIds,
          checked,
        }),
      );
    },
    [enabled, scopeIds],
  );

  const removeSelection = useCallback((idsToRemove: readonly string[]) => {
    setSelectedIds((prev) =>
      removeSelectedIds({ selectedIds: prev, idsToRemove }),
    );
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds((prev) => (prev.length === 0 ? prev : []));
  }, []);

  return {
    selectedIds,
    selectedIdSet,
    ...state,
    toggleSelection,
    setScopeSelected,
    removeSelection,
    clearSelection,
  };
};
