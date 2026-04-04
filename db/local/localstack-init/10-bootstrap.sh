#!/bin/sh

set -eu

BLOB_BUCKET="thoth-local-blob-store"
LLM_QUEUE_NAME="thoth-llm-completions"

if ! awslocal s3api head-bucket --bucket "$BLOB_BUCKET" >/dev/null 2>&1; then
  awslocal s3api create-bucket --bucket "$BLOB_BUCKET" >/dev/null
fi

if ! awslocal sqs get-queue-url --queue-name "$LLM_QUEUE_NAME" >/dev/null 2>&1; then
  awslocal sqs create-queue --queue-name "$LLM_QUEUE_NAME" >/dev/null
fi
