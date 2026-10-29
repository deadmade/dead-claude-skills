---
flow: feature
phase: build
now: Building task 2 of 2.
---

# Login: flow

## Request

Let people sign in with a name and a password, and keep the form short.

## Gates

- Gate 1, spec approved: 2026-01-10
- Gate 2, plan approved: 2026-01-11

## Options

### Where the form lives

Offered 2026-01-10: its own page, or a panel over the start page.

- **Picked:** its own page, so a link can point at it.

### Remember me

Offered 2026-01-11: a checkbox, or nothing for now.

## Rulings

- 2026-01-12, Task 1: the form keeps the browser's own validation — fewer moving parts — costs a plainer error text.

## Deviations

### The form needs a second field

Status: open

### Pick a hash

Status: decided 2026-01-12: argon2
