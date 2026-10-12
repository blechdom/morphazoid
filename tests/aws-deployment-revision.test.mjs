import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const workflow = await readFile(new URL("../.github/workflows/deploy-aws.yml", import.meta.url), "utf8");
const deploy = workflow.slice(workflow.indexOf("\n  deploy:\n"));
const steps = deploy.split(/\n {6}- /).slice(1);
const revision = steps.find(step => step.startsWith("name: Verify deployment revision\n"));
assert.ok(revision, "the deployment job needs a live-revision guard");
const script = revision.split("        run: |\n")[1].replace(/^ {10}/gm, "");
const current = "a".repeat(40), older = "b".repeat(40);

async function runGuard({ head = current, sha = current, apiStatus = 0 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "morphazoid-deploy-revision-"));
  const output = join(directory, "output"), calls = join(directory, "calls");
  try {
    await writeFile(output, "");
    await writeFile(join(directory, "gh"), [
      "#!/usr/bin/env bash", "set -euo pipefail",
      'printf "%s\\n" "$*" >> "$GUARD_TEST_CALLS"',
      'if [[ "$GUARD_TEST_API_STATUS" != 0 ]]; then exit "$GUARD_TEST_API_STATUS"; fi',
      'printf "%s\\n" "$GUARD_TEST_HEAD"', "",
    ].join("\n"), { mode: 0o755 });
    let result, error;
    try {
      result = await execFileAsync("bash", ["--noprofile", "--norc", "-c", script], {
        cwd: directory,
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`,
          GITHUB_REPOSITORY: "blechdom/morphazoid", GITHUB_SHA: sha, GITHUB_OUTPUT: output,
          GH_TOKEN: "test-token", GUARD_TEST_CALLS: calls,
          GUARD_TEST_HEAD: head, GUARD_TEST_API_STATUS: String(apiStatus) },
      });
    } catch (caught) { error = caught; }
    return { result, error, output: await readFile(output, "utf8"), calls: await readFile(calls, "utf8") };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("the production lock covers a live revision check immediately before all publication steps", () => {
  assert.match(deploy, /concurrency:\s*\n\s+group: morphazoid-production\s*\n\s+cancel-in-progress: false/);
  assert.match(revision, /id: revision/);
  assert.match(revision, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  const guardIndex = steps.indexOf(revision);
  assert.ok(guardIndex >= 0);
  assert.ok(steps[guardIndex + 1].startsWith("name: Publish static files\n"));
  const publication = steps.slice(guardIndex + 1);
  assert.deepEqual(publication.map(step => step.split("\n")[0]), [
    "name: Publish static files", "name: Invalidate CloudFront", "name: Wait for publication", "name: Smoke-test production",
  ]);
  for (const step of publication) assert.match(step, /if: steps\.revision\.outputs\.deploy == 'true'/);
  assert.doesNotMatch(steps.slice(0, guardIndex).join("\n"), /aws s3 (?:sync|cp)|aws cloudfront create-invalidation/);
});

test("the current main revision can publish using an authenticated live ref lookup", async () => {
  const run = await runGuard();
  assert.equal(run.error, undefined);
  assert.equal(run.output, "deploy=true\n");
  assert.equal(run.calls, "api repos/blechdom/morphazoid/git/ref/heads/main --jq .object.sha\n");
});

test("an older queued revision skips every publication step without failing the workflow", async () => {
  const run = await runGuard({ sha: older });
  assert.equal(run.error, undefined);
  assert.equal(run.output, "deploy=false\n");
  assert.match(run.result.stdout, /::notice::Skipping outdated deployment/);
  assert.ok(run.result.stdout.includes(current));
  assert.ok(run.result.stdout.includes(older));
});

test("API failures and missing or malformed refs cannot authorize publication", async () => {
  for (const options of [{ apiStatus: 1 }, { head: "" }, { head: "null" }, { head: "abc" }, { head: `${current}\n${older}` }]) {
    const run = await runGuard(options);
    assert.ok(run.error, JSON.stringify(options));
    assert.equal(run.output, "", "failure must never emit permission to deploy");
  }
});
