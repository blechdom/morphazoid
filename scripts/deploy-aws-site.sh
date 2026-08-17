#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
artifact_arg="${1:-dist}"
if [[ "$artifact_arg" = /* ]]; then
  artifact_dir="$(realpath -m "$artifact_arg")"
else
  artifact_dir="$(realpath -m "$repo_root/$artifact_arg")"
fi
stack_name="${AWS_STACK_NAME:-morphazoid-production}"
region="${AWS_REGION:-us-east-1}"
dry_run="${DRY_RUN:-false}"

if ! command -v aws >/dev/null 2>&1; then
  echo "AWS CLI v2 is required: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html" >&2
  exit 1
fi

if [[ $# -eq 0 || ! -d "$artifact_dir" ]]; then
  node "$repo_root/scripts/build-release-site.mjs" "$artifact_dir"
fi

aws_args=(--region "$region")
if [[ -n "${AWS_PROFILE:-}" ]]; then
  aws_args+=(--profile "$AWS_PROFILE")
fi

stack_output() {
  local key="$1"
  aws cloudformation describe-stacks \
    --stack-name "$stack_name" \
    --query "Stacks[0].Outputs[?OutputKey=='$key'].OutputValue | [0]" \
    --output text \
    "${aws_args[@]}"
}

bucket="${AWS_SITE_BUCKET:-}"
distribution_id="${AWS_CLOUDFRONT_DISTRIBUTION_ID:-}"

if [[ -z "$bucket" ]]; then
  bucket="$(stack_output SiteBucketName)"
fi
if [[ -z "$distribution_id" ]]; then
  distribution_id="$(stack_output DistributionId)"
fi

if [[ -z "$bucket" || "$bucket" = "None" ]]; then
  echo "Could not resolve the site bucket from AWS_SITE_BUCKET or stack $stack_name." >&2
  exit 1
fi
if [[ -z "$distribution_id" || "$distribution_id" = "None" ]]; then
  echo "Could not resolve the CloudFront distribution ID." >&2
  exit 1
fi

sync_args=(
  s3 sync
  "$artifact_dir/"
  "s3://$bucket/"
  --delete
  --only-show-errors
  --cache-control "public,max-age=300,must-revalidate"
)
if [[ "$dry_run" = "true" ]]; then
  sync_args+=(--dryrun)
fi

echo "Publishing $artifact_dir to s3://$bucket"
aws "${sync_args[@]}" "${aws_args[@]}"

if [[ "$dry_run" = "true" ]]; then
  echo "Dry run complete; CloudFront was not invalidated."
  exit 0
fi

aws s3 cp \
  "$artifact_dir/" \
  "s3://$bucket/" \
  --recursive \
  --exclude "*" \
  --include "*.html" \
  --only-show-errors \
  --cache-control "public,max-age=0,must-revalidate" \
  "${aws_args[@]}"

invalidation_id="$(
  aws cloudfront create-invalidation \
    --distribution-id "$distribution_id" \
    --paths "/*" \
    --query "Invalidation.Id" \
    --output text \
    "${aws_args[@]}"
)"

echo "Published site and started CloudFront invalidation $invalidation_id"
