import anyTest, { TestInterface } from "ava";
import * as http from "http";
import multipart, {
  ConcatStream,
  MemoryStorage,
  KMultipartFile,
  MemoryStorageFile,
  DiskStorage,
  DiskStorageFile,
  StorageEngine
} from ".";
import { createReadStream, readFileSync, promises, statSync } from "fs";
import * as Koa from "koa";
import { resolve, basename } from "path";
import fetch from "node-fetch";
import * as FormData from "form-data";
import { tmpdir } from "os";
const FIXTURE_DIR = resolve(__dirname, "..", "fixtures");
const FIXTURE_PATHS = {
  SHORT_TEXT: resolve(FIXTURE_DIR, "short.txt"),
  BIG_JPEG: resolve(FIXTURE_DIR, "big.jpeg"),
  SMALL_JPEG: resolve(FIXTURE_DIR, "small.jpeg"),
  EMPTY: resolve(FIXTURE_DIR, "empty"),
  LONG_TEXT: resolve(FIXTURE_DIR, "long.txt")
};
const test = anyTest as TestInterface<{
  listeners: http.Server[];
  listen: (
    app: Koa
  ) => Promise<{
    server: http.Server;
    address: string;
    port: number;
    family: string;
  }>;
}>;
test.before(async t => {
  const listeners: http.Server[] = [];
  t.context.listeners = listeners;
  t.context.listen = async app => {
    return new Promise((resolve, reject) => {
      const s = app.listen(0);
      listeners.push(s);
      s.once("listening", () => {
        s.removeListener("error", reject);
        resolve({ server: s, ...(s.address as any)() });
      }).once("error", reject);
    });
  };
});
test.after(t => {
  for (const server of t.context.listeners) {
    server.close();
  }
});

test.cb("concat stream > simple text file", t => {
  t.plan(1);
  const cs = new ConcatStream();
  const rs = createReadStream(FIXTURE_PATHS.SHORT_TEXT);
  rs.pipe(cs)
    .on("finish", () => {
      const text = cs.bodyBuffer().toString("utf8");
      const file = readFileSync(FIXTURE_PATHS.SHORT_TEXT, "utf8");
      t.is(text, file);
      t.end();
    })
    .on("error", err => t.fail(err.stack));
});

test.cb("concat stream > big jpeg", t => {
  t.plan(1);
  const cs = new ConcatStream();
  const rs = createReadStream(FIXTURE_PATHS.SMALL_JPEG);
  rs.pipe(cs)
    .on("finish", () => {
      const imgBuffer = cs.bodyBuffer();
      const file = readFileSync(FIXTURE_PATHS.SMALL_JPEG);
      t.is(imgBuffer.length, file.length);
      t.end();
    })
    .on("error", err => t.fail(err.message));
});

test("multipart > memory storage", async t => {
  const app = new Koa();
  t.plan(5);
  app.use(multipart({ storageEngine: new MemoryStorage() })).use(ctx => {
    ctx.body = "im done";
    const files = ctx.request.files as MemoryStorageFile[];
    t.is(files.length, 1);
    t.is(files[0].originalFilename, basename(FIXTURE_PATHS.SMALL_JPEG));
    t.is(files[0].fieldname, "SMALLER");
    t.is(
      files[0].fileContents.length,
      readFileSync(FIXTURE_PATHS.SMALL_JPEG).length
    );
    t.true(Buffer.isBuffer(files[0].fileContents));
  });
  const { port } = await t.context.listen(app);
  const form = new FormData();
  form.append("SMALLER", createReadStream(FIXTURE_PATHS.SMALL_JPEG));
  await fetch("http://localhost:" + port, {
    method: "post",
    headers: form.getHeaders(),
    body: form
  });
});

test("multipart > memory storage > empty file", async t => {
  const app = new Koa();
  t.plan(6);
  app.use(multipart({ storageEngine: new MemoryStorage() })).use(ctx => {
    ctx.body = "im done";
    const body = ctx.request.body;
    const files = ctx.request.files as (KMultipartFile & MemoryStorageFile)[];
    t.is(files.length, 1);
    t.is(files[0].fileContents.length, 0);
    t.is(files[0].originalFilename, "empty");
    t.is(files[0].fieldname, "nothing here");
    t.is(body.name, "sanic");
    t.is(body["this is also empty"], "");
  });
  const { port } = await t.context.listen(app);
  const form = new FormData();
  form.append("nothing here", createReadStream(FIXTURE_PATHS.EMPTY));
  form.append("this is also empty", "");
  form.append("name", "sanic");
  await fetch("http://localhost:" + port, {
    method: "post",
    headers: form.getHeaders(),
    body: form
  });
});

test("multipart > memory storage > multiple files", async t => {
  const app = new Koa();
  t.plan(8);
  app.use(multipart({ storageEngine: new MemoryStorage() })).use(ctx => {
    ctx.body = "im done";
    const body = ctx.request.body;
    const files = ctx.request.files as MemoryStorageFile[];
    t.is(files.length, 3);
    for (const file of files) {
      switch (file.originalFilename) {
        case basename(FIXTURE_PATHS.SMALL_JPEG):
          t.is(file.fieldname, "animage");
          t.is(
            file.fileContents.length,
            readFileSync(FIXTURE_PATHS.SMALL_JPEG).length
          );
          break;
        case basename(FIXTURE_PATHS.SHORT_TEXT):
          t.is(file.fieldname, "sometext");
          t.is(
            file.fileContents.length,
            readFileSync(FIXTURE_PATHS.SHORT_TEXT).length
          );
          break;
        case basename(FIXTURE_PATHS.LONG_TEXT):
          t.is(file.fieldname, "alottext");
          t.is(
            file.fileContents.length,
            readFileSync(FIXTURE_PATHS.LONG_TEXT).length
          );
          break;
        default:
          t.fail("Unknown file found");
      }
    }
    t.is(body.name, "sanic");
  });
  const { port } = await t.context.listen(app);
  const form = new FormData();
  form.append("animage", createReadStream(FIXTURE_PATHS.SMALL_JPEG));
  form.append("sometext", createReadStream(FIXTURE_PATHS.SHORT_TEXT));
  form.append("alottext", createReadStream(FIXTURE_PATHS.LONG_TEXT));
  form.append("name", "sanic");
  await fetch("http://localhost:" + port, {
    method: "post",
    headers: form.getHeaders(),
    body: form
  });
});

test("multipart > disk storage", async t => {
  const app = new Koa();
  t.plan(2);
  const storage = new DiskStorage({ destination: tmpdir() });
  app.use(multipart({ storageEngine: storage })).use(ctx => {
    ctx.body = "im done";
    const files = ctx.request.files as DiskStorageFile[];
    t.truthy(statSync(files[0].path));
    t.is(files[0].size, readFileSync(FIXTURE_PATHS.SMALL_JPEG).byteLength);
  });
  const { port } = await t.context.listen(app);
  const form = new FormData();
  form.append("SMALLER", createReadStream(FIXTURE_PATHS.SMALL_JPEG));
  await fetch("http://localhost:" + port, {
    method: "post",
    headers: form.getHeaders(),
    body: form
  });
});

test("multipart > disk storage > multiple files", async t => {
  const app = new Koa();
  t.plan(7);
  const storage = new DiskStorage({ destination: tmpdir() });
  app.use(multipart({ storageEngine: storage })).use(ctx => {
    ctx.body = "im done";
    const files = ctx.request.files as DiskStorageFile[];
    for (const file of files) {
      switch (file.originalFilename) {
        case basename(FIXTURE_PATHS.SMALL_JPEG):
          t.is(file.fieldname, "animage");
          t.is(file.size, readFileSync(FIXTURE_PATHS.SMALL_JPEG).byteLength);
          break;
        case basename(FIXTURE_PATHS.SHORT_TEXT):
          t.is(file.fieldname, "sometext");
          t.is(file.size, readFileSync(FIXTURE_PATHS.SHORT_TEXT).byteLength);
          break;
        case basename(FIXTURE_PATHS.LONG_TEXT):
          t.is(file.fieldname, "alottext");
          t.is(file.size, readFileSync(FIXTURE_PATHS.LONG_TEXT).byteLength);
          break;
        default:
          t.fail("Unknown file found");
      }
    }
    t.is(ctx.request.body.name, "sanic");
  });
  const { port } = await t.context.listen(app);
  const form = new FormData();
  form.append("animage", createReadStream(FIXTURE_PATHS.SMALL_JPEG));
  form.append("sometext", createReadStream(FIXTURE_PATHS.SHORT_TEXT));
  form.append("alottext", createReadStream(FIXTURE_PATHS.LONG_TEXT));
  form.append("name", "sanic");
  await fetch("http://localhost:" + port, {
    method: "post",
    headers: form.getHeaders(),
    body: form
  });
});

test("multipart > fields", async t => {
  const app = new Koa();
  t.plan(1);
  app.use(multipart({ storageEngine: new MemoryStorage() })).use(ctx => {
    ctx.body = "im done";
    const bod = ctx.request.body;
    t.deepEqual(bod, {
      triforce: [
        { wielder: "Link", name: "Courage" },
        { wielder: "Zelda", name: "Wisdom" },
        { wielder: "Ganondorf", name: "Power" }
      ],
      superMarioBrothers: ["1", "2", "3"]
    });
  });
  const { port } = await t.context.listen(app);
  const form = new FormData();

  form.append("triforce[0][wielder]", "Link");
  form.append("triforce[0][name]", "Courage");
  form.append("triforce[1][wielder]", "Zelda");
  form.append("triforce[1][name]", "Wisdom");
  form.append("triforce[2][wielder]", "Ganondorf");
  form.append("triforce[2][name]", "Power");
  form.append("superMarioBrothers[0]", 1);
  form.append("superMarioBrothers[1]", 2);
  form.append("superMarioBrothers[2]", 3);
  await fetch("http://localhost:" + port, {
    method: "post",
    headers: form.getHeaders(),
    body: form
  });
});

test("multipart > broken storage", async t => {
  const app = new Koa();
  t.plan(3);
  const badStorage: StorageEngine = {
    async handleFile(h) {
      throw new Error("Help im alive");
    }
  };
  app
    .use(async (ctx, next) => {
      try {
        await multipart({ storageEngine: badStorage })(ctx, next);
      } catch (err) {
        t.is(err.message, "Help im alive");
        ctx.body = "beep beep";
        ctx.status = 500;
      }
    })
    .use(ctx => {
      t.fail("Should never make it here");
    });
  const { port } = await t.context.listen(app);
  const form = new FormData();

  form.append("text", createReadStream(FIXTURE_PATHS.SHORT_TEXT));
  const res = await fetch("http://localhost:" + port, {
    method: "post",
    headers: form.getHeaders(),
    body: form
  });
  t.is(res.status, 500);
  const txt = await res.text();
  t.is(txt, "beep beep");
});
