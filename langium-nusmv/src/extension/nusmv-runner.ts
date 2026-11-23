import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export type NuSMVRevealRunOutput = 'always' | 'onFailure' | 'never';
export type NuSMVRunMessageKind = 'info' | 'warning' | 'error';

/** Unquoted executable and arguments for spawn; only the terminal form needs shell quoting. */
export interface NuSMVCommand {
    executable: string
    args: string[]
}

export interface NuSMVSpecResults {
    trueCount: number
    falseCount: number
    totalCount: number
}

export interface NuSMVRunCompletion {
    cancelled: boolean
    elapsedMs: number
    exitCode: number | null
    signal?: NodeJS.Signals | null
    specResults: NuSMVSpecResults
}

export interface NuSMVRunSummary {
    kind: NuSMVRunMessageKind
    message: string
    statusText: string
}

const SPEC_RESULT_PATTERN = /^\s*--\s*specification\b.*?\bis\s+(true|false)\b.*$/gim;

/**
 * Honor an explicit executable path. On Unix, installations use both `nusmv`
 * and `NuSMV`; prefer the original lowercase command when both are available.
 */
export function resolveNuSMVExecutable(configuredPath: string | undefined, platform = process.platform, searchPath = process.env.PATH ?? ''): string {
    if (configuredPath?.trim()) {
        return configuredPath;
    }
    if (platform === 'win32') {
        return 'nusmv.exe';
    }
    for (const name of ['nusmv', 'NuSMV']) {
        for (const directory of searchPath.split(delimiter).filter(Boolean)) {
            const candidate = join(directory, name);
            try {
                accessSync(candidate, constants.X_OK);
                if (statSync(candidate).isFile()) {
                    return name;
                }
            } catch {
                // No executable by this name in this PATH entry.
            }
        }
    }
    return 'nusmv';
}

/**
 * Build arguments for both run commands. A quoted include needs cpp, but a
 * user-selected preprocessor takes precedence. Keep the model path last.
 */
export function buildNuSMVCommand(executable: string, defaultRunArgs: readonly string[], modelPath: string, modelText = ''): NuSMVCommand {
    const args = [...defaultRunArgs];
    if (!args.includes('-pre') && !args.includes('-cpp') && /^[\t ]*#[\t ]*include[\t ]*"[^"\r\n]+"/m.test(modelText)) {
        args.push('-pre', 'cpp');
    }
    return {
        executable,
        args: [...args, modelPath]
    };
}

/** Count specification verdict lines, not the state values in counterexample traces. */
export function parseNuSMVSpecResults(output: string): NuSMVSpecResults {
    let trueCount = 0;
    let falseCount = 0;
    for (const match of output.matchAll(SPEC_RESULT_PATTERN)) {
        if (match[1].toLowerCase() === 'true') {
            trueCount++;
        } else {
            falseCount++;
        }
    }
    return {
        trueCount,
        falseCount,
        totalCount: trueCount + falseCount
    };
}

/**
 * Distinguish a run that did not finish normally from a completed check:
 * NuSMV can exit successfully even when a specification is false.
 */
export function formatNuSMVRunSummary(completion: NuSMVRunCompletion): NuSMVRunSummary {
    const duration = formatDuration(completion.elapsedMs);
    const specSummary = formatSpecSummary(completion.specResults);
    if (completion.cancelled) {
        return {
            kind: 'warning',
            message: `NuSMV run cancelled after ${duration}. ${specSummary}`,
            statusText: 'NuSMV: Cancelled'
        };
    }

    if (completion.exitCode !== 0) {
        const exit = completion.exitCode === null
            ? `signal ${completion.signal ?? 'unknown'}`
            : `code ${completion.exitCode}`;
        return {
            kind: 'error',
            message: `NuSMV exited with ${exit} after ${duration}. ${specSummary}`,
            statusText: 'NuSMV: Error'
        };
    }

    if (completion.specResults.falseCount > 0) {
        return {
            kind: 'warning',
            message: `NuSMV completed with ${completion.specResults.falseCount} failing specification${plural(completion.specResults.falseCount)} after ${duration}. ${specSummary}`,
            statusText: 'NuSMV: Failed'
        };
    }

    if (completion.specResults.totalCount > 0) {
        return {
            kind: 'info',
            message: `NuSMV passed ${completion.specResults.totalCount} specification${plural(completion.specResults.totalCount)} in ${duration}. ${specSummary}`,
            statusText: 'NuSMV: Passed'
        };
    }

    return {
        kind: 'info',
        message: `NuSMV completed in ${duration}. ${specSummary}`,
        statusText: 'NuSMV: Passed'
    };
}

export function shouldRevealRunOutput(mode: NuSMVRevealRunOutput, kind: NuSMVRunMessageKind): boolean {
    return mode === 'always' || (mode === 'onFailure' && kind !== 'info');
}

/** Render a command for terminal input or display; the captured runner passes argv directly. */
export function buildTerminalCommand(command: NuSMVCommand): string {
    return [command.executable, ...command.args].map(quoteShellArg).join(' ');
}

function formatSpecSummary(results: NuSMVSpecResults): string {
    return results.totalCount === 0
        ? 'No specification results found.'
        : `Specs: ${results.trueCount} true, ${results.falseCount} false.`;
}

function formatDuration(elapsedMs: number): string {
    return elapsedMs < 1000
        ? `${elapsedMs}ms`
        : `${(elapsedMs / 1000).toFixed(1)}s`;
}

function plural(count: number): string {
    return count === 1 ? '' : 's';
}

function quoteShellArg(arg: string): string {
    if (/^[A-Za-z0-9_./:=-]+$/.test(arg)) {
        return arg;
    }
    return `"${arg.replace(/(["\\$`])/g, '\\$1')}"`;
}
