export function getProjectRecordSyncDiff(directoryIds: string[], recordIds: string[]) {
  const directoryIdSet = new Set(directoryIds);
  const recordIdSet = new Set(recordIds);

  return {
    missingRecordIds: directoryIds.filter(projectId => !recordIdSet.has(projectId)),
    staleRecordIds: recordIds.filter(projectId => !directoryIdSet.has(projectId)),
  };
}
