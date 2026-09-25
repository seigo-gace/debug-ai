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

const CHECK_PLAN =
  Object.freeze([
    Object.freeze({
      name: "lint",
      check_type: CheckType.LINT,
    }),

    Object.freeze({
      name: "typecheck",
      check_type: CheckType.TYPECHECK,
    }),

    Object.freeze({
      name: "test",
      check_type: CheckType.UNIT,
    }),

    Object.freeze({
      name: "build",
      check_type: CheckType.BUILD,
    }),
  ]);

function directExec(
  command,
  args,
  cwd,
  timeout = 600000
) {
  const started =
    performance.now();

  const r =
    spawnSync(
      command,
      args,
      {
        cwd,
        encoding: "utf8",
        shell: false,
        timeout,
        windowsHide: true,
      }
    );

  const timedOut =
    r?.error?.code ===
    "ETIMEDOUT";

  return {
    code:
      Number.isInteger(r.status)
        ? r.status
        : timedOut
          ? 124
          : 1,

    stdout:
      r.stdout || "",

    stderr:
      r.stderr || "",

    signal:
      r.signal || null,

    error_code:
      r?.error?.code || null,

    error:
      r?.error
        ? String(
            r.error.message ||
            r.error
          )
        : null,

    timedOut,

    duration_ms:
      Math.max(
        0,
        Math.round(
          performance.now() -
          started
        )
      ),
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
   * Windows npm/pnpm/yarn are .cmd shims.
   * Node 24 cannot spawn those .cmd files directly
   * with shell:false (EINVAL).
   *
   * Do NOT enable shell:true.
   *
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
    const match =
      /^(npm|pnpm|yarn|bun)(?:@[^\s]+)?$/i
        .exec(declared);

    if (!match) {
      throw new Error(
        `Unsupported package manager declaration: ${declared}`
      );
    }

    return match[1]
      .toLowerCase();
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
        "bun.lock"
      )
    ) ||
    fs.existsSync(
      path.join(
        repo,
        "bun.lockb"
      )
    )
  ) {
    return "bun";
  }

  return "npm";
}

function notConfigured(
  reason
) {
  return [
    {
      name: "verification",
      check_type: null,
      status:
        CheckStatus.NOT_CONFIGURED,

      reason,

      command: null,
      code: null,
      exit_code: null,

      configured: false,
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

  const scripts =
    pkg.scripts || {};

  const pm =
    packageManager(
      repo,
      pkg
    );

  if (
    !PACKAGE_MANAGERS.has(pm)
  ) {
    throw new Error(
      `Unsupported package manager executable: ${pm}`
    );
  }

  const configured =
    CHECK_PLAN.filter(
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
      name:
        check.name,

      check_type:
        check.check_type,

      status,

      reason:
        r.timedOut
          ? "COMMAND_TIMEOUT"
          : r.error_code
            ? `SPAWN_${r.error_code}`
            : null,

      command:
        `${pm} run ${check.name}`,

      code:
        r.code,

      exit_code:
        r.code,

      configured:
        true,

      executed:
        true,

      duration_ms:
        r.duration_ms,

      stdout:
        r.stdout.slice(
          -12000
        ),

      stderr:
        (
          r.stderr ||
          r.error ||
          ""
        ).slice(
          -12000
        ),
    });

    // First meaningful failure only.
    if (
      status !==
      CheckStatus.PASS
    ) {
      break;
    }
  }

  return results;
}

function passed(results) {
  if (
    !Array.isArray(results) ||
    results.length === 0
  ) {
    return false;
  }

  if (
    results.some(
      r =>
        r.status ===
        CheckStatus.NOT_CONFIGURED
    )
  ) {
    return false;
  }

  const executed =
    results.filter(
      r =>
        r &&
        r.configured === true &&
        r.executed === true
    );

  if (
    executed.length === 0
  ) {
    return false;
  }

  return (
    executed.every(
      r =>
        r.status ===
        CheckStatus.PASS
    ) &&
    results.every(
      r =>
        r.status ===
        CheckStatus.PASS
    )
  );
}

function checksText(results) {
  return (
    Array.isArray(results)
      ? results
      : []
  )
    .map(
      r => {
        const status =
          r?.status ||
          "UNKNOWN";

        const reason =
          r?.reason
            ? ` reason=${r.reason}`
            : "";

        const code =
          Number.isInteger(
            r?.code
          )
            ? r.code
            : "n/a";

        return (
          `${r?.name || "unknown"}: ` +
          `status=${status} ` +
          `exit=${code}` +
          `${reason}\n` +
          `${r?.stdout || ""}\n` +
          `${r?.stderr || ""}`
        );
      }
    )
    .join(
      "\n---\n"
    )
    .slice(
      -22000
    );
}


function verifyPatchInvariants(repo, changedPaths = [], receipts = []) {
  const root = fs.realpathSync(repo);
  const fold = (v) => process.platform === "win32" ? String(v).toLowerCase() : String(v);
  const rootCmp = fold(root);
  const prefix = rootCmp.endsWith(path.sep) ? rootCmp : rootCmp + path.sep;
  const failures = [];

  for (const input of changedPaths || []) {
    const rel = String(input || "").replace(/\\/g, "/").replace(/^\.\//, "");
    if (!rel || path.posix.isAbsolute(rel) || /^[A-Za-z]:\//.test(rel) || rel.split("/").includes("..")) {
      failures.push(`INVALID_PATH:${rel || "<empty>"}`);
      continue;
    }
    const low = rel.toLowerCase();
    if (low === ".git" || low.startsWith(".git/") || low.includes("/.git/") ||
        low === "secrets" || low.startsWith("secrets/") || low.includes("/secrets/") ||
        /(^|\/)\.env($|\.)/.test(low) || /\.(pem|key|p12|pfx)$/.test(low)) {
      failures.push(`PROTECTED_PATH:${rel}`);
      continue;
    }
    const full = path.resolve(root, rel);
    const fullCmp = fold(full);
    if (fullCmp !== rootCmp && !fullCmp.startsWith(prefix)) failures.push(`PATH_ESCAPE:${rel}`);
  }

  for (const receipt of receipts || []) {
    if (!receipt || receipt.schema !== "patch-application/v2") {
      failures.push("PATCH_RECEIPT_INVALID");
      continue;
    }
    if (receipt.rollback_available !== true) failures.push("ROLLBACK_NOT_AVAILABLE");
    if (!Array.isArray(receipt.files) || receipt.files.length === 0) failures.push("PATCH_RECEIPT_FILES_MISSING");
  }

  return {
    pass: failures.length === 0,
    failures,
    checked_paths: [...new Set((changedPaths || []).map((v) => String(v)))].length,
    checked_receipts: Array.isArray(receipts) ? receipts.length : 0,
  };
}

function deterministicGateChecks(checks, invariantResult) {
  const list = Array.isArray(checks) ? checks : [];
  const actual = list.filter((x) => x && x.configured === true && x.executed === true);
  const suitePass = passed(list);
  const duration = actual.reduce((sum, x) => sum + (Number.isFinite(x.duration_ms) ? x.duration_ms : 0), 0);
  const failedCount = actual.filter((x) => x.status !== CheckStatus.PASS).length;
  const base = {
    configured: actual.length > 0,
    executed: actual.length > 0,
    total: actual.length,
    failed: failedCount,
    duration_ms: duration,
    stdout: "",
    stderr: "",
  };

  const retest = {
    ...base,
    name: "deterministic-retest",
    check_type: CheckType.RETEST,
    status: suitePass ? CheckStatus.PASS : CheckStatus.FAIL,
    reason: suitePass ? null : "PROJECT_VERIFICATION_SUITE_FAILED",
    command: "verification-suite:retest",
    code: suitePass ? 0 : 1,
    exit_code: suitePass ? 0 : 1,
  };

  const regression = {
    ...base,
    name: "deterministic-regression",
    check_type: CheckType.REGRESSION,
    status: suitePass ? CheckStatus.PASS : CheckStatus.FAIL,
    reason: suitePass ? null : "PROJECT_REGRESSION_SUITE_FAILED",
    command: "verification-suite:regression",
    code: suitePass ? 0 : 1,
    exit_code: suitePass ? 0 : 1,
  };

  const invPass = invariantResult?.pass === true;
  const invariant = {
    name: "deterministic-invariant",
    check_type: CheckType.INVARIANT,
    status: invPass ? CheckStatus.PASS : CheckStatus.FAIL,
    reason: invPass ? null : (invariantResult?.failures || ["INVARIANT_FAILED"]).join("|"),
    command: "patch-authority:invariant",
    code: invPass ? 0 : 1,
    exit_code: invPass ? 0 : 1,
    configured: true,
    executed: true,
    total: Number(invariantResult?.checked_paths || 0) + Number(invariantResult?.checked_receipts || 0),
    failed: invPass ? 0 : Math.max(1, Array.isArray(invariantResult?.failures) ? invariantResult.failures.length : 1),
    duration_ms: 0,
    stdout: "",
    stderr: "",
  };

  return [retest, regression, invariant];
}

module.exports = {
  CHECK_PLAN,
  directExec,
  runPackageScript,
  packageManager,
  runChecks,
  passed,
  checksText,
  verifyPatchInvariants,
  deterministicGateChecks,
};