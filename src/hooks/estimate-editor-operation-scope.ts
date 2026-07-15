export type EstimateEditorOperationScope = {
  routeVersionId: string;
  versionId: string;
  generation: number;
};

export function isEstimateEditorOperationScopeCurrent(
  scope: EstimateEditorOperationScope,
  current: {
    routeVersionId: string;
    versionId: string | null;
    generation: number;
  }
) {
  return (
    current.routeVersionId === scope.routeVersionId &&
    current.versionId === scope.versionId &&
    current.generation === scope.generation
  );
}
