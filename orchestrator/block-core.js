"use strict";

const {
  makeRequest,
  makeBlock,
  validateBlock,
  AUTHORITY_KINDS,
} = require("./contracts");

const STAGES =
  Object.freeze([
    "implement",
    "repair",
    "review",
  ]);

const CARRY_KINDS =
  new Set([
    "forbidden",
    "invariant",
    "permission",
  ]);

const PRIORITY =
  Object.freeze({
    forbidden: 100,
    invariant: 95,
    permission: 92,
    acceptance: 90,
    scope: 88,
    objective: 80,
    target: 78,
    failure: 76,
    evidence: 70,
    current_state: 65,
    open_issue: 60,
    history: 50,
  });

const STAGE_SCOPE =
  Object.freeze({
    forbidden: STAGES,
    invariant: STAGES,
    permission: STAGES,
    acceptance: STAGES,
    scope: STAGES,
    objective: STAGES,
    target: STAGES,

    failure: [
      "repair",
      "review",
    ],

    evidence: STAGES,
    current_state: STAGES,
    open_issue: STAGES,

    history: [
      "repair",
      "review",
    ],
  });

const AUTHORITY_SET =
  new Set(
    AUTHORITY_KINDS
  );

const RX =
  Object.freeze({
    forbidden:
      /(禁止|厳禁|不可|してはいけ|しないで|するな|触るな|勝手|削除しない|変更しない|追加しない|must\s+not|do\s+not|don't|never|forbid|prohibit)/i,

    permission:
      /(許可|承認|permission|approval|明示的.*許可|explicit.*approval|only\s+with\s+approval)/i,

    acceptance:
      /(完了条件|成功条件|受入|合格|完成条件|acceptance|completion|done\s+when|\bPASS\b|\bSUCCESS\b)/i,

    invariant:
      /(維持|保持|不変|壊さ|そのまま|変更せず|既存.*維持|keep|preserve|unchanged|invariant)/i,

    scope:
      /(対象|範囲|scope|対象ファイル|対象フォルダ|対象ディレクトリ|\bpath\b|D:\\AI_Dev)/i,

    failure:
      /(失敗|エラー|不具合|障害|bug|error|fail|failure)/i,

    evidence:
      /(ログ|実測|証拠|根拠|検証結果|evidence|\blog\b|test\s+result|sha-?256|fingerprint)/i,

    current_state:
      /(現在|現状|いま|今ある|既存|current|existing|present\s+state)/i,

    history:
      /(前回|以前|これまで|履歴|既に|すでに|history|previous|already)/i,

    target:
      /(ファイル|フォルダ|ディレクトリ|コード|実装|repository|repo|module|API|UI)/i,

    open_issue:
      /(未解決|懸念|課題|open\s+issue|concern|todo)/i,
  });

function classifyKind(text) {

  const value =
    String(
      text ?? ""
    );

  const order = [
    "forbidden",
    "permission",
    "acceptance",
    "invariant",
    "scope",
    "failure",
    "evidence",
    "current_state",
    "history",
    "open_issue",
    "target",
  ];

  for (
    const kind
    of order
  ) {
    if (
      RX[kind].test(
        value
      )
    ) {
      return kind;
    }
  }

  return "objective";
}

function pushLongSplit(
  raw,
  start,
  end,
  out,
  maxSpanChars = 1800
) {

  let cursor =
    start;

  while (
    cursor < end
  ) {

    let stop =
      Math.min(
        end,
        cursor +
          maxSpanChars
      );

    if (
      stop < end
    ) {

      const window =
        raw.slice(
          cursor,
          stop
        );

      let relative =
        -1;

      const breakpoints = [
        /[^\n]{0,1800}[。！？!?;；]\s*$/u,
        /[^\n]{0,1800}[、,]\s*$/u,
        /[^\n]{0,1800}\s+$/u,
      ];

      for (
        const pattern
        of breakpoints
      ) {

        const match =
          window.match(
            pattern
          );

        if (
          match &&
          match.index != null
        ) {
          relative =
            match.index +
            match[0].length;
        }

        if (
          relative > 0
        ) {
          break;
        }
      }

      if (
        relative >
        Math.floor(
          maxSpanChars *
          0.5
        )
      ) {
        stop =
          cursor +
          relative;
      }
    }

    if (
      stop <= cursor
    ) {
      stop =
        Math.min(
          end,
          cursor +
            maxSpanChars
        );
    }

    out.push({
      start:
        cursor,

      end:
        stop,
    });

    cursor =
      stop;
  }
}

function segmentSpans(raw) {

  const source =
    String(
      raw ?? ""
    );

  const spans = [];

  let position = 0;
  let fenceStart = null;

  while (
    position <
    source.length
  ) {

    const newline =
      source.indexOf(
        "\n",
        position
      );

    const lineEnd =
      newline >= 0
        ? newline
        : source.length;

    const next =
      newline >= 0
        ? newline + 1
        : source.length;

    const line =
      source.slice(
        position,
        lineEnd
      );

    const trimmed =
      line.trim();

    if (
      fenceStart !==
      null
    ) {

      if (
        /^```/.test(
          trimmed
        )
      ) {

        pushLongSplit(
          source,
          fenceStart,
          lineEnd,
          spans,
          1800
        );

        fenceStart =
          null;
      }

      position =
        next;

      continue;
    }

    if (
      /^```/.test(
        trimmed
      )
    ) {
      fenceStart =
        position;

      position =
        next;

      continue;
    }

    if (trimmed) {

      pushLongSplit(
        source,
        position,
        lineEnd,
        spans,
        1800
      );
    }

    position =
      next;
  }

  if (
    fenceStart !==
    null
  ) {

    pushLongSplit(
      source,
      fenceStart,
      source.length,
      spans,
      1800
    );
  }

  return spans;
}

function validateCoverage(
  request,
  blocks
) {

  let cursor =
    0;

  for (
    const block
    of blocks
  ) {

    validateBlock(
      block,
      request
    );

    if (
      !Number.isInteger(
        block.source_start
      ) ||
      !Number.isInteger(
        block.source_end
      )
    ) {
      throw new Error(
        "BLOCK_SPAN_INVALID"
      );
    }

    if (
      block.source_start <
        cursor ||
      block.source_end <=
        block.source_start
    ) {
      throw new Error(
        "BLOCK_SPAN_OVERLAP_OR_ORDER"
      );
    }

    if (
      request.raw
        .slice(
          cursor,
          block.source_start
        )
        .trim()
    ) {
      throw new Error(
        "BLOCK_COVERAGE_GAP"
      );
    }

    cursor =
      block.source_end;
  }

  if (
    request.raw
      .slice(cursor)
      .trim()
  ) {
    throw new Error(
      "BLOCK_COVERAGE_GAP"
    );
  }

  return true;
}

function compileInstruction(raw) {

  const request =
    makeRequest({
      raw:
        String(
          raw ?? ""
        ),
    });

  const spans =
    segmentSpans(
      request.raw
    );

  const blocks =
    spans.map(
      ({
        start,
        end,
      }) => {

        const text =
          request.raw.slice(
            start,
            end
          );

        const kind =
          classifyKind(
            text
          );

        const block =
          makeBlock({
            kind,
            request,
            source_start:
              start,
            source_end:
              end,
          });

        return {
          ...block,

          priority:
            PRIORITY[kind] ??
            40,

          dependencies:
            [],

          stage_scope:
            [
              ...(
                STAGE_SCOPE[kind] ||
                STAGES
              ),
            ],

          immutable:
            AUTHORITY_SET.has(
              kind
            ),

          /*
           * Conservative upper-bound estimate.
           * Provider-specific token accounting belongs
           * to the later model-registry stage.
           */
          token_estimate:
            Math.max(
              1,
              text.length
            ),
        };
      }
    );

  validateCoverage(
    request,
    blocks
  );

  const authorityIds =
    blocks
      .filter(
        block =>
          block.authority
      )
      .map(
        block =>
          block.id
      );

  const byId =
    new Map(
      blocks.map(
        block => [
          block.id,
          block,
        ]
      )
    );

  for (
    const block
    of blocks
  ) {

    if (
      block.authority
    ) {
      continue;
    }

    block.dependencies =
      authorityIds.filter(
        id => {

          const authority =
            byId.get(id);

          return (
            authority &&
            authority.source_start <=
              block.source_start
          );
        }
      );
  }

  return {
    schema:
      "instruction-plan/v1",

    request,
    blocks,

    coverage: {
      non_whitespace_complete:
        true,

      block_count:
        blocks.length,

      authority_count:
        authorityIds.length,

      authority_block_ids:
        authorityIds,
    },
  };
}

function selectStageBlocks(
  plan,
  stage
) {

  if (
    !STAGES.includes(
      stage
    )
  ) {
    throw new Error(
      `UNKNOWN_STAGE:${stage}`
    );
  }

  const selected =
    plan.blocks.filter(
      block =>
        block.stage_scope
          .includes(
            stage
          )
    );

  for (
    const block
    of selected
  ) {

    validateBlock(
      block,
      plan.request
    );
  }

  return selected.sort(
    (
      left,
      right
    ) =>
      left.source_start -
      right.source_start
  );
}

function renderBlock(
  block
) {

  return (
    `[BLOCK ${block.id} ` +
    `kind=${block.kind} ` +
    `authority=${block.authority ? "true" : "false"} ` +
    `source=${block.source_start}:${block.source_end}]\n` +
    block.text
  );
}

function buildStagePackets(
  plan,
  stage,
  maxChars = 6000
) {

  if (
    !Number.isInteger(
      maxChars
    ) ||
    maxChars < 1200
  ) {
    throw new Error(
      "STAGE_BUDGET_INVALID"
    );
  }

  const selected =
    selectStageBlocks(
      plan,
      stage
    );

  if (
    !selected.length
  ) {
    throw new Error(
      `NO_STAGE_BLOCKS:${stage}`
    );
  }

  const carry =
    selected.filter(
      block =>
        CARRY_KINDS.has(
          block.kind
        )
    );

  const payload =
    selected.filter(
      block =>
        !CARRY_KINDS.has(
          block.kind
        )
    );

  const header =
    "INSTRUCTION AUTHORITY PACKET\n" +
    `REQUEST_HASH=${plan.request.request_hash}\n` +
    `STAGE=${stage}\n` +
    "RULE=Every block below is source-derived. " +
    "authority=true blocks are immutable constraints. " +
    "Do not weaken, omit, reinterpret, or contradict them.\n";

  const carryText =
    carry
      .map(
        renderBlock
      )
      .join(
        "\n\n"
      );

  const prefix =
    header +
    (
      carryText
        ? (
            "\nCARRY AUTHORITY\n" +
            carryText +
            "\n"
          )
        : ""
    ) +
    "\nSTAGE BLOCKS\n";

  if (
    prefix.length >=
    maxChars
  ) {
    throw new Error(
      `AUTHORITY_CORE_EXCEEDS_STAGE_BUDGET:${stage}`
    );
  }

  const groups = [];
  let current = [];

  for (
    const block
    of payload
  ) {

    const trial =
      prefix +
      [
        ...current.map(
          renderBlock
        ),
        renderBlock(
          block
        ),
      ].join(
        "\n\n"
      );

    if (
      trial.length >
        maxChars &&
      current.length
    ) {

      groups.push(
        current
      );

      current = [];
    }

    const single =
      prefix +
      renderBlock(
        block
      );

    if (
      single.length >
      maxChars
    ) {
      throw new Error(
        `BLOCK_EXCEEDS_STAGE_BUDGET:${block.id}`
      );
    }

    current.push(
      block
    );
  }

  if (
    current.length
  ) {
    groups.push(
      current
    );
  }

  if (
    !groups.length
  ) {
    groups.push(
      []
    );
  }

  const packets =
    groups.map(
      (
        group,
        index
      ) => ({
        schema:
          "stage-packet/v1",

        stage,

        packet_index:
          index + 1,

        packet_count:
          groups.length,

        request_hash:
          plan.request
            .request_hash,

        carry_block_ids:
          carry.map(
            block =>
              block.id
          ),

        payload_block_ids:
          group.map(
            block =>
              block.id
          ),

        block_ids: [
          ...carry.map(
            block =>
              block.id
          ),

          ...group.map(
            block =>
              block.id
          ),
        ],

        text:
          prefix +
          group
            .map(
              renderBlock
            )
            .join(
              "\n\n"
            ),
      })
    );

  const covered =
    new Set();

  for (
    const packet
    of packets
  ) {
    for (
      const id
      of packet.block_ids
    ) {
      covered.add(id);
    }
  }

  for (
    const block
    of selected
  ) {

    if (
      !covered.has(
        block.id
      )
    ) {
      throw new Error(
        `STAGE_BLOCK_DROPPED:${stage}:${block.id}`
      );
    }
  }

  return packets;
}

function mergeOperationFragments(
  fragments
) {

  if (
    !Array.isArray(
      fragments
    ) ||
    !fragments.length
  ) {
    throw new Error(
      "NO_IMPLEMENTATION_FRAGMENTS"
    );
  }

  const operations = [];
  const summaries = [];

  const exactSeen =
    new Set();

  const wholeFile =
    new Map();

  const replaceByTarget =
    new Map();

  const replacePaths =
    new Set();

  for (
    const fragment
    of fragments
  ) {

    if (
      !fragment ||
      fragment.status !==
        "READY" ||
      !Array.isArray(
        fragment.operations
      )
    ) {
      throw new Error(
        "INVALID_IMPLEMENTATION_FRAGMENT"
      );
    }

    if (
      fragment.summary
    ) {
      summaries.push(
        String(
          fragment.summary
        )
      );
    }

    for (
      const operation
      of fragment.operations
    ) {

      const type =
        String(
          operation?.type ||
          ""
        );

      const operationPath =
        String(
          operation?.path ||
          ""
        ).replace(
          /\\/g,
          "/"
        );

      if (
        !operationPath ||
        ![
          "replace",
          "write",
          "create",
          "delete",
        ].includes(
          type
        )
      ) {
        throw new Error(
          "INVALID_FRAGMENT_OPERATION"
        );
      }

      const exact =
        JSON.stringify({
          type,
          path:
            operationPath,

          old:
            operation.old ??
            null,

          new:
            operation.new ??
            null,

          content:
            operation.content ??
            null,
        });

      if (
        exactSeen.has(
          exact
        )
      ) {
        continue;
      }

      exactSeen.add(
        exact
      );

      if (
        [
          "write",
          "create",
          "delete",
        ].includes(type)
      ) {

        if (
          wholeFile.has(
            operationPath
          ) ||
          replacePaths.has(
            operationPath
          )
        ) {
          throw new Error(
            `BLOCK_PACKET_OPERATION_CONFLICT:${operationPath}`
          );
        }

        wholeFile.set(
          operationPath,
          exact
        );
      }

      else {

        if (
          wholeFile.has(
            operationPath
          )
        ) {
          throw new Error(
            `BLOCK_PACKET_OPERATION_CONFLICT:${operationPath}`
          );
        }

        const oldKey =
          String(
            operation.old ??
            ""
          );

        const key =
          `${operationPath}\u0000${oldKey}`;

        if (
          replaceByTarget.has(
            key
          ) &&
          replaceByTarget.get(
            key
          ) !== exact
        ) {
          throw new Error(
            `BLOCK_PACKET_OPERATION_CONFLICT:${operationPath}`
          );
        }

        replaceByTarget.set(
          key,
          exact
        );

        replacePaths.add(
          operationPath
        );
      }

      operations.push(
        operation
      );
    }
  }

  return {
    status:
      "READY",

    summary:
      summaries.join(
        " | "
      ),

    operations,
  };
}

function mergeReviewFragments(
  fragments
) {

  if (
    !Array.isArray(
      fragments
    ) ||
    !fragments.length
  ) {
    throw new Error(
      "NO_REVIEW_FRAGMENTS"
    );
  }

  const issues = [];
  const summaries = [];

  for (
    let index = 0;
    index <
      fragments.length;
    index++
  ) {

    const fragment =
      fragments[index];

    if (
      !fragment ||
      ![
        "PASS",
        "FAIL",
      ].includes(
        fragment.verdict
      )
    ) {
      throw new Error(
        "INVALID_REVIEW_FRAGMENT"
      );
    }

    if (
      fragment.summary
    ) {
      summaries.push(
        `P${index + 1}:${fragment.summary}`
      );
    }

    if (
      fragment.verdict ===
      "FAIL"
    ) {

      const fragmentIssues =
        Array.isArray(
          fragment.issues
        )
          ? fragment.issues
          : [];

      for (
        const issue
        of fragmentIssues
      ) {
        issues.push(
          `P${index + 1}:${issue}`
        );
      }

      if (
        !fragmentIssues.length
      ) {
        issues.push(
          `P${index + 1}:review failed without issue detail`
        );
      }
    }
  }

  return {
    verdict:
      issues.length
        ? "FAIL"
        : "PASS",

    issues,

    summary:
      summaries.join(
        " | "
      ),
  };
}

function planSummary(
  plan,
  maxChars = 6000
) {

  const stages = {};

  for (
    const stage
    of STAGES
  ) {

    const packets =
      buildStagePackets(
        plan,
        stage,
        maxChars
      );

    stages[stage] = {
      packet_count:
        packets.length,

      packets:
        packets.map(
          packet => ({
            packet_index:
              packet.packet_index,

            char_count:
              packet.text.length,

            carry_block_ids:
              packet.carry_block_ids,

            payload_block_ids:
              packet.payload_block_ids,
          })
        ),
    };
  }

  return {
    schema:
      plan.schema,

    request_hash:
      plan.request
        .request_hash,

    coverage:
      plan.coverage,

    stages,
  };
}

module.exports = {
  STAGES,
  CARRY_KINDS,
  classifyKind,
  segmentSpans,
  validateCoverage,
  compileInstruction,
  selectStageBlocks,
  buildStagePackets,
  mergeOperationFragments,
  mergeReviewFragments,
  planSummary,
};