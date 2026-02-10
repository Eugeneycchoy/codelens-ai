#!/usr/bin/env node
/**
 * Progressive validation script for the VS Code extension project.
 * Detects project stage (pre-install, post-install, post-build) and validates
 * only what exists. Uses Node.js built-in modules only.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PROJECT_ROOT = process.cwd();
const PASS = "✓";
const FAIL = "✗";
const SKIP = "⊘";

// ---------------------------------------------------------------------------
// Stage Detection
// ---------------------------------------------------------------------------

function detectProjectStage() {
  const nodeModulesPath = path.join(PROJECT_ROOT, "node_modules");
  const distPath = path.join(PROJECT_ROOT, "dist");
  return {
    hasDependencies: fs.existsSync(nodeModulesPath),
    hasBuild: fs.existsSync(distPath),
  };
}

// ---------------------------------------------------------------------------
// Project Structure Validation
// ---------------------------------------------------------------------------

function validateProjectStructure() {
  const results = [];
  const required = [
    { path: path.join(PROJECT_ROOT, "package.json"), name: "package.json" },
    { path: path.join(PROJECT_ROOT, "tsconfig.json"), name: "tsconfig.json" },
    { path: path.join(PROJECT_ROOT, "src"), name: "src/ directory" },
  ];
  const optional = [
    { path: path.join(PROJECT_ROOT, ".vscode"), name: ".vscode/ directory" },
  ];

  for (const { path: filePath, name } of required) {
    const exists = fs.existsSync(filePath);
    const isDir = name.includes("directory");
    const ok = isDir
      ? fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()
      : exists;
    results.push({
      category: "Structure",
      ok,
      message: ok ? `${name} exists` : `${name} missing`,
      remediation: ok
        ? null
        : name === "src/ directory"
        ? "Create src/ and add extension source files."
        : `Ensure ${name} exists in project root.`,
    });
  }

  for (const { path: filePath, name } of optional) {
    const exists = fs.existsSync(filePath);
    results.push({
      category: "Structure",
      ok: exists,
      skipped: !exists,
      optional: true,
      message: exists ? `${name} exists` : `${name} missing`,
      remediation: !exists
        ? "Recommended: Create .vscode/launch.json for debugging"
        : null,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Configuration File Validation
// ---------------------------------------------------------------------------

function validatePackageJson() {
  const results = [];
  const packagePath = path.join(PROJECT_ROOT, "package.json");

  let pkg;
  try {
    const content = fs.readFileSync(packagePath, "utf8");
    pkg = JSON.parse(content);
  } catch (err) {
    results.push({
      category: "Configuration",
      ok: false,
      message: "package.json is invalid",
      remediation:
        err instanceof SyntaxError
          ? "Fix JSON syntax in package.json"
          : `Cannot read package.json: ${err.message}`,
    });
    return results;
  }

  results.push({
    category: "Configuration",
    ok: true,
    message: "package.json is valid JSON",
  });

  const requiredFields = [
    ["name", "name"],
    ["version", "version"],
    ["engines.vscode", (o) => o.engines && o.engines.vscode],
    ["main", "main"],
    ["scripts.build", (o) => o.scripts && o.scripts.build],
  ];

  for (const [fieldName, accessor] of requiredFields) {
    const value =
      typeof accessor === "function" ? accessor(pkg) : pkg[accessor];
    const ok = value != null && value !== "";
    results.push({
      category: "Configuration",
      ok,
      message: ok
        ? `Required field "${fieldName}" present`
        : `Missing or empty: ${fieldName}`,
      remediation: ok ? null : `Add or set "${fieldName}" in package.json.`,
    });
  }

  const mainOk = pkg.main === "./dist/extension.js";
  results.push({
    category: "Configuration",
    ok: mainOk,
    message: mainOk
      ? "Main entry point configured correctly"
      : 'Main entry point should be "./dist/extension.js"',
    remediation: mainOk
      ? null
      : 'Set "main": "./dist/extension.js" in package.json.',
  });

  const requiredDeps = ["typescript", "esbuild", "@types/vscode"];
  const devDeps = pkg.devDependencies || {};
  const deps = { ...(pkg.dependencies || {}), ...devDeps };
  for (const dep of requiredDeps) {
    const present = dep in deps;
    results.push({
      category: "Configuration",
      ok: present,
      message: present
        ? `Dependency "${dep}" declared`
        : `Missing dependency: ${dep}`,
      remediation: present
        ? null
        : `Add "${dep}" to devDependencies (or dependencies) and run npm install.`,
    });
  }

  return results;
}

function validateTsConfig() {
  const results = [];
  const tsconfigPath = path.join(PROJECT_ROOT, "tsconfig.json");

  let config;
  try {
    const content = fs.readFileSync(tsconfigPath, "utf8");
    config = JSON.parse(content);
  } catch (err) {
    results.push({
      category: "Configuration",
      ok: false,
      message: "tsconfig.json is invalid",
      remediation:
        err instanceof SyntaxError
          ? "Fix JSON syntax in tsconfig.json"
          : `Cannot read tsconfig.json: ${err.message}`,
    });
    return results;
  }

  results.push({
    category: "Configuration",
    ok: true,
    message: "tsconfig.json is valid",
  });

  const opts = config.compilerOptions || {};
  const outDirOk = opts.outDir === "dist";
  results.push({
    category: "Configuration",
    ok: outDirOk,
    message: outDirOk
      ? 'compilerOptions.outDir is "dist"'
      : 'compilerOptions.outDir should be "dist"',
    remediation: outDirOk
      ? null
      : 'Set "compilerOptions.outDir": "dist" in tsconfig.json.',
  });

  const rootDirOk = opts.rootDir === "src";
  results.push({
    category: "Configuration",
    ok: rootDirOk,
    message: rootDirOk
      ? 'compilerOptions.rootDir is "src"'
      : 'compilerOptions.rootDir should be "src"',
    remediation: rootDirOk
      ? null
      : 'Set "compilerOptions.rootDir": "src" in tsconfig.json.',
  });

  const include = config.include || [];
  const includeSrc = Array.isArray(include) && include.includes("src");
  results.push({
    category: "Configuration",
    ok: includeSrc,
    message: includeSrc
      ? 'include contains "src"'
      : 'include should contain "src"',
    remediation: includeSrc ? null : 'Set "include": ["src"] in tsconfig.json.',
  });

  return results;
}

// ---------------------------------------------------------------------------
// Dependency Validation
// ---------------------------------------------------------------------------

function validateDependencies(stage) {
  const results = [];

  if (!stage.hasDependencies) {
    results.push({
      category: "Dependencies",
      ok: true,
      skipped: true,
      message: "Skipped (node_modules/ not found)",
      remediation: "Run: npm install",
    });
    return results;
  }

  const nodeModules = path.join(PROJECT_ROOT, "node_modules");
  results.push({
    category: "Dependencies",
    ok: true,
    message: "node_modules/ directory exists",
  });

  const keyDeps = [
    path.join(nodeModules, "typescript"),
    path.join(nodeModules, "esbuild"),
    path.join(nodeModules, "@types", "vscode"),
  ];
  const names = ["typescript", "esbuild", "@types/vscode"];

  for (let i = 0; i < keyDeps.length; i++) {
    const exists = fs.existsSync(keyDeps[i]);
    results.push({
      category: "Dependencies",
      ok: exists,
      message: exists ? `${names[i]} found` : `Missing: ${names[i]}`,
      remediation: exists ? null : "Run: npm install",
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Build Output Validation
// ---------------------------------------------------------------------------

function validateBuildOutput(stage) {
  const results = [];
  const distJs = path.join(PROJECT_ROOT, "dist", "extension.js");

  if (!stage.hasBuild) {
    results.push({
      category: "Build Output",
      ok: true,
      skipped: true,
      message: "Skipped (dist/ not found)",
      remediation: "Run: npm run build",
    });
    return results;
  }

  if (!fs.existsSync(distJs)) {
    results.push({
      category: "Build Output",
      ok: false,
      message: "dist/extension.js not found",
      remediation: "Run: npm run build",
    });
    return results;
  }

  results.push({
    category: "Build Output",
    ok: true,
    message: "dist/extension.js exists",
  });

  let bundleCode;
  try {
    bundleCode = fs.readFileSync(distJs, "utf8");
  } catch (err) {
    results.push({
      category: "Build Output",
      ok: false,
      message: "Could not read bundle",
      remediation: err.message,
    });
    return results;
  }

  const context = vm.createContext({
    module: { exports: {} },
    exports: {},
    require: () => ({}),
    vscode: {},
    console,
    process,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    globalThis: null,
  });
  context.globalThis = context;

  try {
    const script = new vm.Script(bundleCode);
    script.runInContext(context);
    results.push({
      category: "Build Output",
      ok: true,
      message: "Bundle compiles successfully",
    });
  } catch (error) {
    results.push({
      category: "Build Output",
      ok: false,
      message: "Bundle compilation failed",
      remediation: error.message || String(error),
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Debug Configuration Validation
// ---------------------------------------------------------------------------

function validateDebugConfig() {
  const results = [];
  const vscodeDir = path.join(PROJECT_ROOT, ".vscode");
  const launchPath = path.join(vscodeDir, "launch.json");
  const tasksPath = path.join(vscodeDir, "tasks.json");

  if (!fs.existsSync(launchPath)) {
    results.push({
      category: "Debug Configuration",
      ok: true,
      skipped: true,
      optional: true,
      message: ".vscode/launch.json not found (optional)",
      remediation: null,
    });
  } else {
    let launch;
    try {
      launch = JSON.parse(fs.readFileSync(launchPath, "utf8"));
    } catch (err) {
      results.push({
        category: "Debug Configuration",
        ok: false,
        message: "launch.json is invalid",
        remediation:
          err instanceof SyntaxError
            ? "Fix JSON in .vscode/launch.json"
            : err.message,
      });
    }
    if (launch) {
      const configs = launch.configurations || [];
      const hasExtensionHost = configs.some(
        (c) => c.type === "extensionHost" || c.type === "pwa-extensionHost",
      );
      results.push({
        category: "Debug Configuration",
        ok: hasExtensionHost,
        message: hasExtensionHost
          ? "Extension debug configuration present"
          : "No extensionHost or pwa-extensionHost in launch.json",
        remediation: hasExtensionHost
          ? null
          : 'Add a configuration with "type": "extensionHost" for F5 debugging.',
      });
    }
  }

  if (!fs.existsSync(tasksPath)) {
    results.push({
      category: "Debug Configuration",
      ok: true,
      skipped: true,
      optional: true,
      message: ".vscode/tasks.json not found (optional)",
      remediation: null,
    });
  } else {
    let tasks;
    try {
      tasks = JSON.parse(fs.readFileSync(tasksPath, "utf8"));
    } catch (err) {
      results.push({
        category: "Debug Configuration",
        ok: false,
        message: "tasks.json is invalid",
        remediation:
          err instanceof SyntaxError
            ? "Fix JSON in .vscode/tasks.json"
            : err.message,
      });
    }
    if (tasks) {
      const taskList = tasks.tasks || [];
      const hasBuildTask = taskList.some(
        (t) =>
          (t.label && String(t.label).toLowerCase().includes("build")) ||
          (t.type === "npm" && t.script === "build"),
      );
      results.push({
        category: "Debug Configuration",
        ok: hasBuildTask,
        message: hasBuildTask
          ? "Build task present in tasks.json"
          : "No build task found in tasks.json",
        remediation: hasBuildTask
          ? null
          : "Add a task that runs the build script for preLaunchTask.",
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Output Formatter
// ---------------------------------------------------------------------------

function formatResults(allResults) {
  const lines = [];
  lines.push("Project Validation Results");
  lines.push("==========================");
  lines.push("");

  const categories = [
    "Structure",
    "Configuration",
    "Dependencies",
    "Build Output",
    "Debug Configuration",
  ];
  const stats = { passed: 0, failed: 0, skipped: 0 };

  for (const category of categories) {
    const items = allResults.filter((r) => r.category === category);
    if (items.length === 0) continue;

    lines.push(`[${category}]`);

    for (const r of items) {
      if (r.skipped) {
        lines.push(`${SKIP} ${r.message}`);
        stats.skipped++;
      } else if (r.ok) {
        lines.push(`${PASS} ${r.message}`);
        stats.passed++;
      } else {
        lines.push(`${FAIL} ${r.message}`);
        if (r.optional) stats.skipped++;
        else stats.failed++;
      }
      if (r.remediation) {
        lines.push(`  → ${r.remediation}`);
      }
    }

    lines.push("");
  }

  lines.push(
    `Summary: ${stats.passed} passed, ${stats.failed} failed, ${stats.skipped} skipped`,
  );

  return { output: lines.join("\n"), stats };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const stage = detectProjectStage();

  const allResults = [
    ...validateProjectStructure(),
    ...validatePackageJson(),
    ...validateTsConfig(),
    ...validateDependencies(stage),
    ...validateBuildOutput(stage),
    ...validateDebugConfig(),
  ];

  const { output, stats } = formatResults(allResults);
  console.log(output);

  const hasFailure = stats.failed > 0;
  process.exit(hasFailure ? 1 : 0);
}

main();
