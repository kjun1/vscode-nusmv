import type { Range, TextDocumentPositionParams } from 'vscode-languageserver';

export const specificationUsesRequest = 'nusmv/findSpecificationUses';

export interface SpecificationUsesParams extends TextDocumentPositionParams {
    /** Workspace files found by VS Code with the user's file exclusions. */
    files: string[]
}

export interface SpecificationUse {
    uri: string
    range: Range
    label: string
}

export interface SpecificationUsesResult {
    symbol: string | null
    uses: SpecificationUse[]
    unreadable: number
}
