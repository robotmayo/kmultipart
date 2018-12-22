import { Context } from "koa";
import * as Busboy from "busboy";
import { EventEmitter } from "events";
import { randomBytes } from "crypto";
import { strict as assert } from "assert";
import * as fs from "fs";
import { join } from "path";
import { Writable } from "stream";
const appendField = require("append-field");

declare module "koa" {
  interface Request {
    files: KMultipartFile[];
    body?: { [key: string]: any };
  }
}

export interface KMultipartFile {
  originalFilename: string;
  fieldname: string;
}

export interface MemoryStorageFile extends KMultipartFile {
  fileContents: Buffer;
}

export interface HandleFileObj {
  file: NodeJS.ReadableStream;
  filename: string;
  fieldname: string;
  ctx: Context;
  encoding: string;
  mimetype: string;
}

export interface StorageEngine {
  handleFile: (h: HandleFileObj) => Promise<any>;
}

async function genFileName(h: HandleFileObj) {
  return randomBytes(8).toString("hex");
}

export class ConcatStream extends Writable {
  body: Buffer[] = [];
  constructor() {
    super();
  }
  _write(chunk: Buffer, encoding?: string, cb?: (err?: Error) => void) {
    this.body.push(chunk);
    cb();
  }
  bodyBuffer() {
    return Buffer.concat(this.body);
  }
}

export class MemoryStorage implements StorageEngine {
  async handleFile(h: HandleFileObj) {
    return new Promise((resolve, reject) => {
      const c = new ConcatStream();
      h.file
        .pipe(c)
        .once("finish", () => {
          resolve({ fileContents: c.bodyBuffer() });
        })
        .once("error", reject);
    });
  }
}

export interface DiskStorageFile extends KMultipartFile {
  size: number;
  path: string;
  filename: string;
}

export class DiskStorage implements StorageEngine {
  genFileName = genFileName;
  genDestination?: (h: HandleFileObj) => Promise<string>;
  destination?: string;
  filenameAndDestinationHandler: (
    h: HandleFileObj
  ) => Promise<{ destination: string; filename: string }>;

  constructor(opts: {
    filenameGenerator?: (h: HandleFileObj) => Promise<string>;
    destinationGenerator?: (h: HandleFileObj) => Promise<string>;
    destination?: string;
  }) {
    assert(
      (!opts.destination && !opts.destinationGenerator) === false,
      "must specify a destination or destination generator function"
    );

    if (opts.destination) {
      assert(
        typeof opts.destination === "string",
        "destination must be a string"
      );
    }

    if (opts.destinationGenerator) {
      assert(
        typeof opts.destinationGenerator === "function",
        "destinationGenerator must be a function"
      );
    }

    if (opts.filenameGenerator) {
      assert(
        typeof opts.filenameGenerator === "function",
        "filenameGenerator must be a function"
      );
    }
    this.destination = opts.destination;
  }
  async handleFile(h: HandleFileObj) {
    const filename = await this.genFileName(h);
    const destination = this.destination || (await this.genDestination(h));
    const fullPath = join(destination, filename);
    const fileStream = fs.createWriteStream(fullPath);
    h.file.pipe(fileStream);
    return new Promise((resolve, reject) => {
      fileStream.on("error", reject).on("finish", () => {
        resolve({
          size: fileStream.bytesWritten,
          path: fullPath,
          filename
        });
      });
    });
  }
}

interface MultiPartOptions {
  maxFileSize?: number;
  maxNumFiles?: number;
  storageEngine: StorageEngine;
}

const defaultOpts = {
  // Max file size. Default 200mb
  maxFileSize: 200 * 1024 * 1024,
  maxNumFiles: 20
};

class Counter extends EventEmitter {
  val: number = 0;
  increment() {
    this.val++;
  }
  decrement() {
    this.val--;
    if (this.val === 0) this.emit("zero");
  }
  whenZero(cb: () => void) {
    if (this.val === 0) return cb();
    this.once("zero", cb);
  }
}

export default function multipart(multipartOpts: MultiPartOptions) {
  const opts = Object.assign({}, defaultOpts, multipartOpts);
  assert(opts.storageEngine != null, "a storage engine must be provided");

  return async function multipartMiddleware(ctx: Context, next: any) {
    if (!ctx.is("multipart")) return next();
    ctx.request.files = [];
    const fields: { [key: string]: any } = {};
    const busboy = new Busboy({
      headers: ctx.req.headers,
      limits: {
        fileSize: opts.maxFileSize,
        files: opts.maxNumFiles
      }
    });
    let pending = new Counter();
    await new Promise((resolve, reject) => {
      ctx.req.pipe(busboy);
      let isDone = false;
      let busboyIsFinished = false;
      let errored = false;
      function checkDone() {
        if (
          busboyIsFinished === true &&
          pending.val === 0 &&
          errored === false
        ) {
          done();
        }
      }
      function errorOut(err: Error) {
        if (errored) return;
        errored = true;
        pending.whenZero(() => {
          reject(err);
        });
      }
      function done(err?: Error) {
        if (isDone) return;
        isDone = true;
        ctx.req.unpipe(busboy);
        busboy.removeAllListeners();
        ctx.request.body = Object.assign(ctx.request.body || {}, fields);
        pending.whenZero(() => {
          resolve();
        });
      }

      busboy
        .on("field", (name, value) => {
          appendField(fields, name, value);
        })
        .on("file", (fieldname, file, filename, encoding, mimetype) => {
          // if we errored dont call handlefile for remaining files
          if (errored) return file.resume();
          pending.increment();
          opts.storageEngine
            .handleFile({ file, filename, fieldname, ctx, encoding, mimetype })
            .then(res => {
              ctx.request.files.push(
                Object.assign({ originalFilename: filename, fieldname }, res)
              );
              pending.decrement();

              checkDone();
            })
            .catch(err => {
              pending.decrement();
              errorOut(err);
            });
        })
        .on("finish", () => {
          busboyIsFinished = true;
          checkDone();
        })
        .on("error", errorOut);
    });
    return next();
  };
}
