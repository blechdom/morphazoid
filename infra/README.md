# Morphazoid on AWS

Production uses:

- a private, versioned S3 bucket;
- CloudFront with signed Origin Access Control and HTTPS;
- an ACM certificate for `morphazoid.com` and `www.morphazoid.com`;
- Route 53 `A` and `AAAA` aliases;
- a GitHub Actions OIDC role that can only publish objects and invalidate this distribution.

The stack must be deployed in `us-east-1` because CloudFront certificates must
exist there. `www.morphazoid.com` redirects to the apex domain, and directory
paths such as `/morphazoidical/` resolve to their `index.html`.

## Prerequisites

1. The public Route 53 hosted zone for `morphazoid.com` must be in the target
   AWS account.
2. Install [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html).
3. Authenticate with an administrator/bootstrap profile, preferably through
   IAM Identity Center:

   ```bash
   aws configure sso --profile morphazoid
   aws sso login --profile morphazoid
   ```

4. Ensure `gh auth status` points to `blechdom/morphazoid`.

The bootstrap script defaults to the legacy subject
`repo:blechdom/morphazoid:environment:production`. GitHub changed the default
subject format for repositories created or transferred after July 15, 2026.
Confirm the exact subject in GitHub's OIDC settings; if the repository uses
immutable subjects or has been renamed/transferred, pass it during bootstrap:

```bash
GITHUB_OIDC_SUBJECT='repo:OWNER@OWNER_ID/REPO@REPO_ID:environment:production' \
  AWS_PROFILE=morphazoid ./scripts/bootstrap-aws-site.sh
```

The bootstrap identity needs CloudFormation, S3, CloudFront, ACM, Route 53, IAM
role, and IAM OIDC-provider permissions. Those privileges are never granted to
the routine CI deploy role.

## One-time bootstrap

Inspect the account and hosted zone, then explicitly approve provisioning:

```bash
AWS_PROFILE=morphazoid ./scripts/bootstrap-aws-site.sh
```

CloudFront creation commonly takes several minutes. The script prints the
resulting AWS account, bucket, distribution, and deploy-role values. Copy them
into GitHub repository variables using the printed `gh variable set` commands.

The workflow uses the GitHub `production` environment. In repository settings,
restrict that environment to the `main` branch and add reviewers if desired.

## Initial or manual content deployment

```bash
./scripts/build-site.sh dist
AWS_PROFILE=morphazoid ./scripts/deploy-aws-site.sh dist
```

Use `DRY_RUN=true` to preview the S3 sync without uploading or invalidating:

```bash
DRY_RUN=true AWS_PROFILE=morphazoid ./scripts/deploy-aws-site.sh dist
```

After the GitHub variables are present, `.github/workflows/deploy-aws.yml`
verifies and packages pull requests, and deploys pushes to `main`. It uses
short-lived OIDC credentials; no AWS access keys are stored in GitHub.

The existing GitHub Pages workflow can remain online during DNS cutover. Once
`https://morphazoid.com` is verified, disable or remove the Pages workflow to
avoid maintaining two production deployments.

## Cost and recovery notes

S3, CloudFront, Route 53 hosted-zone/DNS, and invalidation usage can incur AWS
charges. The bucket is retained if the CloudFormation stack is deleted, and
noncurrent object versions remain recoverable for 30 days. The GitHub OIDC
provider is also retained because it is account-global.
