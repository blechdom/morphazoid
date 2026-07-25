import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const root = new URL("../", import.meta.url);

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

test("site builder publishes runtime files without development material", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "morphazoid-site-"));
  const output = join(temporary, "public");
  try {
    await execFileAsync("bash", ["scripts/build-site.sh", output], {
      cwd: root,
    });

    for (const path of [
      "index.html",
      "app.js",
      "src/audio.js",
      "src/contour-synth-processor.js",
      "analyzer.html",
      "analyzer-app.js",
      "src/analyzer.js",
      "shepard-risset.html",
      "shepard-risset-app.js",
      "src/shepard-risset.js",
      "candy-coil-delay.html",
      "striped-sludge-delay.html",
      "sandy-syrup-delay.html",
      "barber-delay.css",
      "barber-delay-app.js",
      "src/barber-delay.js",
      "recursive-fm.html",
      "recursive-fm-app.js",
      "src/recursive-fm.js",
      "recursive-pm.html",
      "recursive-pm.css",
      "recursive-pm-app.js",
      "src/recursive-pm.js",
      "chaotic-fm.html",
      "chaotic-fm.css",
      "chaotic-fm-app.js",
      "src/chaotic-fm.js",
      "morphazoidical/index.html",
      "morphazoidical/PLAN.md",
      "vendor/signalsmith-stretch/SignalsmithStretch.mjs",
      "vendor/tactile/tactile.js",
    ]) {
      assert.equal(await exists(join(output, path)), true, `missing ${path}`);
    }

    for (const path of [
      "tests",
      ".github",
      "scripts",
      "package.json",
      "README.md",
      ".preview-cdp.ps1",
      ".throatazoid-preview.png",
    ]) {
      assert.equal(await exists(join(output, path)), false, `published ${path}`);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("CloudFormation keeps the origin private and CI permissions narrow", async () => {
  const template = await readFile(new URL("../infra/site.yml", import.meta.url), "utf8");

  assert.match(template, /BlockPublicAcls:\s+true/);
  assert.match(template, /ObjectOwnership:\s+BucketOwnerEnforced/);
  assert.match(template, /SigningBehavior:\s+always/);
  assert.match(template, /OriginAccessControlId:/);
  assert.match(template, /ValidationMethod:\s+DNS/);
  assert.match(template, /HostedZoneId:\s+Z2FDTNDATAQYW2/);
  assert.match(template, /Type:\s+AAAA/);
  assert.match(template, /Runtime:\s+cloudfront-js-2\.0/);
  assert.match(template, /request\.uri\.endsWith\('\/'\)/);
  assert.match(template, /token\.actions\.githubusercontent\.com:sub:\s+!Ref GitHubOidcSubject/);
  assert.match(template, /Header:\s+Permissions-Policy/);
  assert.match(template, /Sid:\s+DenyInsecureTransport/);
  assert.match(template, /cloudfront:CreateInvalidation/);
  assert.doesNotMatch(template, /PolicyName:[\s\S]*?route53:\*/);
  assert.doesNotMatch(template, /PolicyName:[\s\S]*?iam:\*/);
});

test("AWS workflow verifies before OIDC deployment and uses repository variables", async () => {
  const workflow = await readFile(new URL("../.github/workflows/deploy-aws.yml", import.meta.url), "utf8");

  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:\s*\n\s+branches:\s+\[main\]/);
  assert.match(workflow, /npm run verify/);
  assert.match(workflow, /actions\/upload-artifact@v7/);
  assert.match(workflow, /actions\/download-artifact@v8/);
  assert.match(workflow, /aws-actions\/configure-aws-credentials@v6\.2\.3/);
  assert.match(workflow, /id-token:\s+write/);
  assert.match(workflow, /environment:\s*\n\s+name:\s+production/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /vars\.AWS_ACCOUNT_ID/);
  assert.match(workflow, /allowed-account-ids:\s+\$\{\{\s+vars\.AWS_ACCOUNT_ID\s+\}\}/);
  assert.match(workflow, /vars\.AWS_DEPLOY_ROLE_ARN/);
  assert.match(workflow, /vars\.AWS_SITE_BUCKET/);
  assert.match(workflow, /vars\.AWS_CLOUDFRONT_DISTRIBUTION_ID/);
  assert.match(workflow, /cloudfront wait invalidation-completed/);
  assert.match(workflow, /https:\/\/morphazoid\.com\/morphazoidical\//);
  assert.doesNotMatch(workflow, /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/);
});
