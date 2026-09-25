"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");

const {
  CheckStatus,
  CheckType,
} = require("./contracts");

const PACKAGE_MANAGERS =
  new Set([
    "npm",
    "pnpm",
    "yarn",
    "bun",
  ]);

const CHECK_NAMES =
  new Set([
    "lint",
    "typecheck",
    "test",
    "build",
  ]);

const REQUIRED_GATES =
  Object.freeze([
    CheckType.LINT,
    CheckType.TYPECHECK,
    CheckType.TEST,
    CheckType.BUILD,
  ]);

function normalizeRel(value) {
  const rel = String(value ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");

  if (
    !rel ||
    path.posix.isAbsolute(rel) ||
    /^[A-Za-z]:\//.test(rel) ||
    rel.split("/").includes("..")
  ) {
    throw new Error(
      `VERIFY_PATH_INVALID:${rel || "<empty>"}`
    );
  }

  return rel;
}

function protectedPath(value) {
  const rel = normalizeRel(value)
    .toLowerCase();

  return (
    rel === ".git" ||
    rel.startsWith(".git/") ||
    rel.includes("/.git/") ||
    rel === "secrets" ||
    rel.startsWith("secrets/") ||
    rel.includes("/secrets/") ||
    /(^|\/)\.env($|\.)/.test(rel) ||
    /\.(pem|key|p12|pfx)$/.test(rel)
  );
}

function directExec(
  command,
  args,
  cwd,
  timeout = 600000
) {
  const start =
    performance.now();

  const proc =
    spawnSync(
      command,
      args,
      {
        cwd,
        timeout,
        encoding: "utf8",
        shell: false,
        windowsHide: true,
      }
    );

  const duration_ms =
    Math.round(
      performance.now() - start
    );

  const timedOut =
    proc.error?.code === "ETIMEDOUT";

  return {
    code:
      typeof proc.status === "number"
        ? proc.status
        : timedOut
          ? 124
          : 1,

    signal:
      proc.signal ?? null,

    timedOut,

    error:
      proc.error
        ? String(
            proc.error.message ||
            proc.error
          )
        : "",

    stdout:
      String(
        proc.stdout ?? ""
      ),

    stderr:
      String(
        proc.stderr ?? ""
      ),

    duration_ms,
  };
}

function windowsCmdPath() {
  const root =
    process.env.SystemRoot ||
    process.env.WINDIR ||
    "C:\\Windows";

  return path.join(
    root,
    "System32",
    "cmd.exe"
  );
}

function runPackageScript(
  pm,
  script,
  cwd,
  timeout = 600000
) {
  if (
    !PACKAGE_MANAGERS.has(pm)
  ) {
    throw new Error(
      `Unsupported package manager executable: ${pm}`
    );
  }

  if (
    !CHECK_NAMES.has(script)
  ) {
    throw new Error(
      `Unsupported verification script: ${script}`
    );
  }

  /*
   * Windows .cmd shims require cmd.exe.
   * Only the two already validated allowlist tokens
   * are inserted into this command line.
   */
  if (
    process.platform === "win32" &&
    pm !== "bun"
  ) {
    const commandLine =
      `${pm}.cmd run ${script}`;

    return directExec(
      windowsCmdPath(),
      [
        "/d",
        "/s",
        "/c",
        commandLine,
      ],
      cwd,
      timeout
    );
  }

  return directExec(
    pm,
    [
      "run",
      script,
    ],
    cwd,
    timeout
  );
}

function packageManager(
  repo,
  pkg
) {
  const declared =
    String(
      pkg?.packageManager ||
      ""
    ).trim();

  if (declared) {
    const name =
      declared
        .split("@")[0]
        .trim();

    if (
      PACKAGE_MANAGERS.has(
        name
      )
    ) {
      return name;
    }
  }

  if (
    fs.existsSync(
      path.join(
        repo,
        "pnpm-lock.yaml"
      )
    )
  ) {
    return "pnpm";
  }

  if (
    fs.existsSync(
      path.join(
        repo,
        "yarn.lock"
      )
    )
  ) {
    return "yarn";
  }

  if (
    fs.existsSync(
      path.join(
        repo,
        "bun.lockb"
      )
    ) ||
    fs.existsSync(
      path.join(
        repo,
        "bun.lock"
      )
    )
  ) {
    return "bun";
  }

  return "npm";
}

function notConfigured(
  reason = "NO_CHECKS_FOUND"
) {
  return [
    {
      name: "verification",
      check_type: CheckType.TEST,
      configured: false,
      status: CheckStatus.NOT_CONFIGURED,
      command: "",
      code: null,
      signal: null,
      timedOut: false,
      error: reason,
      executed: false,
      duration_ms: 0,
      stdout: "",
      stderr: "",
    },
  ];
}

function runChecks(repo) {
  const packagePath =
    path.join(
      repo,
      "package.json"
    );

  if (
    !fs.existsSync(
      packagePath
    )
  ) {
    return notConfigured(
      "NO_PACKAGE_JSON"
    );
  }

  const pkg =
    JSON.parse(
      fs.readFileSync(
        packagePath,
        "utf8"
      ).replace(
        /^\uFEFF/,
        ""
      )
    );

  const pm =
    packageManager(
      repo,
      pkg
    );

  const scripts =
    pkg.scripts || {};

  const desired = [
    {
      name: "lint",
      check_type: CheckType.LINT,
    },
    {
      name: "typecheck",
      check_type: CheckType.TYPECHECK,
    },
    {
      name: "test",
      check_type: CheckType.TEST,
    },
    {
      name: "build",
      check_type: CheckType.BUILD,
    },
  ];

  const configured =
    desired.filter(
      check =>
        typeof scripts[
          check.name
        ] === "string" &&
        scripts[
          check.name
        ].trim().length > 0
    );

  if (
    configured.length === 0
  ) {
    return notConfigured(
      "NO_CHECKS_FOUND"
    );
  }

  const results = [];

  for (
    const check
    of configured
  ) {
    const r =
      runPackageScript(
        pm,
        check.name,
        repo,
        600000
      );

    const status =
      r.timedOut
        ? CheckStatus.BLOCKED
        : r.code === 0
          ? CheckStatus.PASS
          : CheckStatus.FAIL;

    results.push({
      name: check.name,
      check_type: check.check_type,
      configured: true,
      status,
      command:
        `${pm} run ${check.name}`,
      code: r.code,
      signal: r.signal,
      timedOut: r.timedOut,
      error: r.error,
      executed: true,
      duration_ms: r.duration_ms,
      stdout: r.stdout,
      stderr: r.stderr,
    });

    if (
      status !== CheckStatus.PASS
    ) {
      break;
    }
  }

  return results;
}

function passed(results) {
  return (
    Array.isArray(results) &&
    results.length > 0 &&
    results.every(
      result =>
        result.configured === true &&
        result.executed === true &&
        result.status === CheckStatus.PASS &&
        result.code === 0
    )
  );
}

function checksText(results) {
  return (results || [])
    .map(
      result => {
        const lines = [
          `${result.name}: ${result.status}`,
          `configured=${result.configured}`,
          `executed=${result.executed}`,
          `code=${result.code}`,
          `duration_ms=${result.duration_ms}`,
        ];

        if (
          result.error
        ) {
          lines.push(
            `error=${result.error}`
          );
        }

        return lines.join("\n");
      }
    )
    .join("\n\n");
}

function verifyPatchInvariants(
  repo,
  changedPaths = [],
  applicationReceipts = []
) {
  const failures = [];

  if (
    !repo ||
    !fs.existsSync(repo)
  ) {
    failures.push(
      "REPO_MISSING"
    );
  }

  for (
    const rawPath
    of changedPaths || []
  ) {
    let rel;

    try {
      rel =
        normalizeRel(
          rawPath
        );
    } catch (error) {
      failures.push(
        `INVALID_PATH:${String(rawPath)}`
      );
      continue;
    }

    if (
      protectedPath(rel)
    ) {
      failures.push(
        `PROTECTED_PATH:${rel}`
      );
    }
  }

  for (
    const receipt
    of applicationReceipts || []
  ) {
    if (
      !receipt ||
      receipt.schema !==
        "patch-application/v2"
    ) {
      failures.push(
        "PATCH_RECEIPT_INVALID"
      );
      continue;
    }

    if (
      receipt.rollback_available !==
      true
    ) {
      failures.push(
        `ROLLBACK_UNAVAILABLE:${receipt.transaction_id || "unknown"}`
      );
    }

    if (
      !Array.isArray(
        receipt.files
      )
    ) {
      failures.push(
        `PATCH_RECEIPT_FILES_INVALID:${receipt.transaction_id || "unknown"}`
      );
    }
  }

  return {
    pass:
      failures.length === 0,

    failures,
  };
}

function deterministicGateChecks({
  repo,
  changedPaths = [],
  applicationReceipts = [],
  testResults = [],
  regressionResults = [],
} = {}) {
  const invariant =
    verifyPatchInvariants(
      repo,
      changedPaths,
      applicationReceipts
    );

  const normalize =
    (name, results) => ({
      name,
      configured:
        Array.isArray(results) &&
        results.length > 0,
      executed:
        Array.isArray(results) &&
        results.length > 0,
      status:
        passed(results)
          ? CheckStatus.PASS
          : Array.isArray(results) &&
            results.length > 0
            ? CheckStatus.FAIL
            : CheckStatus.NOT_CONFIGURED,
      details:
        Array.isArray(results)
          ? results.map(
              item => ({
                name: item.name,
                status: item.status,
                code: item.code,
              })
            )
          : [],
    });

  return [
    normalize(
      "RETEST",
      testResults
    ),

    normalize(
      "REGRESSION",
      regressionResults
    ),

    {
      name: "INVARIANT",
      configured: true,
      executed: true,
      status:
        invariant.pass
          ? CheckStatus.PASS
          : CheckStatus.FAIL,
      details:
        invariant.failures,
    },
  ];
}

module.exports = {
  REQUIRED_GATES,
  packageManager,
  runPackageScript,
  runChecks,
  passed,
  checksText,
  verifyPatchInvariants,
  deterministicGateChecks,
};