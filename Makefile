# Makefile — `make check` is this project's single green/red command (software-factory-kit WORKFLOW.md §2 rule 4).
# Every agent runs it before claiming done, the supervisor re-runs it to verify, and .githooks/pre-push runs it
# before anything leaves the machine. It must exit non-zero when ANY part fails.
#
# ADAPT PER STACK: replace the three recipes below with this project's real commands (and copy them into the
# Commands table in AGENTS.md). Until then they fail on purpose, so an unconfigured repo can never look green.
# Keep the target names: skills and hooks call `make check`, not the tools directly.

## Until the stack is chosen at the Design check (GD), there is no app code: lint/types/test pass only while
## apps/ and src/ are absent, and fail the moment code lands without real commands (so it can never look green falsely).
NO_CODE = @if [ -e apps ] || [ -e src ]; then echo "make $@: app code exists but the stack commands are not configured" >&2; exit 1; fi; echo "make $@: no app code yet (pre-stack)"

.PHONY: check lint types test decisions

## check: lint + types + tests + decision review in sync — the gate
check: lint types test decisions
	@echo "make check: OK"

## lint: formatting / style, in check-only mode (never rewrite files here)
lint:
	$(NO_CODE)

## types: static analysis / type checking
types:
	$(NO_CODE)

## test: the whole test suite, including tests/acceptance/**
test:
	$(NO_CODE)

## decisions: docs/decisions/REVIEW.md matches the decision journal (works as is; no adapting needed)
decisions:
	bash scripts/decision-views.sh --check

# --- Example: Laravel 13 / PHP 8.5 (Pint + Larastan/PHPStan + Pest or PHPUnit) -------------------------------
# Replace the three recipes above with these (recipe lines must start with a TAB):
#
# lint:
# 	vendor/bin/pint --test
#
# types:
# 	vendor/bin/phpstan analyse --no-progress --memory-limit=1G
#
# test:
# 	php artisan test --compact
#
# Optional extras once they exist: `composer validate --strict` in lint, `php artisan test --parallel` in test,
# `bash scripts/embed-diagrams.sh --check docs/architecture/*.md` as a docs target added to check.
