# Architecture

## Overview

A conversation is a sequence of multi-modal messages. The user reaches the
system through the proxy. The conversations agent owns the primary dialogue
loop, can use tools, and persists work into the conversations store.

![Architecture](./arch-plan-2.png)

## Components

**Proxy** — Entry point for the mobile and web app. It can be extended later
to handle additional channels.

**Conversations Agent** — Primary user-facing agent. It handles the live
conversation, can use tools, and can run threads to answer difficult
questions.

**Conversations Store** — Operational store for conversation history and
non-text media.

## Flow

1. The user interacts with the system through the proxy.
2. The proxy forwards the request to the conversations agent.
3. The conversations agent reads from and writes to the conversations store.

## Notes

- The proxy and the agents run as separate services.
- The conversations store is the operational source for live assistant state.
