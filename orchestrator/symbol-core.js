'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { spawn } = require('node:child_process');

function languageId(file) {
  const ext = path.extname(file).toLowerCase();

  if (ext === '.ts' || ext === '.mts' || ext === '.cts') {
    return 'typescript';
  }

  if (ext === '.tsx') {
    return 'typescriptreact';
  }

  if (ext === '.jsx') {
    return 'javascriptreact';
  }

  return 'javascript';
}

function positionOf(text, needle, occurrence = 1) {
  let from = 0;
  let index = -1;

  for (let i = 0; i < occurrence; i += 1) {
    index = text.indexOf(needle, from);

    if (index < 0) {
      throw new Error('NEEDLE_NOT_FOUND: ' + needle);
    }

    from = index + needle.length;
  }

  const parts = text
    .slice(0, index)
    .split(/\r?\n/);

  return {
    line: parts.length - 1,
    character: parts[parts.length - 1].length
  };
}

function normalizeLocations(value) {
  const list =
    Array.isArray(value)
      ? value
      : value
        ? [value]
        : [];

  return list.map((item) => ({
    path: fileURLToPath(
      item.uri ||
      item.targetUri
    ),

    range:
      item.range ||
      item.targetSelectionRange ||
      item.targetRange ||
      null
  }));
}

function canonicalPathKey(value) {
  let resolved = path.normalize(path.resolve(String(value)));

  try {
    resolved = fs.realpathSync.native(resolved);
  }
  catch {}

  resolved = path.normalize(resolved);

  if (process.platform === 'win32') {
    resolved = resolved.toLowerCase();
  }

  return resolved;
}

function samePath(a, b) {
  return canonicalPathKey(a) === canonicalPathKey(b);
}

class NativeTsLspClient {

  constructor({
    toolchainDir,
    rootDir,
    timeoutMs = 15000
  }) {
    this.toolchainDir = path.resolve(toolchainDir);
    this.rootDir = path.resolve(rootDir);
    this.timeoutMs = timeoutMs;

    this.seq = 0;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.stderr = '';
    this.proc = null;
    this.opened = new Map();
  }

  binPath() {
    return path.join(
      this.toolchainDir,
      'node_modules',
      '.bin',
      process.platform === 'win32'
        ? 'tsc.cmd'
        : 'tsc'
    );
  }

  async start() {
    const bin = this.binPath();

    if (!fs.existsSync(bin)) {
      throw new Error(
        'TSC_BIN_MISSING: ' + bin
      );
    }

    let command = bin;
    let args = [
      '--lsp',
      '--stdio'
    ];

    if (process.platform === 'win32') {
      command =
        process.env.ComSpec ||
        'cmd.exe';

      args = [
        '/d',
        '/q',
        '/c',
        bin,
        '--lsp',
        '--stdio'
      ];
    }

    this.proc = spawn(
      command,
      args,
      {
        cwd: this.rootDir,
        stdio: [
          'pipe',
          'pipe',
          'pipe'
        ],
        windowsHide: true,
        env: {
          ...process.env,
          NO_COLOR: '1'
        }
      }
    );

    this.proc.stdout.on(
      'data',
      (chunk) => {
        this.onData(chunk);
      }
    );

    this.proc.stderr.on(
      'data',
      (chunk) => {
        this.stderr +=
          chunk.toString('utf8');
      }
    );

    this.proc.once(
      'error',
      (error) => {
        this.fail(error);
      }
    );

    this.proc.once(
      'exit',
      (code, signal) => {
        if (this.pending.size > 0) {
          this.fail(
            new Error(
              'LSP_EXIT code=' +
              code +
              ' signal=' +
              signal +
              ' stderr=' +
              this.stderr.slice(-2000)
            )
          );
        }
      }
    );

    const result =
      await this.request(
        'initialize',
        {
          processId: process.pid,

          clientInfo: {
            name: 'astera-symbol-core',
            version: '1'
          },

          rootUri:
            pathToFileURL(
              this.rootDir
            ).href,

          workspaceFolders: [
            {
              uri:
                pathToFileURL(
                  this.rootDir
                ).href,

              name:
                path.basename(
                  this.rootDir
                )
            }
          ],

          capabilities: {
            workspace: {
              configuration: true,
              workspaceFolders: true,
              symbol: {}
            },

            textDocument: {
              documentSymbol: {
                hierarchicalDocumentSymbolSupport:
                  true
              },

              definition: {
                linkSupport:
                  true
              },

              references: {},

              synchronization: {
                dynamicRegistration:
                  false
              }
            }
          }
        }
      );

    this.notify(
      'initialized',
      {}
    );

    console.log(
      'NATIVE_LSP_INITIALIZE=PASS'
    );

    return result;
  }

  fail(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(
        pending.timer
      );

      pending.reject(
        error
      );
    }

    this.pending.clear();
  }

  send(message) {
    if (
      !this.proc ||
      !this.proc.stdin.writable
    ) {
      throw new Error(
        'LSP_NOT_RUNNING'
      );
    }

    const body =
      Buffer.from(
        JSON.stringify(message),
        'utf8'
      );

    this.proc.stdin.write(
      'Content-Length: ' +
      body.length +
      '\r\n\r\n'
    );

    this.proc.stdin.write(
      body
    );
  }

  request(
    method,
    params,
    timeoutMs = this.timeoutMs
  ) {
    const id =
      ++this.seq;

    return new Promise(
      (resolve, reject) => {

        const timer =
          setTimeout(
            () => {
              this.pending.delete(id);

              reject(
                new Error(
                  'LSP_TIMEOUT: ' +
                  method +
                  ' stderr=' +
                  this.stderr.slice(-1200)
                )
              );
            },
            timeoutMs
          );

        this.pending.set(
          id,
          {
            resolve,
            reject,
            timer,
            method
          }
        );

        this.send(
          {
            jsonrpc: '2.0',
            id,
            method,
            params
          }
        );
      }
    );
  }

  notify(
    method,
    params
  ) {
    this.send(
      {
        jsonrpc: '2.0',
        method,
        params
      }
    );
  }

  onData(chunk) {
    this.buffer =
      Buffer.concat(
        [
          this.buffer,
          chunk
        ]
      );

    while (true) {

      const headerEnd =
        this.buffer.indexOf(
          '\r\n\r\n'
        );

      if (headerEnd < 0) {
        return;
      }

      const header =
        this.buffer
          .subarray(
            0,
            headerEnd
          )
          .toString('ascii');

      const match =
        /Content-Length:\s*(\d+)/i
          .exec(header);

      if (!match) {
        throw new Error(
          'LSP_BAD_HEADER: ' +
          header
        );
      }

      const length =
        Number(match[1]);

      const bodyStart =
        headerEnd + 4;

      if (
        this.buffer.length <
        bodyStart + length
      ) {
        return;
      }

      const body =
        this.buffer
          .subarray(
            bodyStart,
            bodyStart + length
          )
          .toString('utf8');

      this.buffer =
        this.buffer.subarray(
          bodyStart + length
        );

      this.handle(
        JSON.parse(body)
      );
    }
  }

  handle(message) {

    if (
      message.method &&
      message.id !== undefined
    ) {
      let result = null;

      if (
        message.method ===
        'workspace/configuration'
      ) {
        result =
          (
            message.params?.items ||
            []
          ).map(
            () => ({})
          );
      }

      else if (
        message.method ===
        'workspace/workspaceFolders'
      ) {
        result = [
          {
            uri:
              pathToFileURL(
                this.rootDir
              ).href,

            name:
              path.basename(
                this.rootDir
              )
          }
        ];
      }

      else if (
        message.method ===
        'workspace/applyEdit'
      ) {
        result = {
          applied: false
        };
      }

      this.send(
        {
          jsonrpc: '2.0',
          id: message.id,
          result
        }
      );

      return;
    }

    if (
      message.id !== undefined &&
      this.pending.has(
        message.id
      )
    ) {
      const pending =
        this.pending.get(
          message.id
        );

      this.pending.delete(
        message.id
      );

      clearTimeout(
        pending.timer
      );

      if (message.error) {
        pending.reject(
          new Error(
            'LSP_ERROR ' +
            pending.method +
            ': ' +
            JSON.stringify(
              message.error
            )
          )
        );
      }
      else {
        pending.resolve(
          message.result
        );
      }
    }
  }

  open(file) {
    const abs =
      path.resolve(file);

    const text =
      fs.readFileSync(
        abs,
        'utf8'
      );

    const uri =
      pathToFileURL(
        abs
      ).href;

    this.opened.set(
      abs,
      {
        text,
        uri
      }
    );

    this.notify(
      'textDocument/didOpen',
      {
        textDocument: {
          uri,
          languageId:
            languageId(abs),
          version: 1,
          text
        }
      }
    );

    return {
      abs,
      text,
      uri
    };
  }

  documentSymbols(file) {
    const abs =
      path.resolve(file);

    const document =
      this.opened.get(abs) ||
      this.open(abs);

    return this.request(
      'textDocument/documentSymbol',
      {
        textDocument: {
          uri:
            document.uri
        }
      }
    );
  }

  definition(
    file,
    needle,
    occurrence = 1
  ) {
    const abs =
      path.resolve(file);

    const document =
      this.opened.get(abs) ||
      this.open(abs);

    return this.request(
      'textDocument/definition',
      {
        textDocument: {
          uri:
            document.uri
        },

        position:
          positionOf(
            document.text,
            needle,
            occurrence
          )
      }
    );
  }

  references(
    file,
    needle,
    occurrence = 1
  ) {
    const abs =
      path.resolve(file);

    const document =
      this.opened.get(abs) ||
      this.open(abs);

    return this.request(
      'textDocument/references',
      {
        textDocument: {
          uri:
            document.uri
        },

        position:
          positionOf(
            document.text,
            needle,
            occurrence
          ),

        context: {
          includeDeclaration:
            true
        }
      }
    );
  }

  async stop() {

    if (!this.proc) {
      return;
    }

    const processHandle =
      this.proc;

    try {
      await this.request(
        'shutdown',
        null,
        4000
      );
    }
    catch {}

    try {
      this.notify(
        'exit',
        null
      );
    }
    catch {}

    this.proc = null;

    await new Promise(
      (resolve) => {

        const timer =
          setTimeout(
            () => {
              try {
                processHandle.kill();
              }
              catch {}

              resolve();
            },
            1000
          );

        processHandle.once(
          'exit',
          () => {
            clearTimeout(timer);
            resolve();
          }
        );
      }
    );
  }
}

async function selfTest(
  toolchainDir,
  actualContext,
  tempBase
) {
  fs.mkdirSync(
    tempBase,
    {
      recursive: true
    }
  );

  const root =
    fs.mkdtempSync(
      path.join(
        tempBase,
        'native-lsp-'
      )
    );

  const lib =
    path.join(
      root,
      'lib.js'
    );

  const main =
    path.join(
      root,
      'main.js'
    );

  fs.writeFileSync(
    path.join(
      root,
      'jsconfig.json'
    ),

    JSON.stringify(
      {
        compilerOptions: {
          allowJs: true,
          checkJs: true,
          module: 'esnext',
          moduleResolution: 'node',
          target: 'es2022'
        },

        include: [
          './*.js'
        ]
      },
      null,
      2
    )
  );

  fs.writeFileSync(
    lib,
    'export function greet(name) { return "Hello "+name; }\n'
  );

  fs.writeFileSync(
    main,
    'import { greet } from "./lib.js";\nconsole.log(greet("Master"));\n'
  );

  if (process.platform === 'win32') {
    const driveVariant =
      lib.replace(
        /^([a-z]):/i,
        (_, drive) =>
          (drive === drive.toLowerCase()
            ? drive.toUpperCase()
            : drive.toLowerCase()) + ':'
      );

    if (!samePath(lib, driveVariant)) {
      throw new Error(
        'WINDOWS_PATH_CANONICALIZATION_BAD: ' +
        lib +
        ' <> ' +
        driveVariant
      );
    }

    console.log(
      'WINDOWS_PATH_CANONICALIZATION=PASS'
    );
  }

  const client =
    new NativeTsLspClient(
      {
        toolchainDir,
        rootDir: root
      }
    );

  try {

    await client.start();

    client.open(lib);
    client.open(main);

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          500
        )
    );

    const symbols =
      await client.documentSymbols(
        lib
      );

    if (
      !Array.isArray(symbols) ||
      !symbols.some(
        (item) =>
          item.name === 'greet'
      )
    ) {
      throw new Error(
        'DOCUMENT_SYMBOL_MISSING'
      );
    }

    console.log(
      'LSP_DOCUMENT_SYMBOL=PASS'
    );

    const definitions =
      normalizeLocations(
        await client.definition(
          main,
          'greet'
        )
      );

    if (
      !definitions.some(
        (item) =>
          samePath(item.path, lib)
      )
    ) {
      throw new Error(
        'DEFINITION_TARGET_BAD: ' +
        JSON.stringify(
          definitions
        )
      );
    }

    console.log(
      'LSP_DEFINITION=PASS'
    );

    const references =
      normalizeLocations(
        await client.references(
          lib,
          'greet'
        )
      );

    const referencePaths =
      new Set(
        references.map((item) => canonicalPathKey(item.path))
      );

    if (
      !referencePaths.has(canonicalPathKey(lib)) ||
      !referencePaths.has(canonicalPathKey(main))
    ) {
      throw new Error(
        'REFERENCES_BAD: ' +
        JSON.stringify(
          references
        )
      );
    }

    console.log(
      'LSP_REFERENCES=PASS'
    );
  }
  finally {
    await client.stop();
  }

  const actual =
    new NativeTsLspClient(
      {
        toolchainDir,
        rootDir:
          path.dirname(
            actualContext
          )
      }
    );

  try {

    await actual.start();

    actual.open(
      actualContext
    );

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          400
        )
    );

    const symbols =
      await actual.documentSymbols(
        actualContext
      );

    if (
      !Array.isArray(symbols) ||
      symbols.length === 0
    ) {
      throw new Error(
        'ACTUAL_CONTEXT_SYMBOLS_EMPTY'
      );
    }

    console.log(
      'ACTUAL_CONTEXT_SYMBOLS=' +
      symbols.length
    );

    console.log(
      'ACTUAL_CONTEXT_SYMBOL_QUERY=PASS'
    );
  }
  finally {

    await actual.stop();

    fs.rmSync(
      root,
      {
        recursive: true,
        force: true
      }
    );
  }
}

module.exports = {
  NativeTsLspClient,
  positionOf,
  normalizeLocations,
  canonicalPathKey,
  samePath
};

if (require.main === module) {
  selfTest(
    process.argv[2],
    process.argv[3],
    process.argv[4]
  )
  .catch(
    (error) => {
      console.error(
        error.stack ||
        String(error)
      );

      process.exit(1);
    }
  );
}