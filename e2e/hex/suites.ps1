Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-HexSuites {
  $all = @(
    "prices-page.ps1",
    "ti-140-epic.ps1",
    "est-101-keyboard.ps1",
    "est-102-inline-edit.ps1",
    "est-103-multiselect.ps1",
    "est-104-clipboard.ps1",
    "est-106-undo-redo.ps1",
    "est-030-supplier-comparison.ps1",
    "est-164-catalogue-suggestions.ps1",
    "ti-143-navigation.ps1",
    "ti-144-list.ps1",
    "ti-145-create.ps1",
    "ti-146-parameters.ps1",
    "ti-147-editor.ps1",
    "ti-148-calculations.ps1",
    "ti-149-duplicate.ps1",
    "ti-182-assemblies.ps1",
    "ti-150-status.ps1",
    "ti-151-print.ps1",
    "ti-152-export.ps1",
    "ti-153-suggestions.ps1",
    "ti-141-db-rls.ps1",
    "ti-142-types.ps1",
    "dpgf-import-flow.ps1"
  )

  return [ordered]@{
    quick = @(
      "ti-145-create.ps1",
      "ti-147-editor.ps1",
      "ti-148-calculations.ps1",
      "ti-150-status.ps1"
    )
    dpgf = @(
      "dpgf-import-flow.ps1"
    )
    editor = @(
      "est-101-keyboard.ps1",
      "est-102-inline-edit.ps1",
      "est-103-multiselect.ps1",
      "est-104-clipboard.ps1",
      "est-106-undo-redo.ps1",
      "est-030-supplier-comparison.ps1",
      "ti-147-editor.ps1",
      "est-164-catalogue-suggestions.ps1"
    )
    lifecycle = @(
      "ti-143-navigation.ps1",
      "ti-144-list.ps1",
      "ti-145-create.ps1",
      "ti-149-duplicate.ps1",
      "ti-150-status.ps1"
    )
    output = @(
      "ti-151-print.ps1",
      "ti-152-export.ps1"
    )
    settings = @(
      "ti-146-parameters.ps1",
      "ti-153-suggestions.ps1",
      "ti-142-types.ps1"
    )
    security = @(
      "ti-141-db-rls.ps1"
    )
    assemblies = @(
      "ti-182-assemblies.ps1"
    )
    catalogue = @(
      "prices-page.ps1"
    )
    all = $all
  }
}
