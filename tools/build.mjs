/*
  BrainiLab production asset build scaffold.

  Install once:
    npm install

  Then:
    npm run build

  This intentionally minifies the already role-split V38 bundles instead of
  changing the runtime architecture in one risky migration.
*/
import {build} from "esbuild";
import {mkdir, copyFile, readdir} from "node:fs/promises";
import path from "node:path";

const root=path.resolve(".");
const out=path.join(root,"dist","assets","js");
await mkdir(out,{recursive:true});

const entries=[
  "shell.bundle.js",
  "cloud.bundle.js",
  "quiz.bundle.js",
  "daily.bundle.js",
  "daily-overview.bundle.js",
  "home.bundle.js",
  "games.bundle.js",
  "social.bundle.js",
  "rankings.bundle.js",
  "profile.bundle.js",
  "profile-social.bundle.js",
  "suggestions.bundle.js",
  "order-up.js",
  "topic-rush.js",
  "connections.js",
  "survival.js",
  "odd-one-out.js",
  "higher-lower.js",
  "math-rush.js",
  "number-route.js",
  "sequence.js",
  "try-first.js"
];

for(const file of entries){
  await build({
    entryPoints:[path.join(root,"assets","js",file)],
    outfile:path.join(out,file),
    bundle:false,
    minify:true,
    sourcemap:true,
    target:["es2020"],
    legalComments:"none"
  });
}

console.log(`Built ${entries.length} minified BrainiLab JS assets.`);
