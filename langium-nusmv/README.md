# NuSMV for VS Code (LiCRuM)

NuSMV language support for Visual Studio Code, powered by a TypeScript Langium language server.

## Features

- Syntax highlighting for `.smv` files
- Real-time semantic analysis while editing
- NuSMV expression and model validation
- Captured, cancellable `NuSMV: Run Current Model` command with output summaries
- Raw terminal fallback via `NuSMV: Run Current Model in Terminal`
- Configurable option to skip semantic checks for very large files

## Split a model from its checks

Put the reusable module in its own file, for example `door.smv`:

```smv
MODULE door
VAR open : boolean;
```

Include that file from the model you want to run:

```smv
#include "door.smv"
MODULE main
VAR entry : door;
CTLSPEC EF entry.open
```

Paths are relative to the file containing the directive. The editor looks for
modules in the current file and in the `.smv` files it includes, directly or
through nested includes. Go to Definition on `door` or `open` takes you to the
included file. Includes are for complete modules: the language server does not
run a preprocessor, splice in fragments of a module, or expand macros.

Hover over `entry.open` to see the declaration of the member under the pointer.
When you type `entry.`, the member suggestions include declaration details: for
a `DEFINE`, you can read its expression before inserting the name.

To navigate the other way, place the cursor on `open` in `door.smv` and choose
**NuSMV: Find Specifications Using Symbol** from the editor context menu.
This searches open models and local `.smv` files in the workspace for checks
that directly reference that declaration. One match opens immediately; with
several matches, choose by specification and file. It does not count an indirect
use through another `DEFINE` or a same-named member in a different module.

Save any edited dependencies, then run **NuSMV: Run Current Model** from the
file containing `MODULE main`.
The runner adds `-pre cpp` for quoted includes unless you already selected
a preprocessor in `nusmv.defaultRunArgs`. NuSMV and its preprocessor must
be installed to run checks; neither is needed for editor navigation.

## Settings

- `nusmv.disableSemanticChecksOnLargeFiles`
- `nusmv.semanticChecksMaxLines`
- `nusmv.executablePath`
- `nusmv.defaultRunArgs`
- `nusmv.revealRunOutput`
