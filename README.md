# kmultipart

A multipart body parser for koa. Definitely needs more eyes and testing before use in production.

## Install

`npm i @robotmayo/kmultipart`

## Features

- Custom storage engine

## Quick Start

```javascript
import KRouter from "@robotmayo/krouter";
import multipart, { Diskstorage } from "@robotmayo/kmultipart";
import * as Koa from "koa";
const app = new Koa();
const router = new KRouter();

router.post(
  "/upload",
  multipart({ storage: new DiskStorage({ destination: "/files" }) }),
  (ctx, next) => {
    ctx.body = "Uploaded ${ctx.request.files.length} file(s) succesfully";
  }
);

app.use(router.middleware());
app.listen();
```

## Api

`multipart(opts)`
Returns middleware that parses multipart forms using busboy

| Parameter     | Required | Type          | Description                               |
| ------------- | -------- | ------------- | ----------------------------------------- |
| opts          | True     | object        |                                           |
| storageEngine | True     | StorageEngine | A storage engine object or class instance |

Kmultipart requires a storage engine to function. It comes with two built in ones but its very simple to create your own.
A custom storage engine is simple an object or class instance with the function `handleFile`. It takes a single object containing the file stream and other information.

`{handleFile(handleFilePart)}`

`handleFilePart`

| Parameter | Type                  | Description                                            |
| --------- | --------------------- | ------------------------------------------------------ |
| file      | NodeJS.ReadableStream | The file stream                                        |
| filename  | string                | the original filename as it appeared on their computer |
| fieldname | string                | the fieldname of the object                            |
| ctx       | Koa.Context           | the koa context                                        |
| encoding  | string                | file encoding                                          |
| mimetype  | string                | file mimetype                                          |

## Why?

The major existing solutions dont support custom storage engines. Also writing my own sounded fun.
