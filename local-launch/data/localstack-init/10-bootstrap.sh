#!/bin/sh

set -eu

LLM_QUEUE_NAME="thoth-llm-completions"

if ! awslocal sqs get-queue-url --queue-name "$LLM_QUEUE_NAME" >/dev/null 2>&1; then
  awslocal sqs create-queue --queue-name "$LLM_QUEUE_NAME" >/dev/null
fi
