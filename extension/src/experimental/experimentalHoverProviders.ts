import * as vscode from "vscode";

/**
 * Experiment 1: Test if returning `null` allows VS Code defaults through.
 *
 * Hypothesis: Returning null should let VS Code's built-in hovers show.
 * The VS Code API docs say: "Return null if there is no hover."
 */
export class NullReturningHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.Hover | null {
    console.log(
      "[Experiment 1] NullReturningHoverProvider called at",
      position.line,
      position.character
    );
    // Always return null - should allow VS Code defaults to show
    return null;
  }
}

/**
 * Experiment 2: Test if returning a Hover object suppresses VS Code defaults.
 *
 * Hypothesis: Returning a Hover may or may not suppress - VS Code's hover
 * system is additive, so multiple hovers might combine.
 */
export class AlwaysReturnHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.Hover | null {
    console.log(
      "[Experiment 2] AlwaysReturnHoverProvider called at",
      position.line,
      position.character
    );
    const lineText = document.lineAt(position.line).text;

    // Return a simple hover for any non-empty line
    if (lineText.trim().length > 0) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown("**🧪 Experiment 2: Custom Hover**\n\n");
      md.appendMarkdown(
        `Line ${position.line + 1}, Column ${position.character + 1}`
      );
      return new vscode.Hover(md);
    }
    return null;
  }
}

/**
 * Experiment 3: Conditional hover - only returns Hover for specific patterns.
 *
 * Hypothesis: VS Code defaults should show when we return null,
 * and be combined with our hover when we return a Hover object.
 */
export class ConditionalHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.Hover | null {
    const lineText = document.lineAt(position.line).text;
    console.log(
      "[Experiment 3] ConditionalHoverProvider called at",
      position.line,
      position.character
    );

    // Only provide hover for lines starting with "function" or "const" or "class"
    const trimmedLine = lineText.trim();
    if (
      trimmedLine.startsWith("function ") ||
      trimmedLine.startsWith("const ") ||
      trimmedLine.startsWith("class ") ||
      trimmedLine.startsWith("export ")
    ) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown("**🧪 Experiment 3: Conditional Match**\n\n");
      md.appendMarkdown(`Matched pattern on line ${position.line + 1}`);
      return new vscode.Hover(md);
    }

    // Return null for all other lines - should allow defaults
    return null;
  }
}

/**
 * Experiment 4a: First provider in a multi-provider test.
 * Tests additive behavior when multiple providers are registered.
 */
export class FirstHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.Hover | null {
    console.log(
      "[Experiment 4a] FirstHoverProvider called at",
      position.line,
      position.character
    );
    const lineText = document.lineAt(position.line).text;

    if (lineText.trim().length > 0) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown("**🥇 First Provider**\n\n");
      md.appendMarkdown("Registered first in the chain.");
      return new vscode.Hover(md);
    }
    return null;
  }
}

/**
 * Experiment 4b: Second provider in a multi-provider test.
 * Tests additive behavior when multiple providers are registered.
 */
export class SecondHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.Hover | null {
    console.log(
      "[Experiment 4b] SecondHoverProvider called at",
      position.line,
      position.character
    );
    const lineText = document.lineAt(position.line).text;

    if (lineText.trim().length > 0) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown("**🥈 Second Provider**\n\n");
      md.appendMarkdown("Registered second in the chain.");
      return new vscode.Hover(md);
    }
    return null;
  }
}

/**
 * Experiment 4c: Third provider - sometimes returns null.
 * Tests behavior when some providers return null in the chain.
 */
export class ThirdHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.Hover | null {
    console.log(
      "[Experiment 4c] ThirdHoverProvider called at",
      position.line,
      position.character
    );
    const lineText = document.lineAt(position.line).text;

    // Only return hover for lines containing "import" or "export"
    if (lineText.includes("import") || lineText.includes("export")) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown("**🥉 Third Provider (Conditional)**\n\n");
      md.appendMarkdown("Only shows for import/export statements.");
      return new vscode.Hover(md);
    }

    // Return null for other lines
    return null;
  }
}

/**
 * Experiment 5: High-priority hover provider.
 * Tests if VS Code respects any priority concept in registration order.
 */
export class HighPriorityHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.Hover | null {
    console.log(
      "[Experiment 5] HighPriorityHoverProvider called at",
      position.line,
      position.character
    );
    const lineText = document.lineAt(position.line).text;

    if (lineText.trim().length > 0) {
      const md = new vscode.MarkdownString();
      md.appendMarkdown("**⚡ High Priority Provider**\n\n");
      md.appendMarkdown("Registered with high priority intent.");
      return new vscode.Hover(md);
    }
    return null;
  }
}

/**
 * Experiment 6: Async hover provider that takes time to resolve.
 * Tests if VS Code waits for promises or shows partial results.
 */
export class AsyncHoverProvider implements vscode.HoverProvider {
  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    console.log(
      "[Experiment 6] AsyncHoverProvider called at",
      position.line,
      position.character
    );
    const lineText = document.lineAt(position.line).text;

    if (lineText.trim().length === 0) return null;

    // Simulate async delay (500ms)
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 500);
      _token.onCancellationRequested(() => {
        clearTimeout(timeout);
        resolve();
      });
    });

    if (_token.isCancellationRequested) {
      console.log("[Experiment 6] Cancelled during async wait");
      return null;
    }

    const md = new vscode.MarkdownString();
    md.appendMarkdown("**⏱️ Async Provider**\n\n");
    md.appendMarkdown("This provider waited 500ms before responding.");
    return new vscode.Hover(md);
  }
}

/**
 * Experiment 7: Provider that returns undefined instead of null.
 * Tests VS Code's handling of undefined vs null.
 */
export class UndefinedReturningHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.Hover | undefined {
    console.log(
      "[Experiment 7] UndefinedReturningHoverProvider called at",
      position.line,
      position.character
    );
    // Return undefined - semantically different from null in JS
    return undefined;
  }
}

/**
 * Experiment 8: Empty content hover provider.
 * Tests if VS Code shows empty hovers or treats them like null.
 */
export class EmptyContentHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.Hover | null {
    console.log(
      "[Experiment 8] EmptyContentHoverProvider called at",
      position.line,
      position.character
    );
    const lineText = document.lineAt(position.line).text;

    if (lineText.trim().length > 0) {
      // Return a hover with empty content
      return new vscode.Hover(new vscode.MarkdownString(""));
    }
    return null;
  }
}

export type ExperimentMode =
  | "null-returning"
  | "always-return"
  | "conditional"
  | "multi-provider"
  | "async"
  | "undefined"
  | "empty-content"
  | "registration-order-high-first"
  | "registration-order-high-last"
  | "registration-order-first-second-high";

/**
 * Returns all experimental providers for a given experiment mode.
 */
export function getExperimentalProviders(
  mode: ExperimentMode
): vscode.HoverProvider[] {
  switch (mode) {
    case "null-returning":
      return [new NullReturningHoverProvider()];
    case "always-return":
      return [new AlwaysReturnHoverProvider()];
    case "conditional":
      return [new ConditionalHoverProvider()];
    case "multi-provider":
      return [
        new FirstHoverProvider(),
        new SecondHoverProvider(),
        new ThirdHoverProvider(),
      ];
    case "async":
      return [
        new FirstHoverProvider(),
        new AsyncHoverProvider(),
        new SecondHoverProvider(),
      ];
    case "undefined":
      return [new UndefinedReturningHoverProvider()];
    case "empty-content":
      return [new EmptyContentHoverProvider()];
    case "registration-order-high-first":
      // High priority registered first - expect ⚡ to appear at top
      console.log("[Experiment 5a] Order: High → First → Second");
      return [
        new HighPriorityHoverProvider(),
        new FirstHoverProvider(),
        new SecondHoverProvider(),
      ];
    case "registration-order-high-last":
      // High priority registered last - expect ⚡ to appear at bottom
      console.log("[Experiment 5b] Order: First → Second → High");
      return [
        new FirstHoverProvider(),
        new SecondHoverProvider(),
        new HighPriorityHoverProvider(),
      ];
    case "registration-order-first-second-high":
      // Alternate order for comparison - First, High, Second
      console.log("[Experiment 5c] Order: First → High → Second");
      return [
        new FirstHoverProvider(),
        new HighPriorityHoverProvider(),
        new SecondHoverProvider(),
      ];
    default:
      return [];
  }
}
